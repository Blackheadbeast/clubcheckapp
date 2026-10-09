// Online booking: what the public page and the website widget are allowed to see and do.
//
// Nothing here decides whether a class has room, whether a coach is free, whether a membership
// covers a class, or what something costs. Those answers come from the engines that already give
// them to staff and to the member app (bookClass, getSlots, bookAppointment, checkEligibility,
// sellMembership, collectInvoice, cancelBooking, cancelAppointment). This layer adds only what is
// particular to a stranger on the internet: which of the gym's things are public, who the person
// is, a confirmation they can come back to, and a record that the booking came from the website.
//
// Every function takes the gym from the public slug. No caller can name a gym, a member or a
// staff member by its internal id and have that trusted.

import { z } from 'zod'
import type { BookingSite, Member, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { checkMemberLimit } from '@/lib/billing'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { formatDateTime, formatMoney } from '@/lib/format'
import { createInvite } from '@/lib/member-auth'
import { signManageToken, type ManageRef } from '@/lib/public-booking/tokens'
import { getGymSettings, logActivity, type ActorRef, type GymSettings } from './core'
import { ensureSessions, listSessions } from './classes'
import { bookClass, cancelBooking, checkEligibility, classDocumentsGate } from './bookings'
import { appointmentTypeAccess, bookAppointment, cancelAppointment, getSlots, isLate, settleAppointmentPayment } from './appointments'
import { createMember } from './members'
import { intervalLabel } from './memberships'
import { buyPlanWithSavedMethod } from './purchases'
import { queueMessage } from './messaging'
import { flushOutbox } from './automations'
import { leadEvent } from './events'

export const ONLINE = 'online'
export const LEAD_SOURCE = 'online_booking'
const SYSTEM_ACTOR: ActorRef = { type: 'system', name: 'Online booking' }

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Words a booking address cannot be: they are, or could become, pages of ClubCheck itself. */
const RESERVED = new Set(['admin', 'api', 'app', 'book', 'booking', 'clubcheck', 'embed', 'help', 'login', 'manage', 'member', 'members', 'new', 'settings', 'signup', 'staff', 'support', 'test', 'widget', 'www'])
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugify(name: string) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return slug.length >= 3 ? slug : `gym-${slug || 'booking'}`
}

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
export const siteSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().min(3, 'Use at least 3 characters').max(40).regex(SLUG, 'Use lowercase letters, numbers and hyphens only').refine((s) => !RESERVED.has(s), 'That address is reserved. Choose another.'),
  displayName: optional(80),
  tagline: optional(160),
  // A colour is a six-digit hex value and nothing else: it is the only thing from settings that reaches a style attribute.
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563eb').transform((v) => v.toLowerCase()),
  buttonStyle: z.enum(['rounded', 'pill', 'square']),
  appearance: z.enum(['light', 'dark', 'auto']),
  showLogo: z.boolean(),
  locationIds: z.array(z.string().uuid()).max(100),
  allClassTypes: z.boolean(),
  classTypeIds: z.array(z.string().uuid()).max(300),
  appointmentTypeIds: z.array(z.string().uuid()).max(300),
  requireAccount: z.boolean(),
  allowGuests: z.boolean(),
  advanceDays: z.number().int().min(1).max(365).nullish().transform((v) => v ?? null),
  cancellationPolicy: optional(1000),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(200).nullish().or(z.literal('').transform(() => null)).transform((v) => v || null),
  contactPhone: optional(40),
  // Links are http(s) only, so a setting can never become a script.
  termsUrl: z.string().trim().max(500).refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'Enter a full link starting with https://').nullish().or(z.literal('').transform(() => null)).transform((v) => v || null),
})
export type SiteInput = z.infer<typeof siteSchema>

/** The gym's booking settings, made on first use with a free address suggested from its name. */
export async function getBookingSite(ownerId: string): Promise<BookingSite> {
  const existing = await prisma.bookingSite.findUnique({ where: { ownerId } })
  if (existing) return existing
  const settings = await getGymSettings(ownerId)
  const base = slugify(settings.name)
  for (let n = 0; n < 50; n++) {
    const slug = n === 0 ? base : `${base.slice(0, 36)}-${n + 1}`
    if (RESERVED.has(slug)) continue
    const made = await prisma.bookingSite.createMany({ data: [{ ownerId, slug }], skipDuplicates: true })
    const row = await prisma.bookingSite.findUnique({ where: { ownerId } })
    if (row) return row
    if (made.count === 0) continue
  }
  throw new ApiError(500, 'Could not set up online booking. Try again.', 'internal_error')
}

export async function saveBookingSite(ownerId: string, input: SiteInput) {
  const current = await getBookingSite(ownerId)
  if (input.slug !== current.slug) {
    const taken = await prisma.bookingSite.findUnique({ where: { slug: input.slug }, select: { ownerId: true } })
    if (taken && taken.ownerId !== ownerId) throw new ApiError(409, 'That address is already in use. Choose another.', 'slug_taken')
  }
  // Only this gym's own locations, class types and appointment types can be made public.
  const [locations, classTypes, appointmentTypes] = await Promise.all([
    prisma.location.findMany({ where: { ownerId, id: { in: input.locationIds } }, select: { id: true } }),
    prisma.classType.findMany({ where: { ownerId, id: { in: input.classTypeIds } }, select: { id: true } }),
    prisma.appointmentType.findMany({ where: { ownerId, id: { in: input.appointmentTypeIds } }, select: { id: true } }),
  ])
  if (locations.length !== new Set(input.locationIds).size) throw notFound('Location')
  if (classTypes.length !== new Set(input.classTypeIds).size) throw notFound('Class type')
  if (appointmentTypes.length !== new Set(input.appointmentTypeIds).size) throw notFound('Appointment type')
  try {
    return await prisma.bookingSite.update({ where: { ownerId }, data: { ...input, locationIds: locations.map((l) => l.id), classTypeIds: classTypes.map((c) => c.id), appointmentTypeIds: appointmentTypes.map((a) => a.id) } })
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new ApiError(409, 'That address is already in use. Choose another.', 'slug_taken')
    throw error
  }
}

