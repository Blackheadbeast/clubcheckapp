import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { normalizeMemberStatus } from '@/lib/format'
import { optionalText } from '@/lib/schemas'
import { getGymSettings, logActivity } from '@/lib/services/core'
import { memberBalance } from '@/lib/services/payments'
import { listCredits } from '@/lib/services/account-credit'
import { LIVE_STATUSES, intervalLabel } from '@/lib/services/memberships'
import { expireOffers } from '@/lib/services/bookings'
import { getConnectStatus, listPaymentMethods } from '@/lib/payments/stripe-connect'
import { requestEmailChange } from '@/lib/member-auth'
import { listNotifications } from '@/lib/services/member-notifications'
import { listAppointments, memberView } from '@/lib/services/appointments'
import { appOrigin, sendAccountEmail } from '@/lib/member-auth-http'

export const dynamic = 'force-dynamic'

const MILESTONES = [1, 10, 25, 50, 100, 250, 500]

// GET - everything the member's home screen needs
export const GET = portalHandler({}, async ({ member, ownerId, via }) => {
  await expireOffers(ownerId)
  const now = new Date()
  const [settings, profile, memberships, bookings, checkins, totalVisits, visits30, balance, invoices, messages, payments, methods, connect, account, inbox, recentBookings, appointments] = await Promise.all([
    getGymSettings(ownerId),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { logoUrl: true, address: true, waiverEnabled: true } }),
    prisma.membership.findMany({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true, type: true, billingInterval: true, intervalCount: true, classLimit: true, classLimitPeriod: true, description: true, freezeAllowed: true, maxFreezeDays: true, cancellationNoticeDays: true } } } }),
    prisma.booking.findMany({
      where: { memberId: member.id, status: { in: ['booked', 'offered', 'waitlisted'] }, session: { endsAt: { gt: now }, status: 'scheduled' } },
      orderBy: { session: { startsAt: 'asc' } },
      select: { id: true, status: true, offerExpiresAt: true, waitlistedAt: true, session: { select: { id: true, title: true, startsAt: true, endsAt: true, room: true, classType: { select: { name: true, color: true } }, coach: { select: { name: true } }, location: { select: { name: true } } } } },
    }),
    prisma.checkin.findMany({ where: { memberId: member.id }, orderBy: { timestamp: 'desc' }, take: 30, select: { id: true, timestamp: true, type: true, session: { select: { title: true, classType: { select: { name: true } } } } } }),
    prisma.checkin.count({ where: { memberId: member.id } }),
    prisma.checkin.count({ where: { memberId: member.id, timestamp: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
    memberBalance(ownerId, member.id),
    prisma.invoice.findMany({ where: { memberId: member.id, status: { in: ['open', 'paid'] } }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true, dueDate: true, paidAt: true, createdAt: true, items: { select: { description: true }, take: 1 }, transactions: { where: { status: 'pending' }, select: { id: true }, take: 1 } } }),
    prisma.message.findMany({ where: { memberId: member.id, status: { in: ['sent', 'delivered', 'opened', 'clicked'] } }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, subject: true, body: true, createdAt: true } }),
    prisma.transaction.findMany({ where: { ownerId, memberId: member.id, type: { in: ['payment', 'refund'] } }, orderBy: { createdAt: 'desc' }, take: 24, select: { id: true, type: true, status: true, amountCents: true, method: true, cardLast4: true, failureReason: true, createdAt: true, invoice: { select: { number: true } } } }),
    listPaymentMethods(ownerId, member.id),
    getConnectStatus(ownerId),
    prisma.memberAccount.findUnique({ where: { memberId: member.id }, select: { pendingEmail: true, emailVerifiedAt: true } }),
    listNotifications(member.id, { take: 5 }),
    prisma.booking.findMany({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, status: true, createdAt: true, session: { select: { title: true, startsAt: true, classType: { select: { name: true } } } } } }),
    listAppointments(ownerId, { memberId: member.id, from: now, status: 'booked', take: 10 }),
  ])

  // Waitlist position for each waitlisted booking.
  const waitlisted = bookings.filter((b) => b.status === 'waitlisted')
  const positions = new Map<string, number>()
  for (const b of waitlisted) {
    positions.set(b.id, await prisma.booking.count({ where: { sessionId: b.session.id, status: 'waitlisted', waitlistedAt: { lte: b.waitlistedAt || now } } }))
  }

  const live = memberships.filter((m) => LIVE_STATUSES.includes(m.status))
  const pendingIds = live.map((m) => m.pendingPlanId).filter(Boolean) as string[]
  const pendingPlans = pendingIds.length ? await prisma.membershipPlan.findMany({ where: { ownerId, id: { in: pendingIds } }, select: { id: true, name: true } }) : []
  // The member's own credits: what each was for and what is left. Staff names and notes stay in the back office.
  const credits = await listCredits(prisma, ownerId, member.id)
  return {
    gym: { name: settings.name, logoUrl: profile?.logoUrl || null, address: profile?.address || null, timezone: settings.timezone, currency: settings.currency, cancelWindowHours: settings.cancelWindowHours, bookingWindowDays: settings.bookingWindowDays },
    member: {
      name: member.name, email: member.email, phone: member.phone, photoUrl: member.photoUrl, status: normalizeMemberStatus(member.status), qrCode: member.qrCode,
      joinedAt: member.createdAt, addressLine1: member.addressLine1, city: member.city, state: member.state, postalCode: member.postalCode,
      emergencyContactName: member.emergencyContactName, emergencyContactPhone: member.emergencyContactPhone, emailOptIn: member.emailOptIn, smsOptIn: member.smsOptIn, smsMarketingOptIn: member.smsMarketingOptIn, smsStopped: member.smsStopped,
      waiverRequired: !!profile?.waiverEnabled && !member.waiverSignedAt, waiverUrl: `/waiver/${member.id}`, creditBalanceCents: member.creditBalanceCents,
    },
    memberships: live.map((m) => ({
      id: m.id, name: m.plan.name, description: m.plan.description, status: m.status, type: m.plan.type,
      priceCents: m.priceCents, interval: intervalLabel(m.plan), creditsRemaining: m.creditsRemaining,
      classLimit: m.plan.classLimit, classLimitPeriod: m.plan.classLimitPeriod,
      renewsAt: m.plan.type === 'recurring' && m.autoRenew && !m.cancelAt && m.status !== 'frozen' ? m.currentPeriodEnd : null,
      endsAt: m.cancelAt || m.endDate, trialEndsAt: m.status === 'trial' ? m.trialEndsAt || m.endDate : null, frozenUntil: m.status === 'frozen' ? m.freezeEndsAt : null,
      paymentMethod: m.paymentMethod, startedAt: m.startDate,
      contractEndsAt: m.contractEndsAt && m.contractEndsAt > now ? m.contractEndsAt : null,
      cancelsAt: m.cancelAt, cancellationNoticeDays: m.plan.cancellationNoticeDays, maxFreezeDays: m.plan.maxFreezeDays, autoRenew: m.autoRenew,
      // A change of plan waiting for the next billing date.
      scheduledPlan: m.pendingPlanId ? pendingPlans.find((p) => p.id === m.pendingPlanId)?.name || null : null,
      // What this member may do themselves. The server checks again when they try.
      can: {
        freeze: settings.memberSelfFreeze && m.plan.type === 'recurring' && m.plan.freezeAllowed && m.status === 'active' && !m.cancelAt,
        unfreeze: settings.memberSelfFreeze && m.status === 'frozen',
        cancel: settings.memberSelfCancel && m.plan.type === 'recurring' && !m.cancelAt && (!m.contractEndsAt || m.contractEndsAt <= now),
        resume: settings.memberSelfCancel && !!m.cancelAt,
        change: settings.memberSelfChangePlan && m.plan.type === 'recurring' && ['active', 'trial'].includes(m.status) && !m.cancelAt,
      },
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
      credits: credits.credits.filter((c) => c.originalCents > 0).slice(0, 20).map((c) => ({
        id: c.id, label: c.sourceLabel, originalCents: c.originalCents, remainingCents: c.remainingCents, at: c.createdAt,
        uses: c.uses.filter((u) => u.kind === 'applied').map((u) => ({ amountCents: u.amountCents, invoiceNumber: u.invoiceNumber, at: u.at })),
      })),
      canPayOnline: connect.chargesEnabled,
      paymentMethods: methods,
      nextBillingAt: live.filter((m) => m.plan.type === 'recurring' && m.autoRenew && !m.cancelAt && m.status !== 'frozen' && m.currentPeriodEnd).map((m) => m.currentPeriodEnd as Date).sort((a, b) => a.getTime() - b.getTime())[0] || null,
      payments: payments.map((t) => ({ id: t.id, type: t.type, status: t.status, amountCents: t.amountCents, method: t.method, last4: t.cardLast4, failureReason: t.status === 'failed' ? t.failureReason : null, at: t.createdAt, invoiceNumber: t.invoice?.number || null })),
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, totalCents: i.totalCents, balanceCents: i.totalCents - i.amountPaidCents, date: i.createdAt, dueDate: i.dueDate, paidAt: i.paidAt, processing: i.transactions.length > 0, description: i.items[0]?.description || 'Invoice' })),
    },
    account: { signedIn: via === 'session', pendingEmail: account?.pendingEmail || null, emailVerified: !!account?.emailVerifiedAt },
    appointments: appointments.map((a) => memberView(a, now)),
    // Reserved for the events phase, so clients can render it without an API change.
    events: [] as never[],
    checkin: { selfCheckin: settings.memberSelfCheckin },
    inbox: { unread: inbox.unread, latest: inbox.items },
    recentActivity: [
      ...checkins.slice(0, 5).map((c) => ({ id: `c-${c.id}`, kind: 'visit' as const, at: c.timestamp, title: c.session ? `Checked in · ${c.session.title || c.session.classType.name}` : 'Checked in', amountCents: null as number | null })),
      ...payments.filter((t) => t.status !== 'pending').slice(0, 5).map((t) => ({ id: `p-${t.id}`, kind: (t.type === 'refund' ? 'refund' : t.status === 'failed' ? 'payment_failed' : 'payment') as 'refund' | 'payment_failed' | 'payment', at: t.createdAt, title: t.type === 'refund' ? 'Refund' : t.status === 'failed' ? 'Payment failed' : 'Payment', amountCents: t.amountCents as number | null })),
      ...recentBookings.map((b) => ({ id: `b-${b.id}`, kind: 'booking' as const, at: b.createdAt, title: `${b.status === 'waitlisted' ? 'Joined waitlist' : b.status.includes('cancel') ? 'Cancelled' : 'Booked'} · ${b.session.title || b.session.classType.name}`, amountCents: null as number | null })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8),
    notifications: messages.map((m) => ({ id: m.id, title: m.subject || m.body.slice(0, 60), body: m.body, at: m.createdAt })),
  }
})

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120).optional(),
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
  smsMarketingOptIn: z.boolean().optional(),
})

