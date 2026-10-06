// Class booking rules, cancellations, attendance and the automatic waitlist.
//
// Every function that changes who holds a spot locks the ClassSession row
// first, so two people racing for the last place cannot both get it.

import type { Booking, ClassSession, Member, Membership, MembershipPlan } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { formatDateTime } from '@/lib/format'
import { Db, ActorRef, GymSettings, SYSTEM, getGymSettings, lockRow, logActivity } from './core'
import { SPOT_STATUSES } from './classes'
import { isCreditPlan } from './memberships'
import { queueMessage } from './messaging'
import { fireTrigger } from './automations'

type SessionWithType = ClassSession & { classType: { name: string; category: string } }
type MembershipWithPlan = Membership & { plan: MembershipPlan }

const rule = (code: string, message: string, details?: unknown) => new ApiError(422, message, code, details)

function sessionName(session: SessionWithType) {
  return session.title || session.classType.name
}

/** Start and end of the week (Sunday-based) or month containing `at`, in the gym's timezone. */
function periodBounds(at: Date, period: string, tz: string) {
  const p = zonedParts(at, tz)
  if (period === 'week') {
    const start = addDaysToDate(p.date, -p.weekday)
    return { start: zonedToUtc(start, '00:00', tz), end: zonedToUtc(addDaysToDate(start, 7), '00:00', tz) }
  }
  const first = p.date.slice(0, 8) + '01'
  const nextMonth = p.month === 12 ? `${p.year + 1}-01-01` : `${p.year}-${String(p.month + 1).padStart(2, '0')}-01`
  return { start: zonedToUtc(first, '00:00', tz), end: zonedToUtc(nextMonth, '00:00', tz) }
}

export interface Eligibility {
  /** null when the gym has no membership plans and any active member may book. */
  membership: MembershipWithPlan | null
  usesCredit: boolean
}

/**
 * Decide which of a member's memberships (if any) lets them into a session.
 * Throws a 422 with a specific code and a message staff can read out.
 */
export async function checkEligibility(
  db: Db,
  input: { ownerId: string; member: Member; session: SessionWithType; settings: GymSettings; ignoreBookingId?: string }
): Promise<Eligibility> {
  const { member, session, settings } = input
  if (member.archivedAt) throw rule('member_archived', `${member.name} is archived.`)

  const memberships = await db.membership.findMany({ where: { memberId: member.id, ownerId: input.ownerId }, include: { plan: true } })

  if (memberships.length === 0) {
    const planCount = await db.membershipPlan.count({ where: { ownerId: input.ownerId } })
    if (planCount === 0) {
      // Gym is not using membership plans: fall back to the member's manual status.
      if (!['active', 'trial'].includes(member.status)) throw rule('member_inactive', `${member.name} is not an active member.`)
      return { membership: null, usesCredit: false }
    }
    throw rule('no_membership', `${member.name} has no membership. Sell a membership or drop-in first.`)
  }

  const at = session.startsAt
  const current = memberships.filter(
    (m) =>
      ['active', 'trial'].includes(m.status) &&
      m.startDate <= at &&
      (!m.endDate || m.endDate >= at) &&
      (!m.cancelAt || m.cancelAt > at)
  )
  if (current.length === 0) {
    if (memberships.some((m) => m.status === 'frozen')) throw rule('membership_frozen', `${member.name}'s membership is frozen.`)
    if (memberships.some((m) => m.status === 'past_due')) {
      throw rule('membership_past_due', `${member.name}'s membership is past due. Settle the balance to book.`)
    }
    throw rule('membership_expired', `${member.name}'s membership has expired or ends before this class.`)
  }

  const covering = current.filter(
    (m) =>
      (m.plan.classTypeIds.length === 0 || m.plan.classTypeIds.includes(session.classTypeId)) &&
      (m.plan.locationIds.length === 0 || (session.locationId !== null && m.plan.locationIds.includes(session.locationId))) &&
      (session.allowedPlanIds.length === 0 || session.allowedPlanIds.includes(m.planId))
  )
  if (covering.length === 0) {
    throw rule('membership_not_valid', `${current[0].plan.name} doesn't include ${sessionName(session)}.`)
  }

  // Prefer unlimited access, then the credits that expire soonest.
  const ordered = [...covering].sort((a, b) => {
    const credit = Number(isCreditPlan(a.plan)) - Number(isCreditPlan(b.plan))
    if (credit !== 0) return credit
    return (a.endDate?.getTime() ?? Infinity) - (b.endDate?.getTime() ?? Infinity)
  })

  let reason: ApiError | null = null
  for (const m of ordered) {
    if (isCreditPlan(m.plan)) {
      if ((m.creditsRemaining ?? 0) > 0) return { membership: m, usesCredit: true }
      reason = rule('insufficient_credits', `${member.name} has no sessions left on ${m.plan.name}.`)
      continue
    }
    if (m.plan.classLimit !== null) {
      const { start, end } = periodBounds(at, m.plan.classLimitPeriod, settings.timezone)
      const counted = ['booked', 'offered', 'attended', 'no_show', ...(settings.lateCancelUsesCredit ? ['late_cancelled'] : [])]
      const used = await db.booking.count({
        where: {
          membershipId: m.id,
          status: { in: counted },
          session: { startsAt: { gte: start, lt: end } },
          ...(input.ignoreBookingId && { id: { not: input.ignoreBookingId } }),
        },
      })
      if (used >= m.plan.classLimit) {
        reason = rule('class_limit_reached', `${member.name} has used all ${m.plan.classLimit} classes this ${m.plan.classLimitPeriod} on ${m.plan.name}.`)
        continue
      }
    }
    return { membership: m, usesCredit: false }
  }
  throw reason!
}