// ---------------------------------------------------------------------------
// The public site
// ---------------------------------------------------------------------------

export interface SiteCtx {
  site: BookingSite
  ownerId: string
  settings: GymSettings
  name: string
  logoUrl: string | null
}

/** One answer for "no such gym" and "that gym has switched booking off": outsiders cannot tell which addresses exist. */
const unavailable = () => new ApiError(404, 'This booking page is not available.', 'not_found')

export async function resolveSite(slug: string): Promise<SiteCtx> {
  if (!SLUG.test(slug) || slug.length > 40) throw unavailable()
  const site = await prisma.bookingSite.findUnique({ where: { slug } })
  if (!site || !site.enabled) throw unavailable()
  const [settings, profile] = await Promise.all([getGymSettings(site.ownerId), prisma.gymProfile.findUnique({ where: { ownerId: site.ownerId }, select: { logoUrl: true } })])
  return { site, ownerId: site.ownerId, settings, name: site.displayName || settings.name, logoUrl: site.showLogo && profile?.logoUrl && /^https?:\/\//i.test(profile.logoUrl) ? profile.logoUrl : null }
}

/** How far ahead the public may book: the gym's own window, or the shorter one set for the website. */
const advanceDays = (ctx: SiteCtx) => Math.min(ctx.settings.bookingWindowDays, ctx.site.advanceDays ?? Number.MAX_SAFE_INTEGER)
const classTypeFilter = (site: BookingSite): Prisma.ClassTypeWhereInput => ({ isActive: true, category: { not: 'personal_training' }, ...(site.allClassTypes ? {} : { id: { in: site.classTypeIds } }) })
const locationAllowed = (site: BookingSite, locationId: string | null) => site.locationIds.length === 0 || (!!locationId && site.locationIds.includes(locationId))

async function publicLocations(ctx: SiteCtx) {
  return prisma.location.findMany({
    where: { ownerId: ctx.ownerId, isActive: true, ...(ctx.site.locationIds.length > 0 && { id: { in: ctx.site.locationIds } }) },
    orderBy: { name: 'asc' }, select: { id: true, name: true, address: true, city: true, state: true, postalCode: true, phone: true },
  })
}

async function publicAppointmentTypeRows(ctx: SiteCtx) {
  if (ctx.site.appointmentTypeIds.length === 0) return []
  const rows = await prisma.appointmentType.findMany({
    where: { ownerId: ctx.ownerId, isActive: true, memberBookable: true, id: { in: ctx.site.appointmentTypeIds } },
    orderBy: { name: 'asc' }, include: { staff: { select: { staff: { select: { id: true, name: true, title: true, active: true } } } } },
  })
  // A type nobody can currently take, or that is only offered at locations the website does not show, is not offered.
  return rows.filter((t) => t.staff.some((s) => s.staff.active) && (ctx.site.locationIds.length === 0 || t.locationIds.length === 0 || t.locationIds.some((id) => ctx.site.locationIds.includes(id))))
}

/** Everything the page needs to draw itself. Nothing in it identifies the gym internally. */
export async function publicSite(ctx: SiteCtx) {
  const { site, settings } = ctx
  const [locations, classTypes, appointmentTypes] = await Promise.all([
    publicLocations(ctx),
    prisma.classType.findMany({ where: { ownerId: ctx.ownerId, ...classTypeFilter(site) }, orderBy: { name: 'asc' }, select: { id: true, name: true, category: true, description: true } }),
    publicAppointmentTypeRows(ctx),
  ])
  return {
    slug: site.slug, name: ctx.name, tagline: site.tagline, logoUrl: ctx.logoUrl,
    theme: { primaryColor: site.primaryColor, buttonStyle: site.buttonStyle, appearance: site.appearance },
    timezone: settings.timezone, currency: settings.currency, today: zonedParts(new Date(), settings.timezone).date,
    locations: locations.map((l) => ({ id: l.id, name: l.name, address: [l.address, l.city, l.state, l.postalCode].filter(Boolean).join(', ') || null, phone: l.phone })),
    classTypes: classTypes.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description })),
    categories: Array.from(new Set(classTypes.map((t) => t.category))),
    hasClasses: classTypes.length > 0,
    hasAppointments: appointmentTypes.length > 0,
    advanceDays: advanceDays(ctx),
    options: { requireAccount: site.requireAccount, allowGuests: site.allowGuests && !site.requireAccount },
    policy: { cancellation: site.cancellationPolicy, classCancelHours: settings.cancelWindowHours, termsUrl: site.termsUrl },
    contact: { email: site.contactEmail, phone: site.contactPhone },
  }
}

