// Appointments: one-to-one sessions between a member and a staff member.
//
// Three rules hold this file together:
//
//  1. Availability is computed, never assumed. A slot is offered only if it is
//     inside the staff member's working hours, outside their breaks and time
//     off, clear of their other appointments and the classes they coach, inside
//     the type's booking window, and clear of the member's own commitments.
//
//  2. Double booking is impossible at the database, not just checked in code.
//     A live appointment holds a TimeClaim row for every five-minute slot it
//     covers, once for the staff member and once for the member. The unique
//     index on (resource, slot) rejects a second claim, so of two simultaneous
//     requests exactly one commits.
//
//  3. Money and credits move once. Credits are spent in the same transaction
//     that creates the appointment; rescheduling never touches them; cancelling
//     returns them only when the type's cancellation window allows.
//
// Times are stored in UTC. Working hours are minutes from midnight in the
// gym's timezone and are converted per date, so they survive daylight saving.

import { Prisma } from '@prisma/client'
import type { Appointment, AppointmentType, Member, Staff } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, conflict, notFound } from '@/lib/api'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { formatDateTime, formatMoney, formatTime, normalizeMemberStatus } from '@/lib/format'
import { ActorRef, Db, GymSettings, SYSTEM, getGymSettings, lockRow, logActivity, notify } from './core'
import { appointmentEvent } from './events'
import { returnCredits, spendCredits } from './credits'
import { createInvoice, voidInvoice } from './payments'
import { notifyMember } from './member-notifications'
import { memberBusy } from './conflicts'
import { ensureSessions } from './classes'

export const GRID_MIN = 5
const MIN = 60_000
/** Statuses that occupy the staff member's and the member's time. */
export const HOLDING = ['booked', 'completed']
export const PAYMENT_MODES = ['included', 'credit', 'paid'] as const
export const TIME_OFF_KINDS = ['vacation', 'personal', 'holiday', 'other'] as const

const rule = (code: string, message: string, details?: unknown) => new ApiError(422, message, code, details)

interface Interval {
  start: number
  end: number
}
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

