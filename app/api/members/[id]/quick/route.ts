import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { startOfZonedDay } from '@/lib/dates'
import { memberCard } from '@/lib/services/checkin'
import { getGymSettings } from '@/lib/services/core'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/quick - the compact profile staff use at the desk: who this is, what they
// have on today, how they have been attending, what they owe, and the team's notes.
// Billing and notes are left out entirely for roles that may not see them.
export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params, actor, can }) => {
  const card = await memberCard(ownerId, params.id)
  const settings = await getGymSettings(ownerId)
  const now = new Date()
  const dayStart = startOfZonedDay(now, settings.timezone)
  const dayEnd = startOfZonedDay(new Date(dayStart.getTime() + 30 * 3_600_000), settings.timezone)
  const since = new Date(now.getTime() - 90 * 86_400_000)
  const own = ownDiaryOnly(actor)
  const seeBilling = can('billing.view')
  const seeAppointments = can('appointments.view')

  const [member, appointments, checkedIn, recent, noShows, lateCancels, apptNoShows, notes, invoices, failed, memberships] = await Promise.all([
    prisma.member.findFirstOrThrow({ where: { id: params.id, ownerId }, select: { longestStreak: true, createdAt: true, homeLocation: { select: { name: true } }, emergencyContactName: true, emergencyContactPhone: true, medicalNotes: true } }),
    seeAppointments
      ? prisma.appointment.findMany({ where: { ownerId, memberId: params.id, status: { in: ['booked', 'completed', 'no_show'] }, startsAt: { gte: dayStart, lt: dayEnd }, ...(own && { staffId: own }) }, orderBy: { startsAt: 'asc' }, select: { id: true, status: true, startsAt: true, endsAt: true, type: { select: { name: true, color: true } }, staff: { select: { name: true } } } })
      : [],
    prisma.checkin.findFirst({ where: { ownerId, memberId: params.id, timestamp: { gte: dayStart } }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
    prisma.checkin.findMany({ where: { ownerId, memberId: params.id }, orderBy: { timestamp: 'desc' }, take: 8, select: { id: true, timestamp: true, type: true, session: { select: { title: true, classType: { select: { name: true } } } } } }),
    prisma.booking.count({ where: { ownerId, memberId: params.id, status: 'no_show', session: { startsAt: { gte: since } } } }),
    prisma.booking.count({ where: { ownerId, memberId: params.id, status: 'late_cancelled', session: { startsAt: { gte: since } } } }),
    prisma.appointment.count({ where: { ownerId, memberId: params.id, status: { in: ['no_show', 'late_cancelled'] }, startsAt: { gte: since } } }),
    prisma.activity.findMany({ where: { ownerId, memberId: params.id, type: 'note' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, detail: true, actorName: true, createdAt: true } }),
    seeBilling ? prisma.invoice.findMany({ where: { ownerId, memberId: params.id, status: 'open' }, orderBy: { dueDate: 'asc' }, take: 5, select: { id: true, number: true, totalCents: true, amountPaidCents: true, dueDate: true, attemptCount: true } }) : [],
    seeBilling ? prisma.transaction.findFirst({ where: { ownerId, memberId: params.id, type: 'payment', status: 'failed', createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, orderBy: { createdAt: 'desc' }, select: { amountCents: true, failureReason: true, createdAt: true } }) : null,
    prisma.membership.findMany({ where: { ownerId, memberId: params.id, status: { in: ['active', 'trial', 'past_due', 'frozen'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, priceCents: true, creditsRemaining: true, currentPeriodEnd: true, autoRenew: true, cancelAt: true, plan: { select: { name: true, type: true } } } }),
  ])
  const next = memberships.filter((m) => m.plan.type === 'recurring' && m.autoRenew && !m.cancelAt && m.status !== 'frozen' && m.currentPeriodEnd).sort((a, b) => a.currentPeriodEnd!.getTime() - b.currentPeriodEnd!.getTime())[0]

  return {
    ...card,
    balanceCents: seeBilling ? card.balanceCents : null,
    creditBalanceCents: seeBilling ? card.creditBalanceCents : null,
    // Money alerts are billing information too.
    alerts: seeBilling ? card.alerts : card.alerts.filter((a) => !/overdue|balance due/.test(a.message)),
    location: member.homeLocation?.name || null,
    memberSince: member.createdAt,
    longestStreak: member.longestStreak,
    emergencyContact: member.emergencyContactName ? { name: member.emergencyContactName, phone: member.emergencyContactPhone } : null,
    hasMedicalNotes: !!member.medicalNotes,
    today: { checkedInAt: checkedIn?.timestamp || null, classes: card.todaysBookings, appointments: appointments.map((a) => ({ id: a.id, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, name: a.type.name, color: a.type.color, coach: a.staff.name })) },
    attendance: {
      recent: recent.map((c) => ({ id: c.id, at: c.timestamp, label: c.session ? c.session.title || c.session.classType.name : c.type === 'personal_training' ? 'Personal training' : 'Open gym' })),
      noShows90: noShows + apptNoShows, lateCancels90: lateCancels,
    },
    memberships: memberships.map((m) => ({ id: m.id, name: m.plan.name, status: m.status, creditsRemaining: m.creditsRemaining })),
    billing: seeBilling
      ? {
          nextPayment: next ? { at: next.currentPeriodEnd, amountCents: next.priceCents, name: next.plan.name } : null,
          failedPayment: failed ? { amountCents: failed.amountCents, reason: failed.failureReason, at: failed.createdAt } : null,
          openInvoices: invoices.map((i) => ({ id: i.id, number: i.number, balanceCents: i.totalCents - i.amountPaidCents, dueDate: i.dueDate, attempts: i.attemptCount })),
        }
      : null,
    notes: notes.map((n) => ({ id: n.id, text: n.detail || '', author: n.actorName || 'Staff', at: n.createdAt })),
    can: {
      checkIn: can('attendance.manage') && card.canCheckIn, overrideCheckIn: can('attendance.manage') && can('members.manage'), book: can('bookings.manage'), bookAppointment: can('appointments.manage'),
      takePayment: can('billing.manage'), addNote: can('members.manage') || can('attendance.manage') || can('appointments.manage'), fullProfile: true,
    },
  }
})