/** Count a visit to the page, for the conversion figure in settings. Never fails the page. */
export async function recordVisit(ctx: SiteCtx) {
  const day = new Date(`${zonedParts(new Date(), ctx.settings.timezone).date}T00:00:00.000Z`)
  await prisma.bookingSiteDaily.upsert({ where: { ownerId_day: { ownerId: ctx.ownerId, day } }, create: { ownerId: ctx.ownerId, day, visits: 1 }, update: { visits: { increment: 1 } } }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

/** The person using the page, once known: a member with an account, or a guest who has given their details. */
export interface Viewer { member: Member; hasAccount: boolean }

export const viewerOut = (v: Viewer | null) => (v ? { name: v.member.name, firstName: v.member.name.split(' ')[0], email: v.member.email, hasAccount: v.hasAccount } : null)

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export type ClassStatus = 'available' | 'almost_full' | 'full' | 'waitlist' | 'closed' | 'not_open' | 'cancelled'

function classStatus(s: { status: string; startsAt: Date; capacity: number; spotsLeft: number; waitlisted: number; waitlistCapacity: number }, ctx: SiteCtx, now: Date): { status: ClassStatus; opensAt: Date | null } {
  if (s.status === 'cancelled') return { status: 'cancelled', opensAt: null }
  if (s.startsAt.getTime() - ctx.settings.bookingCutoffMinutes * 60_000 <= now.getTime()) return { status: 'closed', opensAt: null }
  const opens = new Date(s.startsAt.getTime() - advanceDays(ctx) * 86_400_000)
  if (opens > now) return { status: 'not_open', opensAt: opens }
  if (s.spotsLeft <= 0) return { status: s.waitlisted < s.waitlistCapacity ? 'waitlist' : 'full', opensAt: null }
  return { status: s.spotsLeft <= Math.max(1, Math.ceil(s.capacity * 0.2)) ? 'almost_full' : 'available', opensAt: null }
}

/** The public timetable for a run of days. With a viewer, each class says whether they are already in it. */
export async function publicClasses(ctx: SiteCtx, viewer: Viewer | null, q: { date?: string | null; days?: number; locationId?: string | null; category?: string | null; classTypeId?: string | null }) {
  const { settings, site } = ctx
  const now = new Date()
  const today = zonedParts(now, settings.timezone).date
  const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && q.date >= today ? q.date : today
  // Never further than the booking window plus a week of "opens soon", however far a caller asks to look.
  const last = addDaysToDate(today, Math.min(advanceDays(ctx), 365) + 7)
  if (date > last) return { date, days: 0, classes: [] }
  const days = Math.min(14, Math.max(1, q.days || 7))
  const from = date === today ? now : zonedToUtc(date, '00:00', settings.timezone)
  const until = addDaysToDate(date, days) > last ? addDaysToDate(last, 1) : addDaysToDate(date, days)
  const to = zonedToUtc(until, '00:00', settings.timezone)
  await ensureSessions(ctx.ownerId, to, now)
  const types = await prisma.classType.findMany({ where: { ownerId: ctx.ownerId, ...classTypeFilter(site) }, select: { id: true } })
  const allowed = new Set(types.map((t) => t.id))
  // A location that is not public, or not this gym's, simply matches nothing.
  if (q.locationId && !locationAllowed(site, q.locationId)) return { date, days, classes: [] }
  const sessions = (await listSessions(ctx.ownerId, { from, to, locationId: q.locationId, classTypeId: q.classTypeId, includeCancelled: true }))
    .filter((s) => allowed.has(s.classType.id) && locationAllowed(site, s.location?.id || null) && (!q.category || s.classType.category === q.category))
  const mine = viewer && sessions.length
    ? await prisma.booking.findMany({ where: { ownerId: ctx.ownerId, memberId: viewer.member.id, sessionId: { in: sessions.map((s) => s.id) }, status: { in: ['booked', 'offered', 'waitlisted', 'attended'] } }, select: { id: true, sessionId: true, status: true } })
    : []
  return {
    date, days,
    classes: sessions.map((s) => {
      const state = classStatus(s, ctx, now)
      const booking = mine.find((b) => b.sessionId === s.id)
      return {
        id: s.id, name: s.title, category: s.classType.category, classTypeId: s.classType.id,
        startsAt: s.startsAt, endsAt: s.endsAt, durationMin: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000),
        // A coach is a first name and nothing more: no email, phone, role or id.
        coach: s.coach?.name || null,
        locationId: s.location?.id || null, location: [s.location?.name, s.room].filter(Boolean).join(' · ') || null,
        status: state.status, opensAt: state.opensAt,
        // How many are left is shown only when it helps someone decide: never the roster, never who.
        spotsLeft: ['available', 'almost_full'].includes(state.status) ? s.spotsLeft : 0,
        waitlistAvailable: state.status === 'waitlist',
        myBooking: booking ? { id: booking.id, status: booking.status } : null,
      }
    }),
  }
}

/** A class the public may book, or 404: wrong gym, a class type that is not public, a location that is not public. */
async function publicSession(ctx: SiteCtx, sessionId: string) {
  const session = await prisma.classSession.findFirst({
    where: { id: sessionId, ownerId: ctx.ownerId },
    include: { classType: { select: { id: true, name: true, category: true, description: true, isActive: true } }, coach: { select: { name: true } }, location: { select: { id: true, name: true, address: true, city: true } } },
  })
  if (!session || !session.classType.isActive || session.classType.category === 'personal_training') throw notFound('Class')
  if (!ctx.site.allClassTypes && !ctx.site.classTypeIds.includes(session.classType.id)) throw notFound('Class')
  if (!locationAllowed(ctx.site, session.locationId)) throw notFound('Class')
  return session
}

/** Plans the gym sells publicly that would let someone into this class. */
async function plansFor(ctx: SiteCtx, session: { allowedPlanIds: string[]; classTypeId: string; locationId: string | null }, viewer: Viewer | null) {
  const plans = await prisma.membershipPlan.findMany({
    where: { ownerId: ctx.ownerId, isActive: true, isPublic: true, type: { not: 'pt_package' }, ...(session.allowedPlanIds.length > 0 && { id: { in: session.allowedPlanIds } }) },
    orderBy: [{ priceCents: 'asc' }, { name: 'asc' }], take: 12,
  })
  const used = viewer ? await prisma.membership.findMany({ where: { ownerId: ctx.ownerId, memberId: viewer.member.id, planId: { in: plans.map((p) => p.id) } }, select: { planId: true } }) : []
  return plans
    .filter((p) => (p.classTypeIds.length === 0 || p.classTypeIds.includes(session.classTypeId)) && (p.locationIds.length === 0 || !session.locationId || p.locationIds.includes(session.locationId)))
    // A free trial already used is not offered again.
    .filter((p) => !(['trial', 'free'].includes(p.type) && used.some((u) => u.planId === p.id)))
    .map((p) => {
      const cost = p.priceCents + p.enrollmentFeeCents
      return {
        id: p.id, name: p.name, description: p.description, type: p.type, free: cost === 0,
        priceLabel: cost === 0 ? 'Free' : `${formatMoney(p.priceCents, ctx.settings.currency)}${p.type === 'recurring' ? ` ${intervalLabel(p)}` : ''}${p.enrollmentFeeCents ? ` + ${formatMoney(p.enrollmentFeeCents, ctx.settings.currency)} to join` : ''}`,
        detail: p.type === 'recurring' && p.trialDays > 0 ? `${p.trialDays}-day free trial` : p.credits ? `${p.credits} class${p.credits === 1 ? '' : 'es'}` : null,
      }
    })
}

/** One class, with what it takes to get in and, for a known viewer, whether they can. */
export async function publicClass(ctx: SiteCtx, viewer: Viewer | null, sessionId: string) {
  const s = await publicSession(ctx, sessionId)
  const now = new Date()
  const [taken, waitlisted, mine] = await Promise.all([
    prisma.booking.count({ where: { sessionId: s.id, status: { in: ['booked', 'offered', 'attended'] } } }),
    prisma.booking.count({ where: { sessionId: s.id, status: 'waitlisted' } }),
    viewer ? prisma.booking.findFirst({ where: { sessionId: s.id, memberId: viewer.member.id, status: { in: ['booked', 'offered', 'waitlisted', 'attended'] } }, select: { id: true, status: true } }) : null,
  ])
  const spotsLeft = Math.max(0, s.capacity - taken)
  const state = classStatus({ status: s.status, startsAt: s.startsAt, capacity: s.capacity, spotsLeft, waitlisted, waitlistCapacity: s.waitlistCapacity }, ctx, now)
  // Ask the booking engine itself whether this person may book: the page never works that out for itself.
  let eligibility: { eligible: boolean; code: string | null; message: string | null; usesCredit: boolean } | null = null
  if (viewer && !mine) {
    try {
      const result = await checkEligibility(prisma, { ownerId: ctx.ownerId, member: viewer.member, session: s, settings: ctx.settings })
      eligibility = { eligible: true, code: null, message: null, usesCredit: result.usesCredit }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      eligibility = { eligible: false, code: error.code || 'not_eligible', message: error.message.replace(viewer.member.name, 'You').replace("You's", 'Your').replace('You has', 'You have').replace('You is', 'You are'), usesCredit: false }
    }
  }
  const requiresPlan = (await prisma.membershipPlan.count({ where: { ownerId: ctx.ownerId } })) > 0
  const plans = requiresPlan && (!eligibility || !eligibility.eligible) ? await plansFor(ctx, s, viewer) : []
  return {
    id: s.id, name: s.title || s.classType.name, description: s.classType.description, category: s.classType.category,
    startsAt: s.startsAt, endsAt: s.endsAt, durationMin: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000),
    coach: s.coach?.name || null, location: [s.location?.name, s.room].filter(Boolean).join(' · ') || null, address: [s.location?.address, s.location?.city].filter(Boolean).join(', ') || null,
    status: state.status, opensAt: state.opensAt, spotsLeft: ['available', 'almost_full'].includes(state.status) ? spotsLeft : 0, waitlistAvailable: state.status === 'waitlist',
    cancelReason: s.status === 'cancelled' ? s.cancelReason : null,
    requiresMembership: requiresPlan,
    myBooking: mine,
    eligibility,
    plans,
  }
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export async function publicAppointmentTypes(ctx: SiteCtx, viewer: Viewer | null) {
  const types = await publicAppointmentTypeRows(ctx)
  if (types.length === 0) return []
  const now = new Date()
  const [memberships, packages] = await Promise.all([
    viewer ? prisma.membership.findMany({ where: { ownerId: ctx.ownerId, memberId: viewer.member.id, status: { in: ['active', 'trial'] }, OR: [{ endDate: null }, { endDate: { gte: now } }] }, include: { plan: { select: { id: true, name: true, type: true } } } }) : [],
    prisma.membershipPlan.findMany({ where: { ownerId: ctx.ownerId, isActive: true, isPublic: true, type: 'pt_package' }, orderBy: { priceCents: 'asc' }, select: { id: true, name: true, description: true, priceCents: true, credits: true } }),
  ])
  const money = (c: number) => formatMoney(c, ctx.settings.currency)
  return types.map((t) => {
    const access = appointmentTypeAccess(t, memberships)
    const needsSomething = t.paymentMode === 'credit' || t.requiredPlanIds.length > 0
    return {
      id: t.id, name: t.name, description: t.description, durationMin: t.durationMin, paymentMode: t.paymentMode,
      priceLabel: t.paymentMode === 'paid' ? money(t.priceCents) : t.paymentMode === 'credit' ? `${t.creditsRequired} session${t.creditsRequired === 1 ? '' : 's'}` : needsSomething ? 'Included with membership' : 'Free',
      cancelWindowHours: t.cancelWindowHours,
      locationIds: t.locationIds.filter((id) => locationAllowed(ctx.site, id)),
      coaches: t.staff.map((s) => s.staff).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, title: s.title })),
      // Paying or using sessions needs an account; a free consultation does not.
      needsAccount: t.paymentMode !== 'included' || t.requiredPlanIds.length > 0,
      // For someone signed in: why they cannot book yet, and what would fix it.
      blocked: viewer ? access.blocked : null,
      creditsAvailable: viewer ? access.credits : null,
      packages: t.paymentMode === 'credit' ? packages.filter((p) => t.requiredPlanIds.length === 0 || t.requiredPlanIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name, description: p.description, priceLabel: money(p.priceCents), sessions: p.credits })) : [],
    }
  })
}