const pad = (n: number) => String(n).padStart(2, '0')
/** A gym-local time of day on a gym-local date, as a UTC instant. 1440 means midnight at the end of the day. */
function at(date: string, minute: number, tz: string) {
  if (minute >= 1440) return zonedToUtc(addDaysToDate(date, 1), '00:00', tz).getTime()
  return zonedToUtc(date, `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`, tz).getTime()
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

interface Window extends Interval {
  locationId: string | null
}

/** Working hours for one staff member on one date, with breaks cut out. */
async function workingWindows(db: Db, ownerId: string, staffId: string, date: string, tz: string): Promise<Window[]> {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const rows = await db.staffAvailability.findMany({ where: { ownerId, staffId, weekday }, orderBy: { startMinute: 'asc' } })
  let windows: Window[] = rows
    .filter((r) => r.kind === 'work' && r.endMinute > r.startMinute)
    .map((r) => ({ start: at(date, r.startMinute, tz), end: at(date, r.endMinute, tz), locationId: r.locationId }))
  for (const b of rows.filter((r) => r.kind === 'break')) {
    const cut = { start: at(date, b.startMinute, tz), end: at(date, b.endMinute, tz) }
    windows = windows.flatMap((w) => {
      if (!overlaps(w, cut)) return [w]
      const parts: Window[] = []
      if (cut.start > w.start) parts.push({ ...w, end: cut.start })
      if (cut.end < w.end) parts.push({ ...w, start: cut.end })
      return parts
    })
  }
  return windows
}

/** Everything that already occupies a staff member between two instants. */
async function staffBusy(db: Db, ownerId: string, staffId: string, from: Date, to: Date, ignoreAppointmentId?: string) {
  const [appointments, classes, timeOff] = await Promise.all([
    db.appointment.findMany({
      where: { ownerId, staffId, status: { in: HOLDING }, startsAt: { lt: to }, endsAt: { gt: from }, ...(ignoreAppointmentId && { id: { not: ignoreAppointmentId } }) },
      select: { startsAt: true, endsAt: true },
    }),
    db.classSession.findMany({ where: { ownerId, coachId: staffId, status: 'scheduled', startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true, title: true, classType: { select: { name: true } } } }),
    db.staffTimeOff.findMany({ where: { ownerId, staffId, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
  ])
  return {
    appointments: appointments.map((a) => ({ start: a.startsAt.getTime(), end: a.endsAt.getTime() })),
    classes: classes.map((c) => ({ start: c.startsAt.getTime(), end: c.endsAt.getTime(), name: c.title || c.classType.name })),
    timeOff: timeOff.map((t) => ({ start: t.startsAt.getTime(), end: t.endsAt.getTime() })),
  }
}

/** The location an appointment in this window would take place at, or false if it cannot. */
function resolveLocation(type: Pick<AppointmentType, 'locationIds'>, window: Window, requested: string | null | undefined, staffLocationId: string | null): string | null | false {
  if (requested && window.locationId && window.locationId !== requested) return false
  const location = window.locationId || requested || (staffLocationId && (type.locationIds.length === 0 || type.locationIds.includes(staffLocationId)) ? staffLocationId : null) || (type.locationIds.length === 1 ? type.locationIds[0] : null)
  if (type.locationIds.length > 0 && (!location || !type.locationIds.includes(location))) return false
  return location
}

export interface Slot {
  startsAt: Date
  endsAt: Date
  staff: { id: string; name: string; locationId: string | null }[]
}

export interface SlotQuery {
  ownerId: string
  typeId: string
  /** YYYY-MM-DD in the gym's timezone. */
  date: string
  staffId?: string | null
  locationId?: string | null
  /** Hide times that clash with this member's own appointments and classes. */
  memberId?: string | null
  /** Rescheduling: the appointment being moved does not block its own new time. */
  ignoreAppointmentId?: string
  /** Staff may book inside the minimum notice or beyond the advance limit; members may not. */
  ignoreBookingWindow?: boolean
  now?: Date
}

/**
 * Bookable start times for an appointment type on a date, each with the staff
 * who are genuinely free for the whole duration.
 */
export async function getSlots(query: SlotQuery, db: Db = prisma): Promise<Slot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw badRequest('Choose a valid date.')
  const [type, settings] = await Promise.all([
    db.appointmentType.findFirst({ where: { id: query.typeId, ownerId: query.ownerId }, include: { staff: { include: { staff: { select: { id: true, name: true, active: true, locationId: true } } } } } }),
    getGymSettings(query.ownerId, db),
  ])
  if (!type) throw notFound('Appointment type')
  const tz = settings.timezone
  const now = (query.now || new Date()).getTime()
  const duration = type.durationMin * MIN
  const step = Math.max(GRID_MIN, type.slotIntervalMin) * MIN
  const earliest = query.ignoreBookingWindow ? now : now + type.minNoticeMinutes * MIN
  const latest = query.ignoreBookingWindow ? Infinity : now + type.maxAdvanceDays * 86_400_000
  const dayStart = new Date(at(query.date, 0, tz))
  const dayEnd = new Date(at(query.date, 1440, tz))
  if (dayEnd.getTime() <= earliest || dayStart.getTime() > latest) return []
  // Recurring classes are generated lazily. Make sure this day's exist before deciding who is free,
  // so an appointment can never be booked into a slot a class was always going to occupy.
  if (db === prisma) await ensureSessions(query.ownerId, dayEnd, new Date(), true)

  const staff = type.staff.map((s) => s.staff).filter((s) => s.active && (!query.staffId || s.id === query.staffId))
  const mine = query.memberId ? await memberBusy(db, query.ownerId, query.memberId, dayStart, dayEnd, { appointmentId: query.ignoreAppointmentId }) : null
  const memberBlocks = mine ? [...mine.appointments, ...mine.classes] : []

  const byStart = new Map<number, Slot>()
  for (const person of staff) {
    const [windows, busy] = await Promise.all([
      workingWindows(db, query.ownerId, person.id, query.date, tz),
      staffBusy(db, query.ownerId, person.id, dayStart, dayEnd, query.ignoreAppointmentId),
    ])
    const blocks = [...busy.appointments, ...busy.classes, ...busy.timeOff]
    for (const window of windows) {
      const location = resolveLocation(type, window, query.locationId, person.locationId)
      if (location === false) continue
      for (let start = window.start; start + duration <= window.end; start += step) {
        if (start < earliest || start > latest) continue
        const candidate = { start, end: start + duration }
        if (blocks.some((b) => overlaps(candidate, b)) || memberBlocks.some((b) => overlaps(candidate, b))) continue
        const slot = byStart.get(start) || { startsAt: new Date(start), endsAt: new Date(start + duration), staff: [] }
        if (!slot.staff.some((s) => s.id === person.id)) slot.staff.push({ id: person.id, name: person.name, locationId: location })
        byStart.set(start, slot)
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

// ---------------------------------------------------------------------------
// Claims: the database guarantee
// ---------------------------------------------------------------------------

function claimRows(ownerId: string, appointmentId: string, staffId: string, memberId: string, startsAt: Date, endsAt: Date) {
  const rows: Prisma.TimeClaimCreateManyInput[] = []
  for (let t = startsAt.getTime(); t < endsAt.getTime(); t += GRID_MIN * MIN) {
    const slot = new Date(t)
    rows.push({ ownerId, appointmentId, resource: `staff:${staffId}`, slot }, { ownerId, appointmentId, resource: `member:${memberId}`, slot })
  }
  return rows
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
const taken = () => conflict('That time has just been taken. Please choose another.', 'slot_taken')

/** Run a booking transaction, turning a lost race on the claim index into a clear 409. */
async function claimTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, { timeout: 20_000 })
  } catch (error) {
    if (isUniqueViolation(error)) throw taken()
    // Two requests locking the same rows in opposite order: one is rolled back by Postgres.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || /deadlock/i.test(error.message))) throw taken()
    throw error
  }
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export interface BookAppointmentInput {
  ownerId: string
  typeId: string
  memberId: string
  /** Null means "any available": the service picks the free staff member with the lightest day. */
  staffId?: string | null
  startsAt: Date
  locationId?: string | null
  notes?: string | null
  source: 'member' | 'staff'
  /** Staff only: book inside the minimum notice, beyond the advance limit, or outside working hours. Never overrides a clash. */
  override?: boolean
  actor?: ActorRef
}

const onGrid = (d: Date) => d.getTime() % (GRID_MIN * MIN) === 0

/** Throws unless this exact start is free for this staff member (and this member). */
async function assertBookable(db: Db, input: { ownerId: string; type: AppointmentType; staff: Pick<Staff, 'id' | 'name' | 'locationId'>; member: Pick<Member, 'id' | 'name'>; startsAt: Date; locationId?: string | null; override?: boolean; ignoreAppointmentId?: string; settings: GymSettings; viaStaff: boolean }) {
  const { type, staff, member, startsAt, settings } = input
  const endsAt = new Date(startsAt.getTime() + type.durationMin * MIN)
  if (!onGrid(startsAt)) throw rule('off_grid', 'Appointments start on five-minute marks.')
  const who = input.viaStaff ? staff.name : 'Your coach'
  const whoMember = input.viaStaff ? member.name : 'You'

  // Clashes are checked for everyone, override or not.
  const [busy, mine] = await Promise.all([
    staffBusy(db, input.ownerId, staff.id, startsAt, endsAt, input.ignoreAppointmentId),
    memberBusy(db, input.ownerId, member.id, startsAt, endsAt, { appointmentId: input.ignoreAppointmentId }),
  ])
  if (busy.appointments.length) throw conflict(`${who} already has an appointment at that time.`, 'slot_taken')
  if (busy.classes.length) throw conflict(`${who} is teaching ${busy.classes[0].name} at that time.`, 'staff_teaching')
  if (mine.appointments.length) throw conflict(`${whoMember} already ${input.viaStaff ? 'has' : 'have'} an appointment at that time.`, 'member_busy')
  if (mine.classes.length) throw conflict(`${whoMember} ${input.viaStaff ? 'is' : 'are'} booked into ${mine.classes[0].name} at that time.`, 'member_in_class')

  const date = zonedParts(startsAt, settings.timezone).date
  if (input.override) {
    if (busy.timeOff.length) throw conflict(`${staff.name} is off at that time.`, 'staff_off')
    const location = input.locationId || staff.locationId || (type.locationIds.length === 1 ? type.locationIds[0] : null)
    if (type.locationIds.length > 0 && (!location || !type.locationIds.includes(location))) throw rule('location_not_offered', `${type.name} is not offered at that location.`)
    return { endsAt, locationId: location }
  }
  const slots = await getSlots({ ownerId: input.ownerId, typeId: type.id, date, staffId: staff.id, locationId: input.locationId, memberId: member.id, ignoreAppointmentId: input.ignoreAppointmentId, ignoreBookingWindow: false }, db)
  const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime())
  if (!slot) throw rule('slot_unavailable', 'That time is not available. Please choose another.')
  return { endsAt, locationId: slot.staff[0].locationId }
}

/** Which membership (if any) pays for this appointment, checked against the type's requirements. */
async function eligibleMembership(db: Db, ownerId: string, member: Member, type: AppointmentType, startsAt: Date, viaStaff: boolean) {
  if (member.archivedAt) throw rule('member_archived', `${member.name} is archived.`)
  const status = normalizeMemberStatus(member.status)
  if (['frozen', 'cancelled'].includes(status)) throw rule(`member_${status}`, viaStaff ? `${member.name}'s membership is ${status}.` : `Your membership is ${status}, so appointments are paused.`)
  if (type.paymentMode !== 'credit' && type.requiredPlanIds.length === 0) return null

  const memberships = await db.membership.findMany({
    where: { ownerId, memberId: member.id, status: { in: ['active', 'trial'] }, startDate: { lte: startsAt }, OR: [{ endDate: null }, { endDate: { gte: startsAt } }] },
    include: { plan: true },
  })
  const allowed = memberships.filter((m) => (type.requiredPlanIds.length === 0 ? (type.paymentMode === 'credit' ? m.plan.type === 'pt_package' : true) : type.requiredPlanIds.includes(m.planId)) && (!m.cancelAt || m.cancelAt > startsAt))
  if (allowed.length === 0) {
    throw rule(type.paymentMode === 'credit' ? 'no_package' : 'membership_required', type.paymentMode === 'credit'
      ? (viaStaff ? `${member.name} has no session package for ${type.name}. Sell one first.` : `You need a session package to book ${type.name}.`)
      : (viaStaff ? `${member.name}'s membership does not include ${type.name}.` : `Your membership does not include ${type.name}.`))
  }
  if (type.paymentMode !== 'credit') return allowed[0]
  // Spend the credits that expire soonest.
  const funded = allowed.filter((m) => (m.creditsRemaining ?? 0) >= type.creditsRequired).sort((a, b) => (a.endDate?.getTime() ?? Infinity) - (b.endDate?.getTime() ?? Infinity))
  if (funded.length === 0) throw rule('insufficient_credits', viaStaff ? `${member.name} has no sessions left on ${allowed[0].plan.name}.` : `You have no sessions left on ${allowed[0].plan.name}.`)
  return funded[0]
}

async function loadParties(db: Db, input: { ownerId: string; typeId: string; memberId: string; staffId: string; requireActiveType: boolean }) {
  const [type, member, staff, offered] = await Promise.all([
    db.appointmentType.findFirst({ where: { id: input.typeId, ownerId: input.ownerId } }),
    db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } }),
    db.staff.findFirst({ where: { id: input.staffId, ownerId: input.ownerId, active: true } }),
    db.appointmentTypeStaff.findFirst({ where: { typeId: input.typeId, staffId: input.staffId, ownerId: input.ownerId } }),
  ])
  if (!type || (input.requireActiveType && !type.isActive)) throw notFound('Appointment type')
  if (!member) throw notFound('Member')
  if (!staff) throw notFound('Staff member')
  if (!offered) throw rule('staff_not_offering', `${staff.name} does not offer ${type.name}.`)
  return { type, member, staff }
}

async function announce(db: Db, kind: 'booked' | 'cancelled' | 'late_cancelled' | 'rescheduled' | 'no_show' | 'completed', a: Appointment, names: { type: string; staff: string; member: string }, tz: string, actor: ActorRef | undefined, extra?: string) {
  const when = formatDateTime(a.startsAt, tz)
  const title = {
    booked: `Booked ${names.type} with ${names.staff}`,
    cancelled: `Cancelled ${names.type} with ${names.staff}`,
    late_cancelled: `Late cancellation: ${names.type} with ${names.staff}`,
    rescheduled: `Rescheduled ${names.type} with ${names.staff}`,
    no_show: `Missed ${names.type} with ${names.staff}`,
    completed: `Attended ${names.type} with ${names.staff}`,
  }[kind]
  await logActivity(db, { ownerId: a.ownerId, memberId: a.memberId, type: `appointment_${kind}`, title, detail: extra ? `${when} · ${extra}` : when, metadata: { appointmentId: a.id, staffId: a.staffId }, actor })
  // The coach hears about anything they did not do themselves.
  if (kind !== 'completed' && !(actor && actor.type === 'staff' && actor.id === a.staffId)) {
    const staffTitle = { booked: 'New appointment', cancelled: 'Appointment cancelled', late_cancelled: 'Late cancellation', rescheduled: 'Appointment moved', no_show: 'No-show recorded', completed: '' }[kind]
    await notify(db, { ownerId: a.ownerId, type: 'appointment', title: `${staffTitle}: ${names.member}`, body: `${names.type} · ${when}`, href: `/appointments?open=${a.id}`, staffId: a.staffId })
  }
  if (kind !== 'completed') {
    const { fireTrigger, scheduleTimedRuns, cancelTimedRuns } = await import('./automations')
    const context = { appointment_name: names.type, appointment_type: names.type, coach_name: names.staff, coach: names.staff, appointment_time: when, time: when, appointment_clock: formatTime(a.startsAt, tz) }
    await fireTrigger(db, a.ownerId, `appointment_${kind === 'late_cancelled' ? 'cancelled' : kind}`, { memberId: a.memberId, dedupeKey: `appt:${a.id}:${kind}:${a.startsAt.getTime()}`, context })
    // Reminders are timed against the start: set them when it is booked or moved, withdraw them when it is off.
    await cancelTimedRuns(db, a.ownerId, `appt:${a.id}`)
    if (kind === 'booked' || kind === 'rescheduled') await scheduleTimedRuns(db, a.ownerId, { key: `appt:${a.id}`, memberId: a.memberId, startsAt: a.startsAt, context })
  }
}

/** Book an appointment. Owns its transaction so a lost race surfaces as a 409 rather than a raw database error. */
export async function bookAppointment(input: BookAppointmentInput) {
  // A member booking for themselves must have signed whatever this kind of appointment requires.
  if (input.source === 'member') {
    const { requireDocuments } = await import('./documents')
    await requireDocuments(input.ownerId, input.memberId, { trigger: 'appointment_booking', appointmentTypeId: input.typeId })
  }
  const viaStaff = input.source === 'staff'
  let staffId = input.staffId || null
  const settings = await getGymSettings(input.ownerId)

  if (!staffId) {
    // "Any available": whoever is free at that time, preferring the one with the fewest appointments that day.
    const date = zonedParts(input.startsAt, settings.timezone).date
    const slots = await getSlots({ ownerId: input.ownerId, typeId: input.typeId, date, locationId: input.locationId, memberId: input.memberId, ignoreBookingWindow: viaStaff && input.override })
    const slot = slots.find((s) => s.startsAt.getTime() === input.startsAt.getTime())
    if (!slot) throw rule('slot_unavailable', 'That time is not available. Please choose another.')
    const dayStart = new Date(at(date, 0, settings.timezone))
    const dayEnd = new Date(at(date, 1440, settings.timezone))
    const loads = await prisma.appointment.groupBy({ by: ['staffId'], where: { ownerId: input.ownerId, staffId: { in: slot.staff.map((s) => s.id) }, status: { in: HOLDING }, startsAt: { gte: dayStart, lt: dayEnd } }, _count: { _all: true } })
    const load = (id: string) => loads.find((l) => l.staffId === id)?._count._all || 0
    staffId = [...slot.staff].sort((a, b) => load(a.id) - load(b.id) || a.name.localeCompare(b.name))[0].id
  }
  const chosen = staffId
  await ensureSessions(input.ownerId, new Date(input.startsAt.getTime() + 86_400_000), new Date(), true)

  const result = await claimTransaction(async (db) => {
    // Serialize on the staff member and the member, always in the same order.
    await lockRow(db, 'Staff', chosen)
    await lockRow(db, 'Member', input.memberId)
    const { type, member, staff } = await loadParties(db, { ownerId: input.ownerId, typeId: input.typeId, memberId: input.memberId, staffId: chosen, requireActiveType: true })
    if (!viaStaff && !type.memberBookable) throw rule('not_bookable_online', `${type.name} is booked through the front desk.`)
    const { endsAt, locationId } = await assertBookable(db, { ownerId: input.ownerId, type, staff, member, startsAt: input.startsAt, locationId: input.locationId, override: viaStaff && input.override, settings, viaStaff })
    const membership = await eligibleMembership(db, input.ownerId, member, type, input.startsAt, viaStaff)

    let creditsUsed = 0
    if (type.paymentMode === 'credit' && membership) {
      await spendCredits(db, membership, type.creditsRequired)
      creditsUsed = type.creditsRequired
    }
    let invoiceId: string | null = null
    if (type.paymentMode === 'paid' && type.priceCents > 0) {
      const invoice = await createInvoice(db, {
        ownerId: input.ownerId, memberId: member.id, dueDate: new Date(),
        items: [{ description: `${type.name} with ${staff.name} · ${formatDateTime(input.startsAt, settings.timezone)}`, type: 'appointment', unitPriceCents: type.priceCents, taxRateBps: type.taxRateBps || settings.defaultTaxRateBps }],
        actor: input.actor,
      })
      invoiceId = invoice.id
    }

    const appointment = await db.appointment.create({
      data: {
        ownerId: input.ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, locationId, startsAt: input.startsAt, endsAt,
        paymentMode: type.paymentMode, priceCents: type.paymentMode === 'paid' ? type.priceCents : 0, cancelWindowHours: type.cancelWindowHours,
        membershipId: membership?.id || null, creditsUsed, invoiceId, source: input.source, bookedByName: input.actor?.name || null, notes: input.notes || null,
      },
    })
    // The unique index on (resource, slot) is what makes a double booking impossible.
    await db.timeClaim.createMany({ data: claimRows(input.ownerId, appointment.id, staff.id, member.id, input.startsAt, endsAt) })
    const remaining = creditsUsed && membership ? (membership.creditsRemaining ?? 0) - creditsUsed : null
    await announce(db, 'booked', appointment, { type: type.name, staff: staff.name, member: member.name }, settings.timezone, input.actor, remaining !== null ? `${remaining} session${remaining === 1 ? '' : 's'} remaining` : undefined)
    await appointmentEvent(db, input.ownerId, 'appointment.created', appointment.id)
    return { appointment, type, staff, member, creditsRemaining: remaining }
  })

  const { flushOutbox } = await import('./automations')
  await flushOutbox(input.ownerId)
  return result
}

/**
 * Collect payment for a paid appointment after it is booked. A member booking
 * online must pay: if the charge is declined the appointment is released.
 * Staff bookings keep the invoice open to settle at the desk.
 */
export async function settleAppointmentPayment(ownerId: string, appointmentId: string, source: 'member' | 'staff', actor?: ActorRef) {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, ownerId }, select: { invoiceId: true } })
  if (!appointment?.invoiceId) return { status: 'none' as const, message: null as string | null }
  const { collectInvoice } = await import('./collections')
  const charge = await collectInvoice({ ownerId, invoiceId: appointment.invoiceId, actor }).catch((error) => ({ status: 'failed' as const, message: error instanceof Error ? error.message : 'The payment could not be attempted.' }))
  if (charge.status === 'succeeded' || charge.status === 'processing') return { status: charge.status, message: charge.message || null }
  if (charge.status === 'failed' && source === 'member') {
    await cancelAppointment({ ownerId, appointmentId, by: 'staff', waive: true, reason: 'Payment declined', actor: SYSTEM, silent: true })
    throw new ApiError(402, `${charge.message || 'Your payment was declined.'} The appointment was not booked.`, 'payment_failed')
  }
  // Not connected, or no card on file: the invoice stays open to pay at the desk.
  return { status: 'due' as const, message: charge.message || null }
}