// PATCH - the member edits their own contact details and preferences
export const PATCH = portalHandler({ write: true, body: profileSchema }, async ({ req, member, ownerId, body, actor, via }) => {
  let emailPending: string | null = null
  if (via === 'session' && body.email && body.email !== member.email.toLowerCase()) {
    // The sign-in address only changes once the new one is confirmed from its own inbox.
    const token = await requestEmailChange(member, body.email)
    await sendAccountEmail(member, body.email, 'verify_email', token, appOrigin(req))
    emailPending = body.email
    delete body.email
  }
  if (body.email && body.email !== member.email) {
    const clash = await prisma.member.findFirst({ where: { ownerId, email: body.email, archivedAt: null, id: { not: member.id } }, select: { id: true } })
    if (clash) throw new ApiError(409, 'That email address is already in use. Please contact the gym.', 'duplicate_email')
  }
  const { smsOptIn, smsMarketingOptIn, ...fields } = body
  await prisma.$transaction(async (db) => {
    await db.member.update({ where: { id: member.id }, data: fields })
    // The member's own choice, recorded as such. Turning texts off turns marketing texts off with it.
    const { setSmsConsent } = await import('@/lib/services/sms')
    if (smsOptIn !== undefined) await setSmsConsent(db, { ownerId, memberId: member.id, scope: 'operational', optedIn: smsOptIn, source: 'member_portal', method: 'Changed in the member app', actorName: member.name })
    if (smsMarketingOptIn !== undefined && smsOptIn !== false) await setSmsConsent(db, { ownerId, memberId: member.id, scope: 'marketing', optedIn: smsMarketingOptIn, source: 'member_portal', method: 'Changed in the member app', actorName: member.name })
    const { memberEvent } = await import('@/lib/services/events')
    await memberEvent(db, ownerId, 'member.updated', member.id)
  })
  await logActivity(prisma, { ownerId, memberId: member.id, type: 'profile_updated', title: 'Updated their details in the member portal', actor })
  return { ok: true, emailPending }
})
