import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { bookClass, cancelBooking, cancelSession, claimOffer, expireOffers, markAttendance } from '@/lib/services/bookings'
import { sellMembership } from '@/lib/services/memberships'
import { checkInMember } from '@/lib/services/checkin'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, tx } from './helpers'

let ownerId: string
beforeAll(async () => { ownerId = await createGym() })
afterAll(async () => { await destroyGym(ownerId) })

const book = (memberId: string, sessionId: string, extra: Record<string, unknown> = {}) =>
  tx((db) => bookClass(db, { ownerId, memberId, sessionId, source: 'member', ...extra }))
const status = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status

/** Members with an unlimited membership. */
async function members(count: number, planData: Record<string, unknown> = {}) {
  const plan = await createPlan(ownerId, planData)
  const out = []
  for (let i = 0; i < count; i++) {
    const member = await createMember(ownerId)
    await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    out.push(member)
  }
  return out
}

describe('booking rules', () => {
  it('books up to capacity, then waitlists in order', async () => {
    const [a, b, c, d] = await members(4)
    const session = await createSession(ownerId, { capacity: 2 })
    expect((await book(a.id, session.id)).booking.status).toBe('booked')
    expect((await book(b.id, session.id)).booking.status).toBe('booked')
    const third = await book(c.id, session.id)
    expect(third.booking.status).toBe('waitlisted')
    expect(third.waitlistPosition).toBe(1)
    expect((await book(d.id, session.id)).waitlistPosition).toBe(2)
  })

  it('never overbooks when requests race for the last spot', async () => {
    const people = await members(6)
    const session = await createSession(ownerId, { capacity: 1, waitlistCapacity: 10 })
    await Promise.all(people.map((m) => book(m.id, session.id)))
    expect(await prisma.booking.count({ where: { sessionId: session.id, status: 'booked' } })).toBe(1)
    expect(await prisma.booking.count({ where: { sessionId: session.id, status: 'waitlisted' } })).toBe(5)
  })

  it('reports a full class without waitlisting when the caller did not ask to', async () => {
    const [a, b] = await members(2)
    const session = await createSession(ownerId, { capacity: 1 })
    await book(a.id, session.id)
    await expect(book(b.id, session.id, { joinWaitlist: false })).rejects.toMatchObject({ code: 'class_full' })
    expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(1)
  })

  it('rejects double booking, cancelled classes and closed booking windows', async () => {
    const [a] = await members(1)
    const session = await createSession(ownerId)
    await book(a.id, session.id)
    await expect(book(a.id, session.id)).rejects.toMatchObject({ code: 'already_booked' })

    const cancelled = await createSession(ownerId, { status: 'cancelled' })
    await expect(book(a.id, cancelled.id)).rejects.toMatchObject({ code: 'class_cancelled' })

    const farOut = await createSession(ownerId, { startsAt: new Date(Date.now() + 30 * DAY) })
    await expect(book(a.id, farOut.id)).rejects.toMatchObject({ code: 'booking_not_open' })
    // Staff can book outside the member window
    expect((await book(a.id, farOut.id, { source: 'staff' })).booking.status).toBe('booked')

    const started = await createSession(ownerId, { startsAt: new Date(Date.now() - 10 * 60_000) })
    await expect(book(a.id, started.id)).rejects.toMatchObject({ code: 'booking_closed' })
  })

  it('requires a membership that covers the class', async () => {
    const plan = await createPlan(ownerId)
    const none = await createMember(ownerId)
    const session = await createSession(ownerId)
    await expect(book(none.id, session.id)).rejects.toMatchObject({ code: 'no_membership' })

    const otherType = await prisma.classType.create({ data: { ownerId, name: 'Yoga' } })
    const yogaOnly = await createPlan(ownerId, { name: 'Yoga Only', classTypeIds: [otherType.id] })
    const yogi = await createMember(ownerId)
    await tx((db) => sellMembership(db, { ownerId, memberId: yogi.id, planId: yogaOnly.id, paymentMethod: 'cash' }))
    await expect(book(yogi.id, session.id)).rejects.toMatchObject({ code: 'membership_not_valid' })

    const frozen = await createMember(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: frozen.id, planId: plan.id, paymentMethod: 'cash' }))
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'frozen' } })
    await expect(book(frozen.id, session.id)).rejects.toMatchObject({ code: 'membership_frozen' })

    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'expired' } })
    await expect(book(frozen.id, session.id)).rejects.toMatchObject({ code: 'membership_expired' })
  })

  it('spends class-pack credits and stops at zero', async () => {
    const pack = await createPlan(ownerId, { name: '2 Pack', type: 'class_pack', credits: 2, priceCents: 4000 })
    const member = await createMember(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: pack.id, paymentMethod: 'cash' }))
    const s1 = await createSession(ownerId)
    const s2 = await createSession(ownerId)
    const s3 = await createSession(ownerId)
    expect((await book(member.id, s1.id)).usedCredit).toBe(true)
    await book(member.id, s2.id)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).creditsRemaining).toBe(0)
    await expect(book(member.id, s3.id)).rejects.toMatchObject({ code: 'insufficient_credits' })
  })

  it('enforces a weekly class limit', async () => {
    const [member] = await members(1, { name: '1x Week', classLimit: 1, classLimitPeriod: 'week' })
    // Two classes an hour apart are always in the same week unless it is Saturday night; pin to mid-week.
    const base = new Date(Date.now() + 2 * DAY)
    const wed = new Date(base.getTime() + ((3 - base.getUTCDay() + 7) % 7) * DAY)
    wed.setUTCHours(15, 0, 0, 0)
    const s1 = await createSession(ownerId, { startsAt: wed })
    const s2 = await createSession(ownerId, { startsAt: new Date(wed.getTime() + 3 * HOUR) })
    await book(member.id, s1.id, { source: 'staff' })
    await expect(book(member.id, s2.id, { source: 'staff' })).rejects.toMatchObject({ code: 'class_limit_reached' })
  })
})