// ---------------------------------------------------------------------------
// Cancelling, rescheduling, attendance
// ---------------------------------------------------------------------------

async function loadAppointment(db: Db, ownerId: string, id: string, memberId?: string) {
  const appointment = await db.appointment.findFirst({ where: { id, ownerId, ...(memberId && { memberId }) }, include: { type: true, staff: { select: { id: true, name: true, locationId: true } }, member: true } })
  if (!appointment) throw notFound('Appointment')
  return appointment
}

/** Is it too late to cancel or move this appointment without losing the credit or payment? */
export function isLate(appointment: Pick<Appointment, 'startsAt' | 'cancelWindowHours'>, now = new Date()) {
  return appointment.startsAt.getTime() - now.getTime() < appointment.cancelWindowHours * 3_600_000
}

export interface CancelAppointmentInput {
  ownerId: string
  appointmentId: string
  by: 'member' | 'staff'
  /** Limits the lookup to this member's own appointments. */
  memberId?: string
  reason?: string | null
  /** Staff only: return the credit or payment even inside the cancellation window. */
  waive?: boolean
  actor?: ActorRef
  /** Internal clean-up (a declined payment): no timeline entry or notifications. */
  silent?: boolean
}

export async function cancelAppointment(input: CancelAppointmentInput) {
  const settings = await getGymSettings(input.ownerId)
  const outcome = await prisma.$transaction(async (db) => {
    const found = await loadAppointment(db, input.ownerId, input.appointmentId, input.memberId)
    await lockRow(db, 'Appointment', found.id)
    const a = await db.appointment.findUniqueOrThrow({ where: { id: found.id } })
    if (a.status !== 'booked') throw rule('not_cancellable', a.status === 'completed' ? 'This appointment has already taken place.' : 'This appointment is already cancelled.')
    const now = new Date()
    if (input.by === 'member' && now >= a.startsAt) throw rule('already_started', 'This appointment has already started and can no longer be cancelled.')
    const late = isLate(a, now) && !(input.by === 'staff' && input.waive)

    let creditsReturned = false
    if (!late && a.creditsUsed > 0 && a.membershipId) {
      await returnCredits(db, a.membershipId, a.creditsUsed)
      creditsReturned = true
    }
    let refundInvoiceId: string | null = null
    if (!late && a.invoiceId) {
      const invoice = await db.invoice.findUnique({ where: { id: a.invoiceId } })
      if (invoice && invoice.amountPaidCents > 0) refundInvoiceId = invoice.id
      else if (invoice && invoice.status === 'open') await voidInvoice(db, input.ownerId, invoice.id)
    }
    const updated = await db.appointment.update({
      where: { id: a.id },
      data: { status: late ? 'late_cancelled' : 'cancelled', cancelledAt: now, cancelledBy: input.by, cancelReason: input.reason || null, creditsReturned },
    })
    await db.timeClaim.deleteMany({ where: { appointmentId: a.id } })
    if (!input.silent) {
      const note = late ? (a.creditsUsed ? 'session not returned' : a.invoiceId ? 'no refund' : undefined) : creditsReturned ? 'session returned' : refundInvoiceId ? 'payment refunded' : undefined
      await announce(db, late ? 'late_cancelled' : 'cancelled', updated, { type: found.type.name, staff: found.staff.name, member: found.member.name }, settings.timezone, input.actor, note)
    }
    await appointmentEvent(db, input.ownerId, 'appointment.cancelled', updated.id)
    return { appointment: updated, late, creditsReturned, refundInvoiceId }
  }, { timeout: 20_000 })

  // Money goes back through the processor, which must not be called inside the transaction.
  let refunded = false
  if (outcome.refundInvoiceId) {
    const { refundPayment } = await import('./collections')
    const payments = await prisma.transaction.findMany({ where: { ownerId: input.ownerId, invoiceId: outcome.refundInvoiceId, type: 'payment', status: 'succeeded' } })
    for (const payment of payments) {
      if (payment.amountCents - payment.refundedCents <= 0) continue
      await refundPayment({ ownerId: input.ownerId, transactionId: payment.id, reason: 'Appointment cancelled', actor: input.actor })
      refunded = true
    }
  }
  const { flushOutbox } = await import('./automations')
  await flushOutbox(input.ownerId)
  return { appointment: outcome.appointment, late: outcome.late, creditsReturned: outcome.creditsReturned, refunded }
}