async function loadSession(db: Db, ownerId: string, sessionId: string): Promise<SessionWithType> {
  const session = await db.classSession.findFirst({
    where: { id: sessionId, ownerId },
    include: { classType: { select: { name: true, category: true } } },
  })
  if (!session) throw notFound('Class')
  return session
}

async function spotsTaken(db: Db, sessionId: string) {
  return db.booking.count({ where: { sessionId, status: { in: SPOT_STATUSES } } })
}

/** Turn a booking row into a confirmed spot, consuming a credit when the plan is credit-based. */
async function confirmSpot(db: Db, bookingId: string, eligibility: Eligibility) {
  if (eligibility.usesCredit && eligibility.membership) {
    const spent = await db.membership.updateMany({
      where: { id: eligibility.membership.id, creditsRemaining: { gt: 0 } },
      data: { creditsRemaining: { decrement: 1 } },
    })
    if (spent.count === 0) throw rule('insufficient_credits', `No sessions left on ${eligibility.membership.plan.name}.`)
  }
  return db.booking.update({
    where: { id: bookingId },
    data: {
      status: 'booked',
      membershipId: eligibility.membership?.id || null,
      creditUsed: eligibility.usesCredit,
      waitlistedAt: null,
      offerExpiresAt: null,
      cancelledAt: null,
      checkedInAt: null,
    },
  })
}

async function returnCredit(db: Db, booking: Booking) {
  if (!booking.creditUsed || !booking.membershipId) return
  await db.membership.update({ where: { id: booking.membershipId }, data: { creditsRemaining: { increment: 1 } } })
  await db.booking.update({ where: { id: booking.id }, data: { creditUsed: false } })
}

export interface BookInput {
  ownerId: string
  memberId: string
  sessionId: string
  /** Who is making the booking: members are held to the booking window and cutoff, staff are not. */
  source: 'staff' | 'member' | 'kiosk'
  joinWaitlist?: boolean
  actor?: ActorRef
}