describe('cancellation', () => {
  it('returns the credit on an on-time cancel but keeps it on a late cancel', async () => {
    const pack = await createPlan(ownerId, { name: 'Pack', type: 'class_pack', credits: 5, priceCents: 9000 })
    const member = await createMember(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: pack.id, paymentMethod: 'cash' }))
    const credits = async () => (await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).creditsRemaining

    const far = await createSession(ownerId)
    const b1 = await book(member.id, far.id)
    expect(await credits()).toBe(4)
    const onTime = await tx((db) => cancelBooking(db, { ownerId, bookingId: b1.booking.id, by: 'member' }))
    expect(onTime.late).toBe(false)
    expect(await credits()).toBe(5)

    const soon = await createSession(ownerId, { startsAt: new Date(Date.now() + HOUR) })
    const b2 = await book(member.id, soon.id)
    const late = await tx((db) => cancelBooking(db, { ownerId, bookingId: b2.booking.id, by: 'member' }))
    expect(late.late).toBe(true)
    expect(late.booking.status).toBe('late_cancelled')
    expect(await credits()).toBe(4)
  })

  it('lets staff waive a late cancellation', async () => {
    const pack = await createPlan(ownerId, { name: 'Pack', type: 'class_pack', credits: 1, priceCents: 2000 })
    const member = await createMember(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: pack.id, paymentMethod: 'cash' }))
    const soon = await createSession(ownerId, { startsAt: new Date(Date.now() + HOUR) })
    const b = await book(member.id, soon.id)
    const result = await tx((db) => cancelBooking(db, { ownerId, bookingId: b.booking.id, by: 'staff', waive: true }))
    expect(result.booking.status).toBe('cancelled')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).creditsRemaining).toBe(1)
  })

  it('cancelling a class returns credits and cancels every booking', async () => {
    const pack = await createPlan(ownerId, { name: 'Pack', type: 'class_pack', credits: 3, priceCents: 6000 })
    const member = await createMember(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: pack.id, paymentMethod: 'cash' }))
    const session = await createSession(ownerId)
    const b = await book(member.id, session.id)
    const result = await tx((db) => cancelSession(db, { ownerId, sessionId: session.id, reason: 'Coach is sick' }))
    expect(result.affected).toBe(1)
    expect(await status(b.booking.id)).toBe('cancelled')
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).creditsRemaining).toBe(3)
    // The cancellation notice is queued in the outbox, not sent inside the transaction
    expect(await prisma.message.count({ where: { memberId: member.id, subject: { startsWith: 'Cancelled:' } } })).toBe(1)
  })
})