export interface RescheduleInput {
  ownerId: string
  appointmentId: string
  startsAt: Date
  /** Keep the same coach unless another is named. */
  staffId?: string | null
  by: 'member' | 'staff'
  memberId?: string
  override?: boolean
  actor?: ActorRef
}

/** Move an appointment. The credit or payment it was booked with travels with it; nothing is charged or returned. */
export async function rescheduleAppointment(input: RescheduleInput) {
  const settings = await getGymSettings(input.ownerId)
  await ensureSessions(input.ownerId, new Date(input.startsAt.getTime() + 86_400_000), new Date(), true)
  const result = await claimTransaction(async (db) => {
    const found = await loadAppointment(db, input.ownerId, input.appointmentId, input.memberId)
    const newStaffId = input.staffId || found.staffId
    // Lock both diaries in a fixed order so two reschedules cannot deadlock each other.
    for (const id of [...new Set([found.staffId, newStaffId])].sort()) await lockRow(db, 'Staff', id)
    await lockRow(db, 'Member', found.memberId)
    await lockRow(db, 'Appointment', found.id)
    const a = await db.appointment.findUniqueOrThrow({ where: { id: found.id } })
    if (a.status !== 'booked') throw rule('not_reschedulable', 'Only upcoming appointments can be moved.')
    const now = new Date()
    if (input.by === 'member') {
      if (!found.type.memberReschedule) throw rule('reschedule_not_allowed', `${found.type.name} can only be moved by the team. Please get in touch.`)
      if (isLate(a, now)) throw rule('reschedule_window', `Appointments can be moved up to ${a.cancelWindowHours} hours before they start. Please contact the team.`)
    }
    if (input.startsAt.getTime() === a.startsAt.getTime() && newStaffId === a.staffId) throw badRequest('That is the current time. Choose a different one.')

    const { type, member, staff } = await loadParties(db, { ownerId: input.ownerId, typeId: a.typeId, memberId: a.memberId, staffId: newStaffId, requireActiveType: false })
    const viaStaff = input.by === 'staff'
    const { endsAt, locationId } = await assertBookable(db, { ownerId: input.ownerId, type, staff, member, startsAt: input.startsAt, locationId: null, override: viaStaff && input.override, ignoreAppointmentId: a.id, settings, viaStaff })

    await db.timeClaim.deleteMany({ where: { appointmentId: a.id } })
    const updated = await db.appointment.update({
      where: { id: a.id },
      data: { startsAt: input.startsAt, endsAt, staffId: staff.id, locationId, previousStartsAt: a.startsAt, rescheduleCount: { increment: 1 }, reminderDaySentAt: null, reminderSoonSentAt: null },
    })
    await db.timeClaim.createMany({ data: claimRows(input.ownerId, a.id, staff.id, member.id, input.startsAt, endsAt) })
    await announce(db, 'rescheduled', updated, { type: type.name, staff: staff.name, member: member.name }, settings.timezone, input.actor, `was ${formatDateTime(a.startsAt, settings.timezone)}`)
    if (staff.id !== a.staffId) {
      await notify(db, { ownerId: input.ownerId, type: 'appointment', title: `Appointment moved to ${staff.name}: ${member.name}`, body: `${type.name} · was ${formatDateTime(a.startsAt, settings.timezone)}`, staffId: a.staffId })
    }
    await appointmentEvent(db, input.ownerId, 'appointment.updated', updated.id)
    return { appointment: updated, type, staff, member }
  })
  const { flushOutbox } = await import('./automations')
  await flushOutbox(input.ownerId)
  return result
}