export async function bookClass(db: Db, input: BookInput) {
  await lockRow(db, 'ClassSession', input.sessionId)
  const [session, member, settings] = await Promise.all([
    loadSession(db, input.ownerId, input.sessionId),
    db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } }),
    getGymSettings(input.ownerId, db),
  ])
  if (!member) throw notFound('Member')
  const now = new Date()
  const byStaff = input.source === 'staff'
  const name = sessionName(session)
  const tz = settings.timezone

  if (session.status === 'cancelled') throw rule('class_cancelled', `${name} has been cancelled.`)
  if (now >= session.endsAt) throw rule('class_ended', `${name} has already finished.`)
  if (!byStaff) {
    const closesAt = new Date(session.startsAt.getTime() - settings.bookingCutoffMinutes * 60_000)
    if (now >= closesAt) {
      throw rule('booking_closed', settings.bookingCutoffMinutes > 0
        ? `Booking closes ${settings.bookingCutoffMinutes} minutes before class starts.`
        : `${name} has already started.`)
    }
    const opensAt = new Date(session.startsAt.getTime() - settings.bookingWindowDays * 86_400_000)
    if (now < opensAt) throw rule('booking_not_open', `Booking for this class opens ${formatDateTime(opensAt, tz)}.`, { opensAt })
  }

  const existing = await db.booking.findUnique({ where: { sessionId_memberId: { sessionId: session.id, memberId: member.id } } })
  if (existing && ['booked', 'attended', 'offered'].includes(existing.status)) {
    throw rule('already_booked', `${member.name} is already booked into ${name}.`)
  }
  if (existing?.status === 'waitlisted') throw rule('already_waitlisted', `${member.name} is already on the waitlist for ${name}.`)

  const eligibility = await checkEligibility(db, { ownerId: input.ownerId, member, session, settings, ignoreBookingId: existing?.id })
  const taken = await spotsTaken(db, session.id)
  const full = taken >= session.capacity

  if (full) {
    const waiting = await db.booking.count({ where: { sessionId: session.id, status: 'waitlisted' } })
    const waitlistOpen = waiting < session.waitlistCapacity
    if (input.joinWaitlist === false) {
      throw rule('class_full', `${name} is full.`, { waitlistAvailable: waitlistOpen, waitlistPosition: waiting + 1 })
    }
    if (!waitlistOpen) throw rule('waitlist_full', `${name} and its waitlist are both full.`)
  }

  const base = {
    ownerId: input.ownerId,
    sessionId: session.id,
    memberId: member.id,
    source: input.source,
    membershipId: eligibility.membership?.id || null,
    creditUsed: false,
    cancelledAt: null,
    checkedInAt: null,
    offerExpiresAt: null,
  }
  let booking = existing
    ? await db.booking.update({ where: { id: existing.id }, data: { ...base, status: full ? 'waitlisted' : 'booked', waitlistedAt: full ? now : null } })
    : await db.booking.create({ data: { ...base, status: full ? 'waitlisted' : 'booked', waitlistedAt: full ? now : null } })

  let waitlistPosition: number | null = null
  if (full) {
    waitlistPosition = await db.booking.count({ where: { sessionId: session.id, status: 'waitlisted', waitlistedAt: { lte: now } } })
  } else {
    booking = await confirmSpot(db, booking.id, eligibility)
  }

  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: member.id,
    type: full ? 'waitlist_joined' : 'class_booked',
    title: full ? `Joined the waitlist for ${name}` : `Booked ${name}`,
    detail: formatDateTime(session.startsAt, tz),
    metadata: { sessionId: session.id, bookingId: booking.id },
    actor: input.actor,
  })
  return { booking, session, waitlistPosition, usedCredit: !full && eligibility.usesCredit }
}

/**
 * Fill free spots from the waitlist in queue order. With an offer window the
 * member is offered the spot and must claim it before the deadline; with a
 * window of 0 they are booked straight in.
 */