describe('waitlist', () => {
  it('offers a freed spot to the next person, who can claim it', async () => {
    const [a, b, c] = await members(3)
    const session = await createSession(ownerId, { capacity: 1 })
    const first = await book(a.id, session.id)
    const second = await book(b.id, session.id)
    const third = await book(c.id, session.id)

    const result = await tx((db) => cancelBooking(db, { ownerId, bookingId: first.booking.id, by: 'member' }))
    expect(result.promoted).toBe(1)
    const offered = await prisma.booking.findUniqueOrThrow({ where: { id: second.booking.id } })
    expect(offered.status).toBe('offered')
    expect(offered.offerExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    expect(await status(third.booking.id)).toBe('waitlisted')
    // An offered spot is held: nobody else can take it
    const [d] = await members(1)
    expect((await book(d.id, session.id)).booking.status).toBe('waitlisted')

    await tx((db) => claimOffer(db, { ownerId, bookingId: second.booking.id }))
    expect(await status(second.booking.id)).toBe('booked')
  })

  it('passes an unclaimed offer to the next person after the deadline', async () => {
    const [a, b, c] = await members(3)
    const session = await createSession(ownerId, { capacity: 1 })
    const first = await book(a.id, session.id)
    const second = await book(b.id, session.id)
    const third = await book(c.id, session.id)
    await tx((db) => cancelBooking(db, { ownerId, bookingId: first.booking.id, by: 'member' }))

    const lapsed = await expireOffers(ownerId, new Date(Date.now() + 31 * 60_000))
    expect(lapsed).toBe(1)
    expect(await status(second.booking.id)).toBe('cancelled')
    expect(await status(third.booking.id)).toBe('offered')
    await expect(tx((db) => claimOffer(db, { ownerId, bookingId: second.booking.id }))).rejects.toMatchObject({ code: 'no_offer' })
  })

  it('books straight in when the gym uses no offer window', async () => {
    const gym = await createGym({ waitlistOfferMinutes: 0 })
    try {
      const plan = await createPlan(gym)
      const a = await createMember(gym)
      const b = await createMember(gym)
      for (const m of [a, b]) await tx((db) => sellMembership(db, { ownerId: gym, memberId: m.id, planId: plan.id, paymentMethod: 'cash' }))
      const session = await createSession(gym, { capacity: 1 })
      const first = await tx((db) => bookClass(db, { ownerId: gym, memberId: a.id, sessionId: session.id, source: 'member' }))
      const second = await tx((db) => bookClass(db, { ownerId: gym, memberId: b.id, sessionId: session.id, source: 'member' }))
      await tx((db) => cancelBooking(db, { ownerId: gym, bookingId: first.booking.id, by: 'member' }))
      expect(await status(second.booking.id)).toBe('booked')
    } finally {
      await destroyGym(gym)
    }
  })
})

describe('check-in and attendance', () => {
  it('records a visit, starts a streak and ignores a double scan', async () => {
    const member = await createMember(ownerId)
    const first = await tx((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'qr' }))
    expect(first.duplicate).toBe(false)
    expect(first.streak.current).toBe(1)
    const again = await tx((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'qr' }))
    expect(again.duplicate).toBe(true)
    expect(await prisma.checkin.count({ where: { memberId: member.id } })).toBe(1)
  })

  it('extends the streak on consecutive days and resets it after a gap', async () => {
    const member = await createMember(ownerId, { currentStreak: 3, longestStreak: 5, lastStreakCheckDate: new Date(Date.now() - DAY) })
    const next = await tx((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'manual' }))
    expect(next.streak).toEqual({ current: 4, longest: 5 })

    const lapsed = await createMember(ownerId, { currentStreak: 9, longestStreak: 9, lastStreakCheckDate: new Date(Date.now() - 4 * DAY) })
    const reset = await tx((db) => checkInMember(db, { ownerId, memberId: lapsed.id, source: 'manual' }))
    expect(reset.streak).toEqual({ current: 1, longest: 9 })
  })

  it('refuses frozen members unless staff override', async () => {
    const member = await createMember(ownerId, { status: 'frozen' })
    await expect(tx((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'qr' }))).rejects.toMatchObject({ code: 'member_frozen' })
    const forced = await tx((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'manual', force: true }))
    expect(forced.duplicate).toBe(false)
  })

  it('checking in near class time marks the booking attended', async () => {
    const [member] = await members(1)
    const session = await createSession(ownerId, { startsAt: new Date(Date.now() + 20 * 60_000) })
    const b = await book(member.id, session.id)
    const result = await tx((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'qr' }))
    expect(result.attended?.sessionId).toBe(session.id)
    expect(await status(b.booking.id)).toBe('attended')
    expect(result.checkin.type).toBe('class')
  })

  it('marks a no-show and can correct it to attended', async () => {
    const [member] = await members(1)
    const session = await createSession(ownerId, { startsAt: new Date(Date.now() + 2 * HOUR) })
    const b = await book(member.id, session.id)
    await tx((db) => markAttendance(db, { ownerId, bookingId: b.booking.id, status: 'no_show' }))
    expect(await status(b.booking.id)).toBe('no_show')
    await tx((db) => markAttendance(db, { ownerId, bookingId: b.booking.id, status: 'attended' }))
    expect(await prisma.checkin.count({ where: { memberId: member.id, sessionId: session.id } })).toBe(1)
    await tx((db) => markAttendance(db, { ownerId, bookingId: b.booking.id, status: 'booked' }))
    expect(await prisma.checkin.count({ where: { memberId: member.id, sessionId: session.id } })).toBe(0)
  })
})