/** Staff record what happened: the member came, or did not. A no-show keeps the credit or payment. */
export async function markAppointment(input: { ownerId: string; appointmentId: string; outcome: 'completed' | 'no_show'; actor?: ActorRef }) {
  const settings = await getGymSettings(input.ownerId)
  const result = await prisma.$transaction(async (db) => {
    const found = await loadAppointment(db, input.ownerId, input.appointmentId)
    await lockRow(db, 'Appointment', found.id)
    const a = await db.appointment.findUniqueOrThrow({ where: { id: found.id } })
    if (a.status !== 'booked') throw rule('already_recorded', `This appointment is already marked ${a.status.replace('_', ' ')}.`)
    if (a.startsAt.getTime() - Date.now() > 30 * MIN) throw rule('too_early', 'Attendance can be recorded from 30 minutes before the appointment.')
    const updated = await db.appointment.update({ where: { id: a.id }, data: { status: input.outcome, completedAt: input.outcome === 'completed' ? new Date() : null } })
    if (input.outcome === 'completed') {
      const { recordVisit } = await import('./checkin')
      // An attended session is a visit like any other: it counts towards streaks and attendance reports.
      await recordVisit(db, { ownerId: input.ownerId, member: found.member, settings, source: 'manual', type: 'personal_training', locationId: a.locationId, actor: input.actor, title: `Attended ${found.type.name} with ${found.staff.name}` })
    } else {
      await db.timeClaim.deleteMany({ where: { appointmentId: a.id } })
      await announce(db, 'no_show', updated, { type: found.type.name, staff: found.staff.name, member: found.member.name }, settings.timezone, input.actor, a.creditsUsed ? 'session not returned' : undefined)
    }
    await appointmentEvent(db, input.ownerId, input.outcome === 'completed' ? 'appointment.completed' : 'appointment.no_show', updated.id)
    return updated
  }, { timeout: 20_000 })
  const { flushOutbox } = await import('./automations')
  await flushOutbox(input.ownerId)
  return result
}