export async function promoteWaitlist(db: Db, session: SessionWithType, settings: GymSettings) {
  const now = new Date()
  if (session.status !== 'scheduled' || now >= session.startsAt) return 0
  let promoted = 0
  for (let guard = 0; guard < 50; guard++) {
    const free = session.capacity - (await spotsTaken(db, session.id))
    if (free <= 0) break
    const next = await db.booking.findFirst({
      where: { sessionId: session.id, status: 'waitlisted' },
      orderBy: { waitlistedAt: 'asc' },
      include: { member: true },
    })
    if (!next) break
    const name = sessionName(session)
    const when = formatDateTime(session.startsAt, settings.timezone)

    if (settings.waitlistOfferMinutes <= 0) {
      try {
        const eligibility = await checkEligibility(db, { ownerId: session.ownerId, member: next.member, session, settings, ignoreBookingId: next.id })
        await confirmSpot(db, next.id, eligibility)
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        // No longer eligible (e.g. membership lapsed while waiting): skip to the next person.
        await db.booking.update({ where: { id: next.id }, data: { status: 'cancelled', cancelledAt: now, waitlistedAt: null } })
        continue
      }
      await queueMessage(db, {
        ownerId: session.ownerId, channel: 'email', memberId: next.memberId, transactional: true,
        subject: `You're in: ${name}`,
        body: `Hi {{first_name}},\n\nA spot opened up and you've been moved off the waitlist into ${name} on ${when}.\n\nCan't make it? Cancel here so someone else can take the spot:\n{{portal_link}}`,
      })
      await logActivity(db, {
        ownerId: session.ownerId, memberId: next.memberId, type: 'waitlist_promoted',
        title: `Moved off the waitlist into ${name}`, detail: when, metadata: { sessionId: session.id, bookingId: next.id },
      })
    } else {
      const deadline = new Date(Math.min(now.getTime() + settings.waitlistOfferMinutes * 60_000, session.startsAt.getTime()))
      await db.booking.update({ where: { id: next.id }, data: { status: 'offered', offerExpiresAt: deadline, waitlistedAt: next.waitlistedAt } })
      await queueMessage(db, {
        ownerId: session.ownerId, channel: 'email', memberId: next.memberId, transactional: true,
        subject: `A spot opened in ${name}`,
        body: `Hi {{first_name}},\n\nA spot just opened in ${name} on ${when}. It's held for you until ${formatDateTime(deadline, settings.timezone)}.\n\nClaim it here:\n{{portal_link}}\n\nIf you don't claim it in time it goes to the next person on the waitlist.`,
      })
      await logActivity(db, {
        ownerId: session.ownerId, memberId: next.memberId, type: 'waitlist_offered',
        title: `Offered a spot in ${name}`, detail: `Held until ${formatDateTime(deadline, settings.timezone)}`,
        metadata: { sessionId: session.id, bookingId: next.id },
      })
    }
    promoted++
  }
  return promoted
}

/** Accept a waitlist offer before its deadline. */
export async function claimOffer(db: Db, input: { ownerId: string; bookingId: string; actor?: ActorRef }) {
  const found = await db.booking.findFirst({ where: { id: input.bookingId, ownerId: input.ownerId }, select: { sessionId: true } })
  if (!found) throw notFound('Booking')
  await lockRow(db, 'ClassSession', found.sessionId)
  const booking = await db.booking.findUniqueOrThrow({ where: { id: input.bookingId }, include: { member: true } })
  if (booking.status !== 'offered') throw rule('no_offer', 'There is no open spot being held for this booking.')
  if (!booking.offerExpiresAt || booking.offerExpiresAt <= new Date()) {
    throw rule('offer_expired', 'That offer has expired and the spot has gone to the next person.')
  }
  const [session, settings] = await Promise.all([loadSession(db, input.ownerId, booking.sessionId), getGymSettings(input.ownerId, db)])
  const eligibility = await checkEligibility(db, { ownerId: input.ownerId, member: booking.member, session, settings, ignoreBookingId: booking.id })
  const confirmed = await confirmSpot(db, booking.id, eligibility)
  await logActivity(db, {
    ownerId: input.ownerId, memberId: booking.memberId, type: 'class_booked',
    title: `Claimed a waitlist spot in ${sessionName(session)}`, detail: formatDateTime(session.startsAt, settings.timezone),
    metadata: { sessionId: session.id, bookingId: booking.id }, actor: input.actor,
  })
  return { booking: confirmed, session }
}

/** Lapse unclaimed offers and pass each spot down the queue. */
export async function expireOffers(ownerId?: string, now = new Date()) {
  const expired = await prisma.booking.findMany({
    where: { status: 'offered', offerExpiresAt: { lte: now }, ...(ownerId && { ownerId }) },
    select: { id: true, sessionId: true, ownerId: true },
    take: 200,
  })
  let lapsed = 0
  for (const row of expired) {
    await prisma.$transaction(async (db) => {
      await lockRow(db, 'ClassSession', row.sessionId)
      const changed = await db.booking.updateMany({
        where: { id: row.id, status: 'offered', offerExpiresAt: { lte: now } },
        data: { status: 'cancelled', cancelledAt: now, offerExpiresAt: null, waitlistedAt: null },
      })
      if (changed.count === 0) return
      lapsed++
      const [session, settings, booking] = await Promise.all([
        loadSession(db, row.ownerId, row.sessionId),
        getGymSettings(row.ownerId, db),
        db.booking.findUniqueOrThrow({ where: { id: row.id }, select: { memberId: true } }),
      ])
      await logActivity(db, {
        ownerId: row.ownerId, memberId: booking.memberId, type: 'waitlist_expired',
        title: `Waitlist offer for ${sessionName(session)} expired`, metadata: { sessionId: session.id, bookingId: row.id },
      })
      await promoteWaitlist(db, session, settings)
    })
  }
  return lapsed
}