async function publicAppointmentType(ctx: SiteCtx, typeId: string) {
  const type = (await publicAppointmentTypeRows(ctx)).find((t) => t.id === typeId)
  if (!type) throw notFound('Appointment type')
  return type
}

/** Free start times on a day, from the appointment engine, inside the public booking window. */
export async function publicSlots(ctx: SiteCtx, viewer: Viewer | null, q: { typeId: string; date: string; staffId?: string | null; locationId?: string | null }) {
  const type = await publicAppointmentType(ctx, q.typeId)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) throw new ApiError(400, 'Choose a date.', 'invalid_parameter')
  const today = zonedParts(new Date(), ctx.settings.timezone).date
  if (q.date < today || q.date > addDaysToDate(today, Math.min(type.maxAdvanceDays, ctx.site.advanceDays ?? type.maxAdvanceDays))) return []
  if (q.locationId && !locationAllowed(ctx.site, q.locationId)) return []
  // Only coaches who offer this type can be asked for; anyone else matches nothing.
  if (q.staffId && !type.staff.some((s) => s.staff.id === q.staffId && s.staff.active)) return []
  const slots = await getSlots({ ownerId: ctx.ownerId, typeId: type.id, date: q.date, staffId: q.staffId, locationId: q.locationId, memberId: viewer?.member.id })
  return slots
    .map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, coaches: s.staff.filter((p) => locationAllowed(ctx.site, p.locationId) || ctx.site.locationIds.length === 0).map((p) => ({ id: p.id, name: p.name })) }))
    .filter((s) => s.coaches.length > 0)
}