// ---------------------------------------------------------------------------
// Reminders (run by the platform cron)
// ---------------------------------------------------------------------------

/** Tell members about appointments tomorrow and within the next two hours. Safe to run as often as you like. */
export async function sendAppointmentReminders(ownerId: string, now = new Date()) {
  const settings = await getGymSettings(ownerId)
  const upcoming = await prisma.appointment.findMany({
    where: { ownerId, status: 'booked', startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) }, OR: [{ reminderDaySentAt: null }, { reminderSoonSentAt: null }] },
    include: { type: { select: { name: true } }, staff: { select: { name: true } } },
    take: 500,
  })
  let sent = 0
  for (const a of upcoming) {
    const soon = a.startsAt.getTime() - now.getTime() <= 2 * 3_600_000
    const field = soon ? 'reminderSoonSentAt' : 'reminderDaySentAt'
    if (a[field]) continue
    await prisma.$transaction(async (db) => {
      // Claim the reminder first so an overlapping run cannot send it twice.
      const claimed = await db.appointment.updateMany({ where: { id: a.id, status: 'booked', [field]: null }, data: { [field]: now, ...(soon && { reminderDaySentAt: a.reminderDaySentAt || now }) } })
      if (claimed.count !== 1) return
      const when = formatDateTime(a.startsAt, settings.timezone)
      await notifyMember(db, { ownerId, memberId: a.memberId, category: 'appointment', type: soon ? 'appointment_soon' : 'appointment_reminder', title: soon ? `${a.type.name} with ${a.staff.name} starts soon` : `Reminder: ${a.type.name} with ${a.staff.name}`, body: when, screen: 'schedule' })
      // Email and text reminders are separate: they are timed runs created when the appointment was booked.
      sent++
    })
  }
  return sent
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const withNames = {
  type: { select: { id: true, name: true, color: true, durationMin: true, memberReschedule: true, paymentMode: true } },
  staff: { select: { id: true, name: true } },
  member: { select: { id: true, name: true, email: true, phone: true } },
  location: { select: { id: true, name: true } },
  membership: { select: { id: true, creditsRemaining: true, plan: { select: { name: true } } } },
  invoice: { select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true } },
} as const