export interface CancelInput {
  ownerId: string
  bookingId: string
  by: 'staff' | 'member'
  /** Staff only: treat a late cancellation as on time (return the credit, no late-cancel mark). */
  waive?: boolean
  actor?: ActorRef
}

export async function cancelBooking(db: Db, input: CancelInput) {
  const found = await db.booking.findFirst({ where: { id: input.bookingId, ownerId: input.ownerId }, select: { sessionId: true } })
  if (!found) throw notFound('Booking')
  await lockRow(db, 'ClassSession', found.sessionId)
  const [booking, session, settings] = await Promise.all([
    db.booking.findUniqueOrThrow({ where: { id: input.bookingId } }),
    loadSession(db, input.ownerId, found.sessionId),
    getGymSettings(input.ownerId, db),
  ])
  const now = new Date()
  const name = sessionName(session)

  if (!['booked', 'offered', 'waitlisted'].includes(booking.status)) {
    throw rule('not_cancellable', booking.status === 'attended' ? 'This booking has already been attended.' : 'This booking is already cancelled.')
  }

  let late = false
  if (booking.status === 'booked') {
    if (input.by === 'member' && now >= session.startsAt) throw rule('class_started', `${name} has already started and can no longer be cancelled.`)
    const deadline = new Date(session.startsAt.getTime() - settings.cancelWindowHours * 3_600_000)
    late = now > deadline && !(input.by === 'staff' && input.waive)
    if (!late || !settings.lateCancelUsesCredit) await returnCredit(db, booking)
  }

  const updated = await db.booking.update({
    where: { id: booking.id },
    data: { status: late ? 'late_cancelled' : 'cancelled', cancelledAt: now, offerExpiresAt: null, waitlistedAt: null },
  })
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: booking.memberId,
    type: late ? 'class_late_cancelled' : booking.status === 'waitlisted' ? 'waitlist_left' : 'class_cancelled',
    title: late ? `Late cancellation: ${name}` : booking.status === 'waitlisted' ? `Left the waitlist for ${name}` : `Cancelled ${name}`,
    detail: formatDateTime(session.startsAt, settings.timezone),
    metadata: { sessionId: session.id, bookingId: booking.id },
    actor: input.actor,
  })
  const promoted = booking.status === 'waitlisted' ? 0 : await promoteWaitlist(db, session, settings)
  return { booking: updated, late, creditReturned: booking.creditUsed && (!late || !settings.lateCancelUsesCredit), promoted, session }
}

/** Cancel a whole class: everyone gets their credit back and an email. */
export async function cancelSession(db: Db, input: { ownerId: string; sessionId: string; reason?: string | null; actor?: ActorRef }) {
  await lockRow(db, 'ClassSession', input.sessionId)
  const [session, settings] = await Promise.all([loadSession(db, input.ownerId, input.sessionId), getGymSettings(input.ownerId, db)])
  if (session.status === 'cancelled') throw badRequest('This class is already cancelled.')
  const bookings = await db.booking.findMany({ where: { sessionId: session.id, status: { in: ['booked', 'offered', 'waitlisted'] } } })
  const name = sessionName(session)
  const when = formatDateTime(session.startsAt, settings.timezone)
  for (const booking of bookings) {
    await returnCredit(db, booking)
    await db.booking.update({ where: { id: booking.id }, data: { status: 'cancelled', cancelledAt: new Date(), offerExpiresAt: null, waitlistedAt: null } })
    await logActivity(db, {
      ownerId: input.ownerId, memberId: booking.memberId, type: 'class_cancelled',
      title: `${name} was cancelled by the gym`, detail: [when, input.reason].filter(Boolean).join(' · '),
      metadata: { sessionId: session.id }, actor: input.actor,
    })
    if (session.startsAt > new Date()) {
      await queueMessage(db, {
        ownerId: input.ownerId, channel: 'email', memberId: booking.memberId, transactional: true,
        subject: `Cancelled: ${name} on ${when}`,
        body: `Hi {{first_name}},\n\n${name} on ${when} has been cancelled${input.reason ? `: ${input.reason}` : '.'}\n\nAny session credit has been returned to you. Book another class here:\n{{portal_link}}`,
      })
    }
  }
  const updated = await db.classSession.update({ where: { id: session.id }, data: { status: 'cancelled', cancelReason: input.reason || null } })
  return { session: updated, name, affected: bookings.length }
}

