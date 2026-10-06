import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { normalizeMemberStatus } from '@/lib/format'
import { optionalText } from '@/lib/schemas'
import { getGymSettings, logActivity } from '@/lib/services/core'
import { memberBalance } from '@/lib/services/payments'
import { LIVE_STATUSES, intervalLabel } from '@/lib/services/memberships'
import { expireOffers } from '@/lib/services/bookings'

export const dynamic = 'force-dynamic'

const MILESTONES = [1, 10, 25, 50, 100, 250, 500]

// GET - everything the member's home screen needs
export const GET = portalHandler({}, async ({ member, ownerId }) => {
  await expireOffers(ownerId)
  const now = new Date()
  const [settings, profile, memberships, bookings, checkins, totalVisits, visits30, balance, invoices, messages] = await Promise.all([
    getGymSettings(ownerId),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { logoUrl: true, address: true, waiverEnabled: true } }),
    prisma.membership.findMany({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true, type: true, billingInterval: true, intervalCount: true, classLimit: true, classLimitPeriod: true, description: true } } } }),
    prisma.booking.findMany({
      where: { memberId: member.id, status: { in: ['booked', 'offered', 'waitlisted'] }, session: { endsAt: { gt: now }, status: 'scheduled' } },
      orderBy: { session: { startsAt: 'asc' } },
      select: { id: true, status: true, offerExpiresAt: true, waitlistedAt: true, session: { select: { id: true, title: true, startsAt: true, endsAt: true, room: true, classType: { select: { name: true, color: true } }, coach: { select: { name: true } }, location: { select: { name: true } } } } },
    }),
    prisma.checkin.findMany({ where: { memberId: member.id }, orderBy: { timestamp: 'desc' }, take: 30, select: { id: true, timestamp: true, type: true, session: { select: { title: true, classType: { select: { name: true } } } } } }),
    prisma.checkin.count({ where: { memberId: member.id } }),
    prisma.checkin.count({ where: { memberId: member.id, timestamp: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
    memberBalance(ownerId, member.id),
    prisma.invoice.findMany({ where: { memberId: member.id, status: { in: ['open', 'paid'] } }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true, dueDate: true, paidAt: true, createdAt: true, items: { select: { description: true }, take: 1 } } }),
    prisma.message.findMany({ where: { memberId: member.id, status: { in: ['sent', 'delivered', 'opened', 'clicked'] } }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, subject: true, body: true, createdAt: true } }),
  ])

  // Waitlist position for each waitlisted booking.
  const waitlisted = bookings.filter((b) => b.status === 'waitlisted')
  const positions = new Map<string, number>()
  for (const b of waitlisted) {
    positions.set(b.id, await prisma.booking.count({ where: { sessionId: b.session.id, status: 'waitlisted', waitlistedAt: { lte: b.waitlistedAt || now } } }))
  }

  const live = memberships.filter((m) => LIVE_STATUSES.includes(m.status))
  return {
    gym: { name: settings.name, logoUrl: profile?.logoUrl || null, address: profile?.address || null, timezone: settings.timezone, currency: settings.currency, cancelWindowHours: settings.cancelWindowHours, bookingWindowDays: settings.bookingWindowDays },
    member: {
      name: member.name, email: member.email, phone: member.phone, photoUrl: member.photoUrl, status: normalizeMemberStatus(member.status), qrCode: member.qrCode,
      joinedAt: member.createdAt, addressLine1: member.addressLine1, city: member.city, state: member.state, postalCode: member.postalCode,
      emergencyContactName: member.emergencyContactName, emergencyContactPhone: member.emergencyContactPhone, emailOptIn: member.emailOptIn, smsOptIn: member.smsOptIn,
      waiverRequired: !!profile?.waiverEnabled && !member.waiverSignedAt, waiverUrl: `/waiver/${member.id}`, creditBalanceCents: member.creditBalanceCents,
    },
    memberships: live.map((m) => ({
      id: m.id, name: m.plan.name, description: m.plan.description, status: m.status, type: m.plan.type,
      priceCents: m.priceCents, interval: intervalLabel(m.plan), creditsRemaining: m.creditsRemaining,
      classLimit: m.plan.classLimit, classLimitPeriod: m.plan.classLimitPeriod,
      renewsAt: m.plan.type === 'recurring' && m.autoRenew && !m.cancelAt && m.status !== 'frozen' ? m.currentPeriodEnd : null,
      endsAt: m.cancelAt || m.endDate, trialEndsAt: m.status === 'trial' ? m.trialEndsAt || m.endDate : null, frozenUntil: m.status === 'frozen' ? m.freezeEndsAt : null,
      paymentMethod: m.paymentMethod, startedAt: m.startDate,
    })),
    upcoming: bookings.map((b) => ({ id: b.id, status: b.status, offerExpiresAt: b.offerExpiresAt, waitlistPosition: positions.get(b.id) || null, sessionId: b.session.id, name: b.session.title || b.session.classType.name, color: b.session.classType.color, startsAt: b.session.startsAt, endsAt: b.session.endsAt, coach: b.session.coach?.name || null, location: [b.session.location?.name, b.session.room].filter(Boolean).join(' · ') || null })),
    attendance: {
      totalVisits, visitsLast30Days: visits30, currentStreak: member.currentStreak, longestStreak: member.longestStreak, lastVisitAt: member.lastCheckInAt,
      recent: checkins.map((c) => ({ id: c.id, at: c.timestamp, label: c.session ? c.session.title || c.session.classType.name : c.type === 'personal_training' ? 'Personal training' : 'Open gym' })),
      milestones: MILESTONES.map((n) => ({ visits: n, reached: totalVisits >= n })),
      nextMilestone: MILESTONES.find((n) => n > totalVisits) || null,
    },
    billing: {
      balanceCents: balance.balanceCents, overdueCents: balance.overdueCents,
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, totalCents: i.totalCents, balanceCents: i.totalCents - i.amountPaidCents, date: i.createdAt, dueDate: i.dueDate, paidAt: i.paidAt, description: i.items[0]?.description || 'Invoice' })),
    },
    notifications: messages.map((m) => ({ id: m.id, title: m.subject || m.body.slice(0, 60), body: m.body, at: m.createdAt })),
  }
})

const profileSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional(),
  phone: optionalText(30),
  addressLine1: optionalText(200),
  city: optionalText(100),
  state: optionalText(50),
  postalCode: optionalText(20),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(30),
  emailOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
})

// PATCH - the member edits their own contact details and preferences
export const PATCH = portalHandler({ write: true, body: profileSchema }, async ({ member, ownerId, body, actor }) => {
  if (body.email && body.email !== member.email) {
    const clash = await prisma.member.findFirst({ where: { ownerId, email: body.email, archivedAt: null, id: { not: member.id } }, select: { id: true } })
    if (clash) throw new ApiError(409, 'That email address is already in use. Please contact the gym.', 'duplicate_email')
  }
  await prisma.member.update({ where: { id: member.id }, data: body })
  await logActivity(prisma, { ownerId, memberId: member.id, type: 'profile_updated', title: 'Updated their details in the member portal', actor })
  return { ok: true }
})