export async function listAppointments(ownerId: string, filters: { from?: Date; to?: Date; staffId?: string | null; memberId?: string | null; locationId?: string | null; status?: string | null; take?: number }) {
  return prisma.appointment.findMany({
    where: {
      ownerId,
      ...(filters.from && { endsAt: { gt: filters.from } }),
      ...(filters.to && { startsAt: { lt: filters.to } }),
      ...(filters.staffId && { staffId: filters.staffId }),
      ...(filters.memberId && { memberId: filters.memberId }),
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(filters.status === 'active' ? { status: { in: HOLDING } } : filters.status ? { status: filters.status } : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: Math.min(1000, filters.take || 500),
    include: withNames,
  })
}

export async function getAppointment(ownerId: string, id: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id, ownerId }, include: withNames })
  if (!appointment) throw notFound('Appointment')
  return appointment
}

/**
 * Whether a member can book a type with what they hold: the memberships that count towards it,
 * the session credits among them, and why not if not. One rule for the member app and the public page.
 */
export function appointmentTypeAccess(
  type: Pick<AppointmentType, 'paymentMode' | 'requiredPlanIds' | 'creditsRequired'>,
  memberships: { planId: string; creditsRemaining: number | null; plan: { type: string } }[]
) {
  const eligible = memberships.filter((m) => (type.requiredPlanIds.length === 0 ? (type.paymentMode === 'credit' ? m.plan.type === 'pt_package' : true) : type.requiredPlanIds.includes(m.planId)))
  const credits = type.paymentMode === 'credit' ? eligible.reduce((sum, m) => sum + (m.creditsRemaining ?? 0), 0) : null
  const blocked = type.paymentMode === 'credit' ? (credits ?? 0) < type.creditsRequired : type.requiredPlanIds.length > 0 && eligible.length === 0
  return { eligible, credits, blocked: blocked ? (type.paymentMode === 'credit' ? ('needs_package' as const) : ('needs_membership' as const)) : null }
}