/** Used when a membership ends: its future bookings are released and the spots re-offered. */
export async function releaseBookingsForMembership(db: Db, ownerId: string, membershipId: string) {
  const now = new Date()
  const bookings = await db.booking.findMany({
    where: { ownerId, membershipId, status: { in: ['booked', 'offered', 'waitlisted'] }, session: { startsAt: { gt: now } } },
  })
  if (bookings.length === 0) return 0
  const settings = await getGymSettings(ownerId, db)
  for (const booking of bookings) {
    await lockRow(db, 'ClassSession', booking.sessionId)
    await db.booking.update({ where: { id: booking.id }, data: { status: 'cancelled', cancelledAt: now, offerExpiresAt: null, waitlistedAt: null, creditUsed: false } })
    if (booking.status !== 'waitlisted') await promoteWaitlist(db, await loadSession(db, ownerId, booking.sessionId), settings)
  }
  return bookings.length
}

/** Mark a booking attended / no-show, or put it back to booked. */
export async function markAttendance(
  db: Db,
  input: { ownerId: string; bookingId: string; status: 'attended' | 'no_show' | 'booked'; actor?: ActorRef }
) {
  const booking = await db.booking.findFirst({ where: { id: input.bookingId, ownerId: input.ownerId }, include: { member: true } })
  if (!booking) throw notFound('Booking')
  if (!['booked', 'attended', 'no_show'].includes(booking.status)) {
    throw rule('not_markable', 'Only confirmed bookings can be marked. This one is ' + booking.status.replace('_', ' ') + '.')
  }
  if (booking.status === input.status) return { booking, changed: false }
  const [session, settings] = await Promise.all([loadSession(db, input.ownerId, booking.sessionId), getGymSettings(input.ownerId, db)])
  const name = sessionName(session)
  const now = new Date()

  if (input.status === 'attended') {
    const { recordVisit } = await import('./checkin')
    await recordVisit(db, {
      ownerId: input.ownerId, member: booking.member, settings, source: 'manual', sessionId: session.id,
      type: session.classType.category === 'personal_training' ? 'personal_training' : 'class',
      locationId: session.locationId, actor: input.actor, title: `Attended ${name}`,
      // A roster marked after the fact should count on the day of the class.
      at: now > session.endsAt ? session.startsAt : now,
    })
  } else if (booking.status === 'attended') {
    await db.checkin.deleteMany({ where: { memberId: booking.memberId, sessionId: session.id } })
  }

  const updated = await db.booking.update({
    where: { id: booking.id },
    data: { status: input.status, checkedInAt: input.status === 'attended' ? now : null },
  })
  if (input.status === 'no_show') {
    await logActivity(db, {
      ownerId: input.ownerId, memberId: booking.memberId, type: 'class_missed',
      title: `Missed ${name}`, detail: formatDateTime(session.startsAt, settings.timezone),
      metadata: { sessionId: session.id, bookingId: booking.id }, actor: input.actor || SYSTEM,
    })
    await fireTrigger(db, input.ownerId, 'class_missed', {
      memberId: booking.memberId, dedupeKey: booking.id,
      context: { class_name: name, class_time: formatDateTime(session.startsAt, settings.timezone) },
    })
  }
  return { booking: updated, changed: true }
}

/**
 * After a class ends, anyone still "booked" is a no-show, but only where the
 * roster was actually used (at least one attendee). Gyms that never take class
 * attendance would otherwise have every booking flagged.
 */
export async function markNoShows(ownerId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 60_000)
  const since = new Date(now.getTime() - 3 * 86_400_000)
  const sessions = await prisma.classSession.findMany({
    where: {
      ownerId, status: 'scheduled', endsAt: { lt: cutoff, gt: since },
      bookings: { some: { status: 'booked' } },
      AND: { bookings: { some: { status: 'attended' } } },
    },
    select: { id: true, bookings: { where: { status: 'booked' }, select: { id: true } } },
  })
  let marked = 0
  for (const session of sessions) {
    for (const booking of session.bookings) {
      await prisma.$transaction((db) => markAttendance(db, { ownerId, bookingId: booking.id, status: 'no_show' }))
      marked++
    }
  }
  return marked
}