// ---------------------------------------------------------------------------
// Becoming known: guests and new accounts
// ---------------------------------------------------------------------------

export const personSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  phone: z.string().trim().max(30).regex(/^[0-9+()\-.\s]*$/, 'Enter a valid phone number').nullish().transform((v) => v || null),
})

const findMember = (ownerId: string, email: string) => prisma.member.findFirst({ where: { ownerId, email: { equals: email, mode: 'insensitive' }, archivedAt: null }, include: { account: { select: { id: true } } } })

/**
 * A new person from the website: a member record that is not yet a paying member, marked as having
 * come from online booking. If the sales team already had them as a lead, the lead is closed onto
 * this record and its original source is kept.
 */
async function createOnlinePerson(ctx: SiteCtx, input: z.infer<typeof personSchema>) {
  const limit = await checkMemberLimit(ctx.ownerId)
  if (!limit.allowed) throw new ApiError(409, 'Online booking is not available right now. Please contact us and we will book you in.', 'unavailable')
  return prisma.$transaction(async (db) => {
    const lead = await db.prospect.findFirst({ where: { ownerId: ctx.ownerId, email: { equals: input.email, mode: 'insensitive' }, status: { not: 'converted' } }, orderBy: { createdAt: 'desc' } })
    const member = await createMember(db, ctx.ownerId, { name: input.name, email: input.email, phone: input.phone || lead?.phone || null, leadSource: lead?.source || LEAD_SOURCE, homeLocationId: lead?.locationId || null }, SYSTEM_ACTOR, { status: 'inactive' })
    if (lead) {
      await db.prospect.update({ where: { id: lead.id }, data: { status: 'converted', convertedAt: new Date(), convertedMemberId: member.id, nextFollowUpAt: null } })
      await logActivity(db, { ownerId: ctx.ownerId, prospectId: lead.id, type: 'lead_converted', title: 'Booked online and became a member record', actor: SYSTEM_ACTOR })
      await leadEvent(db, ctx.ownerId, 'lead.updated', lead.id)
    }
    return member
  }, { timeout: 15_000 })
}

/** One "continue" email per person per ten minutes, however many times the form is submitted. */
const lastLink = new Map<string, number>()
function mayEmail(memberId: string) {
  const now = Date.now()
  if (lastLink.size > 5000) for (const [k, at] of lastLink) if (now - at > 600_000) lastLink.delete(k)
  if (now - (lastLink.get(memberId) || 0) < 600_000) return false
  lastLink.set(memberId, now)
  return true
}

type LinkSender = (member: Member, kind: 'invite' | 'sign_in', token: string | null) => Promise<unknown>

/**
 * Someone we already know has to prove the address is theirs before they can act as that member.
 * With an account they sign in; without one they are sent the ordinary invitation to set a password.
 */
async function sendContinueLink(member: Member & { account: { id: string } | null }, send: LinkSender) {
  if (!mayEmail(member.id)) return
  if (member.account) return send(member, 'sign_in', null)
  const { token } = await createInvite(member.ownerId, member.id)
  return send(member, 'invite', token)
}

/**
 * Book as a guest: a name, an email and a phone, no password. Allowed only for an address this gym
 * has not seen. A known address gets an email instead, and the browser is told only to check it.
 */
export async function identifyGuest(ctx: SiteCtx, input: z.infer<typeof personSchema>, send: LinkSender): Promise<{ status: 'ok'; member: Member } | { status: 'check_email' }> {
  if (!ctx.site.allowGuests || ctx.site.requireAccount) throw new ApiError(403, 'Please sign in or create an account to book.', 'account_required')
  const existing = await findMember(ctx.ownerId, input.email)
  if (existing) {
    await sendContinueLink(existing, send)
    return { status: 'check_email' }
  }
  return { status: 'ok', member: await createOnlinePerson(ctx, input) }
}