/** What a member may see of their own appointment. Staff notes and internal ids of other people stay out. */
export function memberView(a: Awaited<ReturnType<typeof listAppointments>>[number], now = new Date()) {
  const upcoming = a.status === 'booked' && a.startsAt > now
  const late = isLate(a, now)
  return {
    id: a.id, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, durationMin: a.type.durationMin,
    type: { id: a.type.id, name: a.type.name, color: a.type.color },
    coach: { id: a.staff.id, name: a.staff.name },
    location: a.location?.name || null,
    notes: a.notes,
    payment: a.paymentMode === 'credit' ? { mode: 'credit', label: `${a.creditsUsed} session${a.creditsUsed === 1 ? '' : 's'}${a.membership ? ` from ${a.membership.plan.name}` : ''}`, returned: a.creditsReturned }
      : a.paymentMode === 'paid' ? { mode: 'paid', label: formatMoney(a.priceCents), invoice: a.invoice ? { id: a.invoice.id, number: a.invoice.number, status: a.invoice.status, balanceCents: a.invoice.totalCents - a.invoice.amountPaidCents } : null }
      : { mode: 'included', label: 'Included in your membership' },
    cancelWindowHours: a.cancelWindowHours,
    /** Until this moment, cancelling or moving keeps the session or payment. */
    freeChangeUntil: new Date(a.startsAt.getTime() - a.cancelWindowHours * 3_600_000),
    can: { cancel: upcoming, cancelFree: upcoming && !late, reschedule: upcoming && !late && a.type.memberReschedule },
    rescheduledFrom: a.previousStartsAt,
    cancelledAt: a.cancelledAt,
  }
}
