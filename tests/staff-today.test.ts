// Priority 5: booking clashes (classes, appointments, members, coaches), the staff
// Today screen, member lookup, the quick profile, check-in and attendance.
// The HTTP parts need `npm run dev`.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { bookAppointment } from '@/lib/services/appointments'
import { bookClass, cancelBooking, claimOffer } from '@/lib/services/bookings'
import { ensureSessions } from '@/lib/services/classes'
import { sellMembership } from '@/lib/services/memberships'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

// These tests make classes "an hour and a half from now" and expect them on today's screen, so the
// gym is put in a timezone where it is currently the middle of the day. With a fixed zone they failed
// whenever the suite ran in that zone's last hours before midnight.
const TZ = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Honolulu', 'America/Sao_Paulo'].find((zone) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return hour >= 5 && hour <= 17
}) || 'UTC'
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

const today = zonedParts(new Date(), TZ).date
const day = (n: number) => addDaysToDate(today, n)
const at = (date: string, time: string) => zonedToUtc(date, time, TZ)

async function call(auth: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text }
}

let gym: string
let plan: Awaited<ReturnType<typeof createPlan>>
async function coachWithHours(ownerId = gym, extra: Record<string, unknown> = {}) {
  const staff = await prisma.staff.create({ data: { ownerId, name: `Coach ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true, ...extra } })
  await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId, staffId: staff.id, weekday, startMinute: 0, endMinute: 1440, kind: 'work' })) })
  return staff
}
const appointmentType = (staffIds: string[], ownerId = gym, data: Record<string, unknown> = {}) =>
  prisma.appointmentType.create({ data: { ownerId, name: 'Personal Training', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 90, ...data, staff: { create: staffIds.map((staffId) => ({ staffId, ownerId })) } } })
async function memberWithPlan(ownerId = gym, data: Record<string, unknown> = {}) {
  const member = await createMember(ownerId, data)
  // Started yesterday, so it covers classes that are already under way today.
  await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', startDate: new Date(Date.now() - DAY) }))
  return member
}
const book = (memberId: string, sessionId: string, source: 'member' | 'staff' = 'member', joinWaitlist = false) => tx((db) => bookClass(db, { ownerId: gym, memberId, sessionId, source, joinWaitlist }))

beforeAll(async () => {
  gym = await createGym({ timezone: TZ, waitlistOfferMinutes: 0 })
  plan = await createPlan(gym)
})
afterAll(async () => { await destroyGym(gym) })

describe('a member cannot be in two places at once', () => {
  it('refuses a class that overlaps another class, and allows back-to-back', async () => {
    const member = await memberWithPlan()
    const a = await createSession(gym, { startsAt: at(day(3), '09:00'), endsAt: at(day(3), '10:00') })
    const overlapping = await createSession(gym, { startsAt: at(day(3), '09:30'), endsAt: at(day(3), '10:30') })
    const next = await createSession(gym, { startsAt: at(day(3), '10:00'), endsAt: at(day(3), '11:00') })
    await book(member.id, a.id)
    await expect(book(member.id, overlapping.id)).rejects.toMatchObject({ status: 409, code: 'member_in_class' })
    // Staff cannot do it for them either.
    await expect(book(member.id, overlapping.id, 'staff')).rejects.toMatchObject({ status: 409, code: 'member_in_class' })
    expect((await book(member.id, next.id)).booking.status).toBe('booked')
    expect(await prisma.booking.count({ where: { memberId: member.id, status: 'booked' } })).toBe(2)
    // Cancelling frees the time (08:30 to 09:30 overlapped the cancelled class, but not the 10:00 one).
    const early = await createSession(gym, { startsAt: at(day(3), '08:30'), endsAt: at(day(3), '09:30') })
    await expect(book(member.id, early.id)).rejects.toMatchObject({ code: 'member_in_class' })
    const first = await prisma.booking.findFirstOrThrow({ where: { memberId: member.id, sessionId: a.id } })
    await tx((db) => cancelBooking(db, { ownerId: gym, bookingId: first.id, by: 'member' }))
    expect((await book(member.id, early.id)).booking.status).toBe('booked')
  })

  it('refuses a class over an appointment, and an appointment over a class', async () => {
    const coach = await coachWithHours()
    const type = await appointmentType([coach.id])
    const member = await memberWithPlan()
    await bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(4), '09:00'), source: 'member' })
    const clash = await createSession(gym, { startsAt: at(day(4), '09:30'), endsAt: at(day(4), '10:30') })
    await expect(book(member.id, clash.id)).rejects.toMatchObject({ status: 409, code: 'member_busy' })
    expect(await prisma.booking.count({ where: { memberId: member.id } })).toBe(0)

    const cls = await createSession(gym, { startsAt: at(day(4), '14:00'), endsAt: at(day(4), '15:00') })
    await book(member.id, cls.id)
    await expect(bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(4), '14:30'), source: 'staff', override: true })).rejects.toMatchObject({ status: 409, code: 'member_in_class' })
    await expect(bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(4), '09:30'), source: 'staff', override: true })).rejects.toMatchObject({ status: 409 })
    // Joining a waitlist is not a booking, so it is allowed alongside something else.
    const fullClass = await createSession(gym, { startsAt: at(day(4), '14:00'), endsAt: at(day(4), '15:00'), capacity: 1 })
    const other = await memberWithPlan()
    await book(other.id, fullClass.id)
    expect((await book(member.id, fullClass.id, 'member', true)).booking.status).toBe('waitlisted')
  })

  it('lets exactly one of two simultaneous overlapping class bookings through', async () => {
    const member = await memberWithPlan()
    const a = await createSession(gym, { startsAt: at(day(5), '09:00'), endsAt: at(day(5), '10:00') })
    const b = await createSession(gym, { startsAt: at(day(5), '09:15'), endsAt: at(day(5), '10:15') })
    const results = await Promise.allSettled([book(member.id, a.id), book(member.id, b.id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
    expect(await prisma.booking.count({ where: { memberId: member.id, status: 'booked' } })).toBe(1)

    // A burst across six overlapping classes: still one.
    const m2 = await memberWithPlan()
    const many = await Promise.all(Array.from({ length: 6 }, (_, i) => createSession(gym, { startsAt: at(day(6), `09:${String(i * 5).padStart(2, '0')}`), endsAt: at(day(6), `10:${String(i * 5).padStart(2, '0')}`) })))
    const burst = await Promise.allSettled(many.map((s) => book(m2.id, s.id)))
    expect(burst.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.booking.count({ where: { memberId: m2.id, status: 'booked' } })).toBe(1)
  })

  it('lets exactly one of a simultaneous class booking and appointment booking through', async () => {
    const coach = await coachWithHours()
    const type = await appointmentType([coach.id])
    for (let round = 0; round < 3; round++) {
      const member = await memberWithPlan()
      const cls = await createSession(gym, { startsAt: at(day(7 + round), '11:00'), endsAt: at(day(7 + round), '12:00') })
      const results = await Promise.allSettled([
        book(member.id, cls.id),
        bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(7 + round), '11:30'), source: 'member' }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled'), `round ${round}`).toHaveLength(1)
      const classes = await prisma.booking.count({ where: { memberId: member.id, status: 'booked' } })
      const appointments = await prisma.appointment.count({ where: { memberId: member.id, status: 'booked' } })
      expect(classes + appointments).toBe(1)
    }
  })

  it('does not promote someone off a waitlist into a clash, and refuses a clashing offer claim', async () => {
    const [holder, waiter, nextUp] = await Promise.all([memberWithPlan(), memberWithPlan(), memberWithPlan()])
    const full = await createSession(gym, { startsAt: at(day(10), '09:00'), endsAt: at(day(10), '10:00'), capacity: 1 })
    await book(holder.id, full.id)
    await book(waiter.id, full.id, 'member', true)
    await book(nextUp.id, full.id, 'member', true)
    // While waiting, the first in line books something else at that time.
    const elsewhere = await createSession(gym, { startsAt: at(day(10), '09:30'), endsAt: at(day(10), '10:30') })
    await book(waiter.id, elsewhere.id)
    const held = await prisma.booking.findFirstOrThrow({ where: { memberId: holder.id, sessionId: full.id } })
    await tx((db) => cancelBooking(db, { ownerId: gym, bookingId: held.id, by: 'member' }))
    // The spot skips them and goes to the next person.
    expect((await prisma.booking.findFirstOrThrow({ where: { memberId: waiter.id, sessionId: full.id } })).status).toBe('cancelled')
    expect((await prisma.booking.findFirstOrThrow({ where: { memberId: nextUp.id, sessionId: full.id } })).status).toBe('booked')
    expect(await prisma.booking.count({ where: { memberId: waiter.id, status: 'booked' } })).toBe(1)

    // With an offer window, the clash is caught when they try to claim.
    const offerGym = await createGym({ timezone: TZ, waitlistOfferMinutes: 30 })
    try {
      const p = await createPlan(offerGym)
      const mk = async () => { const m = await createMember(offerGym); await tx((db) => sellMembership(db, { ownerId: offerGym, memberId: m.id, planId: p.id, paymentMethod: 'cash' })); return m }
      const [h, w] = [await mk(), await mk()]
      const s = await createSession(offerGym, { startsAt: at(day(10), '09:00'), endsAt: at(day(10), '10:00'), capacity: 1 })
      await tx((db) => bookClass(db, { ownerId: offerGym, memberId: h.id, sessionId: s.id, source: 'member' }))
      const waiting = await tx((db) => bookClass(db, { ownerId: offerGym, memberId: w.id, sessionId: s.id, source: 'member', joinWaitlist: true }))
      const other = await createSession(offerGym, { startsAt: at(day(10), '09:30'), endsAt: at(day(10), '10:30') })
      await tx((db) => bookClass(db, { ownerId: offerGym, memberId: w.id, sessionId: other.id, source: 'member' }))
      const hb = await prisma.booking.findFirstOrThrow({ where: { memberId: h.id, sessionId: s.id } })
      await tx((db) => cancelBooking(db, { ownerId: offerGym, bookingId: hb.id, by: 'member' }))
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: waiting.booking.id } })).status).toBe('offered')
      await expect(tx((db) => claimOffer(db, { ownerId: offerGym, bookingId: waiting.booking.id, actor: { type: 'member', id: w.id, name: w.name } }))).rejects.toMatchObject({ status: 409, code: 'member_in_class' })
    } finally {
      await destroyGym(offerGym)
    }
  })
})

describe('recurring classes and the coach\'s appointments', () => {
  it('generates classes before offering appointment times, even far ahead', async () => {
    const coach = await coachWithHours()
    const type = await appointmentType([coach.id], gym, { maxAdvanceDays: 200 })
    const classType = await prisma.classType.create({ data: { ownerId: gym, name: 'Far Future Class' } })
    await prisma.classSchedule.create({ data: { ownerId: gym, classTypeId: classType.id, coachId: coach.id, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '10:00', durationMin: 60, capacity: 10, waitlistCapacity: 5, startDate: new Date() } })
    const member = await memberWithPlan()
    // 100 days out is past the usual generation horizon; the class must still block the slot.
    await expect(bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(100), '10:30'), source: 'member' })).rejects.toMatchObject({ status: 409, code: 'staff_teaching' })
    expect(await prisma.classSession.count({ where: { ownerId: gym, coachId: coach.id, startsAt: at(day(100), '10:00') } })).toBe(1)
    expect((await bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(100), '12:00'), source: 'member' })).appointment.status).toBe('booked')
  })

  it('schedules a class without the coach, and tells staff, if background generation meets an appointment', async () => {
    const coach = await coachWithHours()
    const type = await appointmentType([coach.id])
    const member = await memberWithPlan()
    await bookAppointment({ ownerId: gym, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: at(day(20), '15:00'), source: 'member' })
    const classType = await prisma.classType.create({ data: { ownerId: gym, name: 'Late Addition' } })
    // Written straight to the table, as if the schedule predated the appointment.
    await prisma.classSchedule.create({ data: { ownerId: gym, classTypeId: classType.id, coachId: coach.id, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '15:30', durationMin: 60, capacity: 10, waitlistCapacity: 5, startDate: new Date() } })
    await ensureSessions(gym, at(day(21), '00:00'))
    const clashing = await prisma.classSession.findFirstOrThrow({ where: { ownerId: gym, classTypeId: classType.id, startsAt: at(day(20), '15:30') } })
    expect(clashing.coachId).toBeNull()
    const clear = await prisma.classSession.findFirstOrThrow({ where: { ownerId: gym, classTypeId: classType.id, startsAt: at(day(19), '15:30') } })
    expect(clear.coachId).toBe(coach.id)
    expect(await prisma.notification.count({ where: { ownerId: gym, title: 'A class needs a coach' } })).toBeGreaterThan(0)
  })
})

describe.skipIf(!up)('staff app over HTTP', () => {
  let other: string
  let downtown: { id: string }
  let uptown: { id: string }
  const who: Record<string, { cookie: string; id: string }> = {}
  let owner: string
  let foreignOwner: string

  async function staffMember(role: string, extra: Record<string, unknown> = {}, ownerId = gym) {
    const row = await prisma.staff.create({ data: { ownerId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role, isCoach: role === 'coach' || role === 'trainer', ...extra } })
    return { id: row.id, cookie: `auth-token=${await createToken({ ownerId, staffId: row.id, role: role as any })}` }
  }

  beforeAll(async () => {
    other = await createGym({ timezone: TZ })
    owner = `auth-token=${await createToken({ ownerId: gym, emailVerified: true })}`
    foreignOwner = `auth-token=${await createToken({ ownerId: other, emailVerified: true })}`
    downtown = await prisma.location.create({ data: { ownerId: gym, name: 'Downtown' } })
    uptown = await prisma.location.create({ data: { ownerId: gym, name: 'Uptown' } })
    for (const role of ['manager', 'front_desk', 'coach', 'trainer', 'sales', 'accountant']) who[role] = await staffMember(role)
    who.deskDowntown = await staffMember('front_desk', { locationId: downtown.id })
    await prisma.staffAvailability.createMany({ data: [who.coach.id, who.trainer.id].flatMap((staffId) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId: gym, staffId, weekday, startMinute: 0, endMinute: 1440, kind: 'work' }))) })
  })
  afterAll(async () => { await destroyGym(other) })

  describe('creating classes around a coach\'s appointments', () => {
    let coachId: string
    let typeId: string
    let classTypeId: string
    const sessionBody = (date: string, startTime: string, extra: Record<string, unknown> = {}) => ({ classTypeId, coachId, date, startTime, durationMin: 60, capacity: 10, ...extra })

    beforeAll(async () => {
      coachId = (await coachWithHours()).id
      typeId = (await appointmentType([coachId])).id
      classTypeId = (await prisma.classType.create({ data: { ownerId: gym, name: 'Clash Class' } })).id
      const member = await memberWithPlan()
      await bookAppointment({ ownerId: gym, typeId, memberId: member.id, staffId: coachId, startsAt: at(day(12), '10:00'), source: 'member' })
    })

    it('refuses a one-off class, a moved class, a coach change, a copy and a recurring schedule that would land on an appointment', async () => {
      const clash = await call(owner, 'POST', '/api/schedule/sessions', sessionBody(day(12), '10:30'))
      expect(clash.status).toBe(409)
      expect(clash.json.code).toBe('coach_has_appointment')
      expect(clash.json.error).toContain('has an appointment')
      // Back-to-back and other coaches are fine.
      const after = await call(owner, 'POST', '/api/schedule/sessions', sessionBody(day(12), '11:00'))
      expect(after.status).toBe(200)
      const anotherCoach = await coachWithHours()
      expect((await call(owner, 'POST', '/api/schedule/sessions', sessionBody(day(12), '10:30', { coachId: anotherCoach.id }))).status).toBe(200)
      expect((await call(owner, 'POST', '/api/schedule/sessions', sessionBody(day(12), '10:30', { coachId: null }))).status).toBe(200)

      // Moving it onto the appointment, or lengthening it into one.
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${after.data.id}`, { startTime: '09:30' })).json.code).toBe('coach_has_appointment')
      const before = await call(owner, 'POST', '/api/schedule/sessions', sessionBody(day(12), '08:30'))
      expect(before.status).toBe(200)
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${before.data.id}`, { durationMin: 120 })).json.code).toBe('coach_has_appointment')
      // Giving a clashing class to this coach.
      const theirs = await call(owner, 'POST', '/api/schedule/sessions', sessionBody(day(12), '09:45', { coachId: (await coachWithHours()).id }))
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${theirs.data.id}`, { coachId })).json.code).toBe('coach_has_appointment')
      // Copying a class onto that day and time.
      expect((await call(owner, 'POST', `/api/schedule/sessions/${after.data.id}`, { action: 'duplicate', date: day(12), startTime: '09:30' })).json.code).toBe('coach_has_appointment')
      const unchanged = await prisma.classSession.findUniqueOrThrow({ where: { id: after.data.id } })
      expect(unchanged.startsAt.toISOString()).toBe(at(day(12), '11:00').toISOString())

      // A weekly class at that time.
      const recurring = await call(owner, 'POST', '/api/schedule/schedules', { classTypeId, coachId, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:45', durationMin: 60, capacity: 10, startDate: today })
      expect(recurring.status).toBe(409)
      expect(recurring.json.code).toBe('coach_has_appointment')
      expect(await prisma.classSchedule.count({ where: { ownerId: gym, classTypeId, startTime: '09:45' } })).toBe(0)
    })

    it('lets exactly one of a class and an appointment created at the same moment for one coach succeed', async () => {
      for (let round = 0; round < 3; round++) {
        const member = await memberWithPlan()
        const date = day(13 + round)
        const [cls, appt] = await Promise.all([
          call(owner, 'POST', '/api/schedule/sessions', sessionBody(date, '13:00')),
          call(who.manager.cookie, 'POST', '/api/appointments', { typeId, memberId: member.id, staffId: coachId, startsAt: at(date, '13:30').toISOString() }),
        ])
        expect([cls.status, appt.status].sort(), `round ${round}`).toEqual([200, 409])
        const classes = await prisma.classSession.count({ where: { ownerId: gym, coachId, startsAt: at(date, '13:00'), status: 'scheduled' } })
        const appointments = await prisma.appointment.count({ where: { ownerId: gym, staffId: coachId, startsAt: at(date, '13:30'), status: 'booked' } })
        expect(classes + appointments).toBe(1)
      }
    })

    it('lets exactly one of two simultaneous overlapping bookings by a member through over HTTP', async () => {
      const member = await memberWithPlan()
      const { token } = await createInvite(gym, member.id)
      await setPasswordWithToken(token, 'correct-horse-42')
      const bearer = await memberBearer(member.id)
      const a = await createSession(gym, { startsAt: at(day(17), '09:00'), endsAt: at(day(17), '10:00') })
      const b = await createSession(gym, { startsAt: at(day(17), '09:30'), endsAt: at(day(17), '10:30') })
      const results = await Promise.all([
        call(bearer, 'POST', '/api/portal/me/bookings', { sessionId: a.id }),
        call(bearer, 'POST', '/api/portal/me/bookings', { sessionId: b.id }),
        call(who.front_desk.cookie, 'POST', '/api/bookings', { memberId: member.id, sessionId: b.id }),
      ])
      expect(results.filter((r) => r.status === 200)).toHaveLength(1)
      expect(await prisma.booking.count({ where: { memberId: member.id, status: 'booked' } })).toBe(1)
    })
  })

  describe('Today', () => {
    let coachClass: Awaited<ReturnType<typeof createSession>>
    let otherClass: Awaited<ReturnType<typeof createSession>>
    let m1: Awaited<ReturnType<typeof createMember>>
    let m2: Awaited<ReturnType<typeof createMember>>
    let apptId: string
    let trainerApptId: string
    const soon = () => new Date(Math.ceil((Date.now() + 3 * 60_000) / 300_000) * 300_000)

    beforeAll(async () => {
      const now = Date.now()
      coachClass = await createSession(gym, { startsAt: new Date(now - 10 * 60_000), endsAt: new Date(now + 50 * 60_000), capacity: 2, waitlistCapacity: 5, coachId: who.coach.id, locationId: downtown.id })
      otherClass = await createSession(gym, { startsAt: new Date(now + 90 * 60_000), endsAt: new Date(now + 150 * 60_000), capacity: 10, locationId: uptown.id })
      await createSession(gym, { startsAt: at(day(1), '09:00'), endsAt: at(day(1), '10:00'), locationId: downtown.id })
      await createSession(other, { startsAt: new Date(now + 30 * 60_000), endsAt: new Date(now + 90 * 60_000) })
      ;[m1, m2] = await Promise.all([memberWithPlan(gym, { phone: '(207) 555-0142' }), memberWithPlan()])
      const m3 = await memberWithPlan()
      await book(m1.id, coachClass.id, 'staff')
      await book(m2.id, coachClass.id, 'staff')
      await book(m3.id, coachClass.id, 'staff', true)
      const type = await appointmentType([who.coach.id, who.trainer.id])
      // The coach is teaching until 50 minutes from now, so their appointment has to come after the class.
      const afterClass = new Date(Math.ceil((Date.now() + 60 * 60_000) / 300_000) * 300_000)
      const a = await bookAppointment({ ownerId: gym, typeId: type.id, memberId: m3.id, staffId: who.coach.id, startsAt: afterClass, locationId: downtown.id, source: 'staff', override: true })
      apptId = a.appointment.id
      const m4 = await memberWithPlan()
      const b = await bookAppointment({ ownerId: gym, typeId: type.id, memberId: m4.id, staffId: who.trainer.id, startsAt: soon(), locationId: uptown.id, source: 'staff', override: true })
      trainerApptId = b.appointment.id
    })

    it('shows today\'s classes with their counts, today\'s appointments and nothing from other days or gyms', async () => {
      const t = await call(owner, 'GET', '/api/today')
      expect(t.status).toBe(200)
      const ids = t.data.classes.map((c: any) => c.id)
      expect(ids).toEqual(expect.arrayContaining([coachClass.id, otherClass.id]))
      expect(t.data.classes.every((c: any) => zonedParts(new Date(c.startsAt), TZ).date === today)).toBe(true)
      expect(t.data.classes.find((c: any) => c.id === coachClass.id)).toMatchObject({ capacity: 2, booked: 2, checkedIn: 0, waitlisted: 1, spotsLeft: 0, location: 'Downtown', coach: { id: who.coach.id } })
      expect(t.data.appointments.map((a: any) => a.id)).toEqual(expect.arrayContaining([apptId, trainerApptId]))
      expect(t.data.timezone).toBe(TZ)
      // The other gym sees none of it.
      const theirs = await call(foreignOwner, 'GET', '/api/today')
      expect(theirs.data.classes.some((c: any) => ids.includes(c.id))).toBe(false)
      expect(theirs.data.appointments).toEqual([])
      expect((await call(null, 'GET', '/api/today')).status).toBe(401)
    })

    it('filters by location, and staff tied to a location only ever get that one', async () => {
      const down = await call(owner, 'GET', `/api/today?locationId=${downtown.id}`)
      expect(down.data.location).toMatchObject({ name: 'Downtown' })
      expect(down.data.classes.map((c: any) => c.id)).toContain(coachClass.id)
      expect(down.data.classes.map((c: any) => c.id)).not.toContain(otherClass.id)
      expect(down.data.appointments.map((a: any) => a.id)).toEqual([apptId])
      expect((await call(who.manager.cookie, 'GET', `/api/today?locationId=${uptown.id}`)).data.classes.map((c: any) => c.id)).toContain(otherClass.id)

      // A front desk at Downtown asks for Uptown, or for everything: still Downtown.
      for (const query of [`?locationId=${uptown.id}`, '']) {
        const locked = await call(who.deskDowntown.cookie, 'GET', `/api/today${query}`)
        expect(locked.data).toMatchObject({ locationLocked: true, location: { id: downtown.id } })
        expect(locked.data.classes.map((c: any) => c.id)).not.toContain(otherClass.id)
        expect(locked.data.appointments.map((a: any) => a.id)).not.toContain(trainerApptId)
      }
      const me = await call(who.deskDowntown.cookie, 'GET', '/api/me')
      expect(me.data.locations).toEqual([{ id: downtown.id, name: 'Downtown' }])
      expect(me.data.lockedLocationId).toBe(downtown.id)
      expect((await call(who.manager.cookie, 'GET', '/api/me')).data.locations.length).toBe(2)
      // Another gym's location id filters to nothing rather than leaking.
      const foreign = await prisma.location.create({ data: { ownerId: other, name: 'Elsewhere' } })
      expect((await call(owner, 'GET', `/api/today?locationId=${foreign.id}`)).data.location).toBeNull()
    })

    it('gives each role its own view and landing page', async () => {
      const desk = await call(who.front_desk.cookie, 'GET', '/api/today')
      expect(desk.data.classes.length).toBeGreaterThanOrEqual(2)
      expect(desk.data.appointments.map((a: any) => a.id)).toEqual(expect.arrayContaining([apptId, trainerApptId]))
      expect(desk.data.canSeeAllAppointments).toBe(true)

      // A coach sees every class if they ask, their own with "mine", and only ever their own appointments.
      const coachAll = await call(who.coach.cookie, 'GET', '/api/today')
      expect(coachAll.data.classes.map((c: any) => c.id)).toEqual(expect.arrayContaining([coachClass.id, otherClass.id]))
      expect(coachAll.data.appointments.map((a: any) => a.id)).toEqual([apptId])
      const coachMine = await call(who.coach.cookie, 'GET', '/api/today?mine=1')
      expect(coachMine.data.classes.map((c: any) => c.id)).toEqual([coachClass.id])
      expect(coachMine.data.canSeeAllAppointments).toBe(false)
      const trainer = await call(who.trainer.cookie, 'GET', '/api/today?mine=1')
      expect(trainer.data.appointments.map((a: any) => a.id)).toEqual([trainerApptId])
      expect(trainer.data.classes).toEqual([])
      // An accountant has no schedule access, so the class list is simply absent.
      const accountant = await call(who.accountant.cookie, 'GET', '/api/today')
      expect(accountant.data.classes).toEqual([])
      expect(accountant.data.appointments.length).toBeGreaterThan(0)
      expect((await call(who.manager.cookie, 'GET', '/api/today')).data.appointments.length).toBeGreaterThanOrEqual(2)

      const home = async (k: string) => (await call(who[k].cookie, 'GET', '/api/me')).data.home
      expect(await home('front_desk')).toBe('/today')
      expect(await home('coach')).toBe('/today')
      expect(await home('trainer')).toBe('/today')
      expect(await home('sales')).toBe('/leads')
      expect(await home('manager')).toBe('/dashboard')
      expect((await call(owner, 'GET', '/api/me')).data.home).toBe('/dashboard')
    })

    it('checks members in from the roster, records no-shows, and is safe to repeat', async () => {
      const roster = await call(who.coach.cookie, 'GET', `/api/schedule/sessions/${coachClass.id}`)
      expect(roster.data.roster).toHaveLength(2)
      expect(roster.data.waitlist).toHaveLength(1)
      const b1 = roster.data.roster.find((r: any) => r.member.id === m1.id).id
      const b2 = roster.data.roster.find((r: any) => r.member.id === m2.id).id
      const before = await prisma.checkin.count({ where: { memberId: m1.id } })
      expect((await call(who.coach.cookie, 'POST', `/api/bookings/${b1}`, { action: 'attendance', status: 'attended' })).data.status).toBe('attended')
      // Already checked in: a second tap changes nothing.
      expect((await call(who.front_desk.cookie, 'POST', `/api/bookings/${b1}`, { action: 'attendance', status: 'attended' })).data.status).toBe('attended')
      expect(await prisma.checkin.count({ where: { memberId: m1.id } })).toBe(before + 1)
      expect((await call(who.coach.cookie, 'POST', `/api/bookings/${b2}`, { action: 'attendance', status: 'no_show' })).data.status).toBe('no_show')

      const t = await call(owner, 'GET', '/api/today')
      expect(t.data.classes.find((c: any) => c.id === coachClass.id)).toMatchObject({ checkedIn: 1, noShows: 1, booked: 1 })
      expect(t.data.recentCheckins[0]).toMatchObject({ member: { id: m1.id } })
      expect(t.data.summary.checkins).toBeGreaterThanOrEqual(1)
      expect(t.data.summary.inNow).toBeGreaterThanOrEqual(1)
      // The no-show can be corrected, and a check-in undone.
      expect((await call(who.coach.cookie, 'POST', `/api/bookings/${b2}`, { action: 'attendance', status: 'attended' })).data.status).toBe('attended')
      expect((await call(who.coach.cookie, 'POST', `/api/bookings/${b2}`, { action: 'attendance', status: 'booked' })).data.status).toBe('booked')
      expect(await prisma.checkin.count({ where: { memberId: m2.id } })).toBe(0)
      // Roles without attendance or booking rights cannot mark it.
      expect((await call(who.accountant.cookie, 'POST', `/api/bookings/${b2}`, { action: 'attendance', status: 'attended' })).status).toBe(403)
      expect((await call(foreignOwner, 'POST', `/api/bookings/${b2}`, { action: 'attendance', status: 'attended' })).status).toBe(404)
    })

    it('manages the waitlist with the existing rules: promote needs a free spot, remove and reorder work', async () => {
      const detail = await call(who.front_desk.cookie, 'GET', `/api/schedule/sessions/${coachClass.id}`)
      const waiting = detail.data.waitlist[0]
      expect(waiting).toMatchObject({ position: 1, status: 'waitlisted' })
      // Still full (a no-show keeps the place they booked).
      const full = await call(who.front_desk.cookie, 'POST', `/api/bookings/${waiting.id}`, { action: 'promote' })
      expect(full.status).toBe(422)
      expect(full.json.code).toBe('class_full')
      expect((await call(who.accountant.cookie, 'POST', `/api/bookings/${waiting.id}`, { action: 'promote' })).status).toBe(403)

      const session = await createSession(gym, { startsAt: new Date(Date.now() + 3 * HOUR), endsAt: new Date(Date.now() + 4 * HOUR), capacity: 1, waitlistCapacity: 5 })
      const [a, b, c] = await Promise.all([memberWithPlan(), memberWithPlan(), memberWithPlan()])
      await book(a.id, session.id, 'staff')
      await book(b.id, session.id, 'staff', true)
      await book(c.id, session.id, 'staff', true)
      await prisma.classSession.update({ where: { id: session.id }, data: { capacity: 2 } })
      const queue = (await call(who.front_desk.cookie, 'GET', `/api/schedule/sessions/${session.id}`)).data.waitlist
      expect(queue.map((w: any) => w.member.id)).toEqual([b.id, c.id])
      // Staff promote the second in line into the free spot.
      const promoted = await call(who.front_desk.cookie, 'POST', `/api/bookings/${queue[1].id}`, { action: 'promote' })
      expect(promoted.data.status).toBe('booked')
      expect((await call(who.front_desk.cookie, 'POST', `/api/bookings/${queue[1].id}`, { action: 'promote' })).json.code).toBe('not_waitlisted')
      // And remove the other.
      expect((await call(who.front_desk.cookie, 'POST', `/api/bookings/${queue[0].id}`, { action: 'cancel' })).status).toBe(200)
      const after = (await call(who.front_desk.cookie, 'GET', `/api/schedule/sessions/${session.id}`)).data
      expect(after.waitlist).toEqual([])
      expect(after.roster.map((r: any) => r.member.id).sort()).toEqual([a.id, c.id].sort())
      expect(await prisma.memberNotification.count({ where: { memberId: c.id, type: 'waitlist_promoted' } })).toBe(1)
    })

    it('checks an appointment in from Today and reflects it', async () => {
      // A coach cannot record someone else's appointment.
      expect((await call(who.coach.cookie, 'POST', `/api/appointments/${trainerApptId}`, { action: 'complete' })).status).toBe(404)
      expect((await call(who.trainer.cookie, 'POST', `/api/appointments/${trainerApptId}`, { action: 'complete' })).data).toEqual({ status: 'completed' })
      const t = await call(who.trainer.cookie, 'GET', '/api/today')
      expect(t.data.appointments.find((a: any) => a.id === trainerApptId).status).toBe('completed')
      // Nor one that is still an hour away.
      expect((await call(who.coach.cookie, 'POST', `/api/appointments/${apptId}`, { action: 'complete' })).json.code).toBe('too_early')
    })
  })

  describe('member lookup', () => {
    let m: Awaited<ReturnType<typeof createMember>>
    beforeAll(async () => {
      m = await memberWithPlan(gym, { name: 'Zephyrine Quartermaine-Okonkwo', email: `zephyrine-${randomUUID().slice(0, 6)}@example.com`, phone: '(207) 555-0199' })
      const session = await createSession(gym, { startsAt: new Date(Date.now() + 20 * 60_000), endsAt: new Date(Date.now() + 80 * 60_000) })
      await book(m.id, session.id, 'staff')
      await createMember(other, { name: 'Zephyrine Elsewhere', phone: '(207) 555-0199' })
    })

    it('finds by name, email, phone, member id and scanned code, with what matters today', async () => {
      for (const q of ['zephyrine quarter', m.email.slice(0, 12), '2075550199', '555-0199', m.id, m.qrCode]) {
        const r = await call(who.front_desk.cookie, 'GET', `/api/today/members?q=${encodeURIComponent(q)}`)
        expect(r.status, q).toBe(200)
        expect(r.data.map((x: any) => x.id), q).toContain(m.id)
        // Never the same-named member at another gym.
        expect(r.data.every((x: any) => x.name !== 'Zephyrine Elsewhere'), q).toBe(true)
      }
      const hit = (await call(who.front_desk.cookie, 'GET', '/api/today/members?q=zephyrine')).data.find((x: any) => x.id === m.id)
      expect(hit).toMatchObject({ status: 'active', membership: 'Unlimited', checkedInAt: null, today: { kind: 'class', status: 'booked' } })
      expect(hit.balanceCents).toBe(15000)
      expect((await call(who.front_desk.cookie, 'GET', `/api/today/members?q=${encodeURIComponent(m.qrCode)}`)).data[0].exact).toBe(true)
      expect((await call(who.front_desk.cookie, 'GET', '/api/today/members?q=z')).data).toEqual([])
      expect((await call(who.front_desk.cookie, 'GET', '/api/today/members?q=nobody-by-this-name')).data).toEqual([])
    })

    it('hides balances from roles without billing access and refuses the signed-out', async () => {
      const coach = (await call(who.coach.cookie, 'GET', '/api/today/members?q=zephyrine')).data.find((x: any) => x.id === m.id)
      expect(coach.balanceCents).toBeNull()
      expect((await call(null, 'GET', '/api/today/members?q=zephyrine')).status).toBe(401)
      expect((await call(foreignOwner, 'GET', '/api/today/members?q=quartermaine')).data).toEqual([])
      expect((await call(foreignOwner, 'GET', `/api/today/members?q=${m.id}`)).data).toEqual([])
    })

    it('opens a quick profile shaped by the role, with staff notes members never see', async () => {
      const desk = await call(who.front_desk.cookie, 'GET', `/api/members/${m.id}/quick`)
      expect(desk.status).toBe(200)
      expect(desk.data).toMatchObject({ name: 'Zephyrine Quartermaine-Okonkwo', status: 'active', balanceCents: 15000 })
      expect(desk.data.today.classes).toHaveLength(1)
      expect(desk.data.billing.openInvoices[0]).toMatchObject({ balanceCents: 15000 })
      expect(desk.data.billing.nextPayment).toMatchObject({ amountCents: 15000 })
      expect(desk.data.can).toMatchObject({ checkIn: true, book: true, takePayment: true, addNote: true })
      expect(desk.data.alerts.some((a: any) => /balance due|overdue/.test(a.message))).toBe(true)

      const coach = await call(who.coach.cookie, 'GET', `/api/members/${m.id}/quick`)
      expect(coach.data.billing).toBeNull()
      expect(coach.data.balanceCents).toBeNull()
      expect(coach.data.alerts.some((a: any) => /balance due|overdue/.test(a.message))).toBe(false)
      expect(coach.text).not.toContain('15000')
      expect(coach.data.can).toMatchObject({ checkIn: true, takePayment: false, addNote: true })
      expect(coach.data.attendance).toMatchObject({ noShows90: 0, lateCancels90: 0 })

      // Notes: front desk and coaches add them; they carry an author and a time.
      expect((await call(who.coach.cookie, 'POST', `/api/members/${m.id}/notes`, { note: 'Shoulder is sore, scale the overhead work' })).status).toBe(200)
      expect((await call(who.accountant.cookie, 'POST', `/api/members/${m.id}/notes`, { note: 'x' })).status).toBe(403)
      const withNote = await call(who.front_desk.cookie, 'GET', `/api/members/${m.id}/quick`)
      expect(withNote.data.notes[0]).toMatchObject({ text: 'Shoulder is sore, scale the overhead work' })
      expect(withNote.data.notes[0].author).toMatch(/^coach /)
      expect(withNote.data.notes[0].at).toBeTruthy()
      // The member's own app never carries staff notes.
      const { token } = await createInvite(gym, m.id)
      await setPasswordWithToken(token, 'correct-horse-42')
      const bearer = await memberBearer(m.id)
      for (const path of ['/api/portal/me', '/api/portal/me/notifications?take=50', '/api/portal/me/appointments']) expect((await call(bearer, 'GET', path)).text, path).not.toContain('Shoulder is sore')
      expect((await call(foreignOwner, 'GET', `/api/members/${m.id}/quick`)).status).toBe(404)
      expect((await call(foreignOwner, 'POST', `/api/members/${m.id}/notes`, { note: 'x' })).status).toBe(404)
    })
  })

  describe('check-in', () => {
    const checkin = (auth: string, body: unknown) => call(auth, 'POST', '/api/checkin', body)

    it('checks in a valid member, treats a double tap as one visit, and refuses unknown members', async () => {
      const m = await memberWithPlan()
      const first = await checkin(who.front_desk.cookie, { memberId: m.id })
      expect(first.status).toBe(200)
      expect(first.data).toMatchObject({ success: true, duplicate: false, member: { name: m.name } })
      expect(first.data.streak.current).toBe(1)
      expect((await checkin(who.front_desk.cookie, { memberId: m.id })).data.duplicate).toBe(true)
      expect(await prisma.checkin.count({ where: { memberId: m.id } })).toBe(1)
      expect((await checkin(who.front_desk.cookie, { memberId: randomUUID() })).status).toBe(404)
      expect((await checkin(who.front_desk.cookie, { qrCode: 'clubcheck-member-does-not-exist' })).status).toBe(404)
      expect((await checkin(who.front_desk.cookie, { qrCode: m.qrCode })).data.duplicate).toBe(true)
      const foreign = await createMember(other)
      expect((await checkin(who.front_desk.cookie, { memberId: foreign.id })).status).toBe(404)
      expect((await checkin(who.accountant.cookie, { memberId: m.id })).status).toBe(403)
    })

    it('counts as class attendance when they are booked into a class starting now', async () => {
      const m = await memberWithPlan()
      const session = await createSession(gym, { startsAt: new Date(Date.now() + 15 * 60_000), endsAt: new Date(Date.now() + 75 * 60_000) })
      await book(m.id, session.id, 'staff')
      const r = await checkin(who.coach.cookie, { memberId: m.id })
      expect(r.data.attended).toMatchObject({ sessionId: session.id })
      expect((await prisma.booking.findFirstOrThrow({ where: { memberId: m.id, sessionId: session.id } })).status).toBe('attended')
    })

    it('refuses frozen and inactive members unless someone allowed to override does', async () => {
      const frozen = await createMember(gym, { status: 'frozen' })
      const refused = await checkin(who.coach.cookie, { memberId: frozen.id })
      expect(refused.status).toBe(422)
      expect(refused.json).toMatchObject({ code: 'member_frozen', details: { canOverride: true } })
      // A coach cannot override; the front desk can.
      expect((await checkin(who.coach.cookie, { memberId: frozen.id, force: true })).status).toBe(403)
      expect(await prisma.checkin.count({ where: { memberId: frozen.id } })).toBe(0)
      expect((await checkin(who.front_desk.cookie, { memberId: frozen.id, force: true })).status).toBe(200)
      const inactive = await createMember(gym, { status: 'inactive' })
      expect((await checkin(who.front_desk.cookie, { memberId: inactive.id })).status).toBe(422)
    })

    it('refuses a membership that is not valid at this location, and pins location-bound staff to theirs', async () => {
      const uptownOnly = await createPlan(gym, { name: 'Uptown Only', locationIds: [uptown.id] })
      const m = await createMember(gym)
      await tx((db) => sellMembership(db, { ownerId: gym, memberId: m.id, planId: uptownOnly.id, paymentMethod: 'cash' }))
      const wrong = await checkin(who.front_desk.cookie, { memberId: m.id, locationId: downtown.id })
      expect(wrong.status).toBe(422)
      expect(wrong.json).toMatchObject({ code: 'wrong_location', details: { canOverride: true } })
      expect(wrong.json.error).toContain('not valid at this location')
      expect(await prisma.checkin.count({ where: { memberId: m.id } })).toBe(0)
      // The Downtown desk is always at Downtown, whatever the request claims.
      expect((await checkin(who.deskDowntown.cookie, { memberId: m.id, locationId: uptown.id })).json.code).toBe('wrong_location')
      const right = await checkin(who.front_desk.cookie, { memberId: m.id, locationId: uptown.id })
      expect(right.status).toBe(200)
      expect((await prisma.checkin.findFirstOrThrow({ where: { memberId: m.id } })).locationId).toBe(uptown.id)
      // An unrestricted membership works anywhere, and the desk's location is recorded.
      const anywhere = await memberWithPlan()
      expect((await checkin(who.deskDowntown.cookie, { memberId: anywhere.id })).status).toBe(200)
      expect((await prisma.checkin.findFirstOrThrow({ where: { memberId: anywhere.id } })).locationId).toBe(downtown.id)
    })
  })
})