/** Create an account. The answer is the same whoever the address belongs to: check your email. */
export async function startAccount(ctx: SiteCtx, input: z.infer<typeof personSchema>, send: LinkSender): Promise<{ status: 'check_email' }> {
  const existing = await findMember(ctx.ownerId, input.email)
  if (existing) {
    await sendContinueLink(existing, send)
    return { status: 'check_email' }
  }
  const member = await createOnlinePerson(ctx, input)
  await sendContinueLink({ ...member, account: null }, send)
  return { status: 'check_email' }
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

const reference = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase()
const firstName = (name: string) => name.split(' ')[0]

function assertMayBook(ctx: SiteCtx, viewer: Viewer) {
  if (ctx.site.requireAccount && !viewer.hasAccount) throw new ApiError(403, 'Please sign in or create an account to book.', 'account_required')
  if (!viewer.hasAccount && !ctx.site.allowGuests) throw new ApiError(403, 'Please sign in or create an account to book.', 'account_required')
}

/** The confirmation someone is shown, and can come back to through their manage link. */
export async function classConfirmation(ctx: SiteCtx, bookingId: string, memberId: string) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, ownerId: ctx.ownerId, memberId },
    include: { session: { include: { classType: { select: { name: true } }, coach: { select: { name: true } }, location: { select: { name: true, address: true, city: true } } } } },
  })
  if (!b) throw notFound('Booking')
  const s = b.session
  const now = new Date()
  const upcoming = ['booked', 'waitlisted', 'offered'].includes(b.status) && s.startsAt > now
  const late = s.startsAt.getTime() - now.getTime() < ctx.settings.cancelWindowHours * 3_600_000
  const position = b.status === 'waitlisted' && b.waitlistedAt ? await prisma.booking.count({ where: { sessionId: s.id, status: 'waitlisted', waitlistedAt: { lte: b.waitlistedAt } } }) : null
  return {
    kind: 'class' as const, id: b.id, reference: reference(b.id), status: b.status, waitlistPosition: position,
    name: s.title || s.classType.name, startsAt: s.startsAt, endsAt: s.endsAt, coach: s.coach?.name || null,
    location: [s.location?.name, s.room].filter(Boolean).join(' · ') || null, address: [s.location?.address, s.location?.city].filter(Boolean).join(', ') || null,
    payment: null as null | { label: string },
    can: { cancel: upcoming, cancelFree: upcoming && (b.status !== 'booked' || !late) },
    cancelNote: upcoming && b.status === 'booked' && late && ctx.settings.cancelWindowHours > 0 ? `Cancelling now is a late cancellation (inside ${ctx.settings.cancelWindowHours} hour${ctx.settings.cancelWindowHours === 1 ? '' : 's'} of the start)${b.creditUsed && ctx.settings.lateCancelUsesCredit ? ' and the class credit is not returned' : ''}.` : null,
    manageToken: await signManageToken({ ownerId: ctx.ownerId, memberId, kind: 'class', id: b.id }, s.endsAt),
  }
}

export async function appointmentConfirmation(ctx: SiteCtx, appointmentId: string, memberId: string) {
  const a = await prisma.appointment.findFirst({
    where: { id: appointmentId, ownerId: ctx.ownerId, memberId },
    include: { type: { select: { name: true } }, staff: { select: { name: true } }, location: { select: { name: true, address: true, city: true } }, invoice: { select: { status: true } } },
  })
  if (!a) throw notFound('Appointment')
  const now = new Date()
  const upcoming = a.status === 'booked' && a.startsAt > now
  const late = isLate(a, now)
  return {
    kind: 'appointment' as const, id: a.id, reference: reference(a.id), status: a.status, waitlistPosition: null,
    name: a.type.name, startsAt: a.startsAt, endsAt: a.endsAt, coach: a.staff.name,
    location: a.location?.name || null, address: [a.location?.address, a.location?.city].filter(Boolean).join(', ') || null,
    payment: a.paymentMode === 'paid' ? { label: `${formatMoney(a.priceCents, ctx.settings.currency)} ${a.invoice?.status === 'paid' ? 'paid' : 'due at the gym'}` } : a.paymentMode === 'credit' ? { label: `${a.creditsUsed} session${a.creditsUsed === 1 ? '' : 's'} used` } : null,
    can: { cancel: upcoming, cancelFree: upcoming && !late },
    cancelNote: upcoming && late && a.cancelWindowHours > 0 ? `Cancelling now is a late cancellation (inside ${a.cancelWindowHours} hour${a.cancelWindowHours === 1 ? '' : 's'} of the start), so the session or payment is not returned.` : null,
    manageToken: await signManageToken({ ownerId: ctx.ownerId, memberId, kind: 'appointment', id: a.id }, a.endsAt),
  }
}

type Confirmation = Awaited<ReturnType<typeof classConfirmation>> | Awaited<ReturnType<typeof appointmentConfirmation>>

/** The confirmation email, through the gym's ordinary message queue, with the link to come back to. */
async function emailConfirmation(ctx: SiteCtx, member: Member, c: Confirmation, origin: string, what: 'booked' | 'waitlisted' | 'cancelled') {
  const when = formatDateTime(c.startsAt, ctx.settings.timezone)
  const where = [c.location, c.address].filter(Boolean).join(', ')
  const link = `${origin}/book/${ctx.site.slug}/manage/${c.manageToken}`
  const subject = what === 'booked' ? `You're booked: ${c.name}, ${when}` : what === 'waitlisted' ? `You're on the waitlist: ${c.name}, ${when}` : `Cancelled: ${c.name}, ${when}`
  const lines = what === 'cancelled'
    ? [`Your booking for ${c.name} on ${when} has been cancelled.`, `Book again any time: ${origin}/book/${ctx.site.slug}`]
    : [
        what === 'booked' ? `You're booked for ${c.name} on ${when}${c.coach ? ` with ${c.coach}` : ''}.` : `You're on the waitlist for ${c.name} on ${when}${c.waitlistPosition ? ` (position ${c.waitlistPosition})` : ''}. We'll email you if a spot opens.`,
        where ? `Where: ${where}` : null,
        c.payment ? `Payment: ${c.payment.label}` : null,
        `Reference: ${c.reference}`,
        `View, add to your calendar or cancel: ${link}`,
        ctx.site.cancellationPolicy ? `Cancellation policy: ${ctx.site.cancellationPolicy}` : null,
      ]
  await prisma.$transaction((db) => queueMessage(db, {
    ownerId: ctx.ownerId, channel: 'email', memberId: member.id, transactional: true, subject,
    body: `Hi {{first_name}},\n\n${lines.filter(Boolean).join('\n\n')}\n\n${ctx.name}`,
    dedupeKey: `online:${c.kind}:${c.id}:${what}:${new Date(c.startsAt).getTime()}`,
  }))
  await flushOutbox(ctx.ownerId)
}

/**
 * Book a class, or join its waitlist. The booking engine takes the class's lock and decides, at
 * that moment, whether there is room and whether this person may have it: nothing the browser
 * believed about availability is used.
 */
export async function bookClassOnline(ctx: SiteCtx, viewer: Viewer, input: { classId: string; joinWaitlist?: boolean }, origin: string) {
  assertMayBook(ctx, viewer)
  const session = await publicSession(ctx, input.classId)
  if (session.startsAt.getTime() > Date.now() + advanceDays(ctx) * 86_400_000) throw new ApiError(422, 'Booking for this class is not open yet.', 'booking_not_open')
  const actor: ActorRef = { type: 'member', id: viewer.member.id, name: viewer.member.name }
  // Anything this class requires them to have signed. Refused with the list if not; the page lets them sign and carry on.
  await classDocumentsGate(ctx.ownerId, viewer.member.id, session.id)
  const result = await prisma.$transaction(async (db) => {
    const r = await bookClass(db, { ownerId: ctx.ownerId, memberId: viewer.member.id, sessionId: session.id, joinWaitlist: input.joinWaitlist === true, source: 'member', actor })
    await db.booking.update({ where: { id: r.booking.id }, data: { channel: ONLINE } })
    return r
  }, { timeout: 15_000 })
  const confirmation = await classConfirmation(ctx, result.booking.id, viewer.member.id)
  await emailConfirmation(ctx, viewer.member, confirmation, origin, result.booking.status === 'waitlisted' ? 'waitlisted' : 'booked').catch((error) => console.error('[online-booking] confirmation email failed:', error))
  return { ...confirmation, usedCredit: result.usedCredit }
}

/**
 * Book an appointment. The appointment engine re-checks the time, the coach, the notice period,
 * the member's sessions and the price; a paid type is charged to the saved card through the
 * gym's own processor, and a decline leaves no appointment behind.
 */
export async function bookAppointmentOnline(ctx: SiteCtx, viewer: Viewer, input: { typeId: string; startsAt: Date; staffId?: string | null; locationId?: string | null; notes?: string | null }, origin: string) {
  assertMayBook(ctx, viewer)
  const type = await publicAppointmentType(ctx, input.typeId)
  if ((type.paymentMode !== 'included' || type.requiredPlanIds.length > 0) && !viewer.hasAccount) throw new ApiError(403, 'Sign in or create an account to book this.', 'account_required')
  if (input.staffId && !type.staff.some((s) => s.staff.id === input.staffId && s.staff.active)) throw notFound('Coach')
  if (input.locationId && !locationAllowed(ctx.site, input.locationId)) throw notFound('Location')
  if (ctx.site.advanceDays && input.startsAt.getTime() > Date.now() + ctx.site.advanceDays * 86_400_000) throw new ApiError(422, 'That is further ahead than online booking allows.', 'too_far_ahead')
  const actor: ActorRef = { type: 'member', id: viewer.member.id, name: viewer.member.name }
  const result = await bookAppointment({ ownerId: ctx.ownerId, memberId: viewer.member.id, typeId: type.id, staffId: input.staffId, startsAt: input.startsAt, locationId: input.locationId, notes: input.notes, source: 'member', actor })
  await prisma.appointment.update({ where: { id: result.appointment.id }, data: { channel: ONLINE } })
  // A decline cancels the appointment and is reported as a 402: nothing is confirmed.
  const payment = await settleAppointmentPayment(ctx.ownerId, result.appointment.id, 'member', actor)
  const confirmation = await appointmentConfirmation(ctx, result.appointment.id, viewer.member.id)
  await emailConfirmation(ctx, viewer.member, confirmation, origin, 'booked').catch((error) => console.error('[online-booking] confirmation email failed:', error))
  return { ...confirmation, paymentStatus: payment.status }
}

/**
 * Start a plan from the page: a free trial for anyone who may book, or a paid plan or package for
 * someone signed in with a card saved. The sale and the charge are the ones staff and the member app use.
 */
export async function startPlanOnline(ctx: SiteCtx, viewer: Viewer, planId: string) {
  assertMayBook(ctx, viewer)
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, ownerId: ctx.ownerId, isActive: true, isPublic: true } })
  if (!plan) throw notFound('Plan')
  const free = plan.priceCents + plan.enrollmentFeeCents === 0
  if (!free && !viewer.hasAccount) throw new ApiError(403, 'Sign in or create an account to buy this.', 'account_required')
  // Only a one-off free plan can be taken without an account: nothing that will ever bill.
  if (!viewer.hasAccount && plan.type === 'recurring') throw new ApiError(403, 'Sign in or create an account to start this membership.', 'account_required')
  const { membership, payment } = await buyPlanWithSavedMethod({ ownerId: ctx.ownerId, memberId: viewer.member.id, planId: plan.id, types: ['recurring', 'class_pack', 'drop_in', 'trial', 'free', 'pt_package'], actor: { type: 'member', id: viewer.member.id, name: viewer.member.name }, what: plan.type === 'pt_package' ? 'package' : 'plan' })
  return { name: plan.name, status: membership.status, creditsRemaining: membership.creditsRemaining, payment }
}

// ---------------------------------------------------------------------------
// Coming back: my bookings, the manage link, cancelling
// ---------------------------------------------------------------------------

/** What this person has coming up at this gym. */
export async function myUpcoming(ctx: SiteCtx, viewer: Viewer) {
  const now = new Date()
  const [bookings, appointments] = await Promise.all([
    prisma.booking.findMany({ where: { ownerId: ctx.ownerId, memberId: viewer.member.id, status: { in: ['booked', 'waitlisted', 'offered'] }, session: { startsAt: { gt: now } } }, orderBy: { session: { startsAt: 'asc' } }, take: 20, select: { id: true } }),
    prisma.appointment.findMany({ where: { ownerId: ctx.ownerId, memberId: viewer.member.id, status: 'booked', startsAt: { gt: now } }, orderBy: { startsAt: 'asc' }, take: 20, select: { id: true } }),
  ])
  const all = await Promise.all([...bookings.map((b) => classConfirmation(ctx, b.id, viewer.member.id)), ...appointments.map((a) => appointmentConfirmation(ctx, a.id, viewer.member.id))])
  return all.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
}

/** What a manage link shows. The link names one booking; it must belong to the gym whose page it is opened on. */
export async function manageView(ctx: SiteCtx, ref: ManageRef) {
  if (ref.ownerId !== ctx.ownerId) throw notFound('Booking')
  return ref.kind === 'class' ? classConfirmation(ctx, ref.id, ref.memberId) : appointmentConfirmation(ctx, ref.id, ref.memberId)
}

/**
 * Cancel, as the customer. The engines apply the gym's cancellation window, return or keep the
 * credit or payment accordingly, and move the waitlist up. Nothing can be waived from here.
 */
export async function cancelOnline(ctx: SiteCtx, who: { memberId: string }, kind: 'class' | 'appointment', id: string, origin: string) {
  const member = await prisma.member.findFirst({ where: { id: who.memberId, ownerId: ctx.ownerId } })
  if (!member) throw notFound('Booking')
  const actor: ActorRef = { type: 'member', id: member.id, name: member.name }
  if (kind === 'class') {
    const owned = await prisma.booking.findFirst({ where: { id, ownerId: ctx.ownerId, memberId: member.id }, select: { id: true } })
    if (!owned) throw notFound('Booking')
    const result = await prisma.$transaction((db) => cancelBooking(db, { ownerId: ctx.ownerId, bookingId: owned.id, by: 'member', actor }), { timeout: 15_000 })
    const confirmation = await classConfirmation(ctx, owned.id, member.id)
    await emailConfirmation(ctx, member, confirmation, origin, 'cancelled').catch(() => {})
    return { ...confirmation, late: result.late, creditReturned: result.creditReturned }
  }
  const result = await cancelAppointment({ ownerId: ctx.ownerId, appointmentId: id, by: 'member', memberId: member.id, actor })
  const confirmation = await appointmentConfirmation(ctx, result.appointment.id, member.id)
  await emailConfirmation(ctx, member, confirmation, origin, 'cancelled').catch(() => {})
  return { ...confirmation, late: result.late, creditReturned: result.creditsReturned, refunded: result.refunded }
}

/** An .ics file for one booking. */
export function calendarFile(ctx: SiteCtx, c: Confirmation) {
  const stamp = (d: Date) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClubCheck//Online Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${c.id}@clubcheck`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(c.startsAt)}`, `DTEND:${stamp(c.endsAt)}`,
    `SUMMARY:${escape(`${c.name} at ${ctx.name}`)}`, `LOCATION:${escape([ctx.name, c.location, c.address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${escape([c.coach ? `With ${c.coach}` : null, `Reference ${c.reference}`].filter(Boolean).join('. '))}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}

// ---------------------------------------------------------------------------
// For the gym: how online booking is doing
// ---------------------------------------------------------------------------

export async function bookingStats(ownerId: string, days = 30) {
  const settings = await getGymSettings(ownerId)
  const now = new Date()
  const since = new Date(now.getTime() - days * 86_400_000)
  const [classes, appointments, visits, upcomingClasses, upcomingAppointments, people] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: { ownerId, channel: ONLINE, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ['status'], where: { ownerId, channel: ONLINE, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.bookingSiteDaily.aggregate({ where: { ownerId, day: { gte: new Date(since.getTime() - 86_400_000) } }, _sum: { visits: true } }),
    prisma.booking.findMany({ where: { ownerId, channel: ONLINE, status: { in: ['booked', 'waitlisted', 'offered'] }, session: { startsAt: { gt: now } } }, orderBy: { session: { startsAt: 'asc' } }, take: 15, include: { member: { select: { id: true, name: true } }, session: { select: { startsAt: true, title: true, classType: { select: { name: true } } } } } }),
    prisma.appointment.findMany({ where: { ownerId, channel: ONLINE, status: 'booked', startsAt: { gt: now } }, orderBy: { startsAt: 'asc' }, take: 15, include: { member: { select: { id: true, name: true } }, type: { select: { name: true } }, staff: { select: { name: true } } } }),
    prisma.member.count({ where: { ownerId, leadSource: LEAD_SOURCE, createdAt: { gte: since } } }),
  ])
  const count = (rows: { status: string; _count: { _all: number } }[], statuses?: string[]) => rows.filter((r) => !statuses || statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0)
  const bookings = count(classes) + count(appointments)
  const waitlist = count(classes, ['waitlisted'])
  const cancellations = count(classes, ['cancelled', 'late_cancelled']) + count(appointments, ['cancelled', 'late_cancelled'])
  const seen = visits._sum.visits || 0
  return {
    days, timezone: settings.timezone,
    visits: seen, bookings, classBookings: count(classes), appointmentBookings: count(appointments), cancellations, waitlistJoins: waitlist, newPeople: people,
    // Bookings per hundred visits. A visit is a load of the page, not a person, so this is a rough guide.
    conversionPercent: seen > 0 ? Math.round((bookings / seen) * 1000) / 10 : null,
    upcoming: [
      ...upcomingClasses.map((b) => ({ kind: 'class' as const, id: b.id, name: b.session.title || b.session.classType.name, startsAt: b.session.startsAt, status: b.status, member: b.member, with: null as string | null })),
      ...upcomingAppointments.map((a) => ({ kind: 'appointment' as const, id: a.id, name: a.type.name, startsAt: a.startsAt, status: a.status, member: a.member, with: a.staff.name })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 20),
  }
}

export { firstName }
