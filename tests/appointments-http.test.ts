// Appointments over real HTTP: staff permissions, the member's own view, and
// tenant isolation. Needs `npm run dev`.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { sellMembership } from '@/lib/services/memberships'
import { createGym, createMember, createPlan, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const TZ = 'America/New_York'
const PASSWORD = 'correct-horse-42'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

async function call(auth: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text, headers: res.headers }
}
const today = zonedParts(new Date(), TZ).date
const day = (n: number) => addDaysToDate(today, n)
const at = (date: string, time: string) => zonedToUtc(date, time, TZ).toISOString()

describe.skipIf(!up)('appointments over HTTP', () => {
  let gymA: string
  let gymB: string
  const staff: Record<string, { cookie: string; id?: string }> = {}
  let coachA: string
  let coachB: string
  let typeId: string
  let me: Awaited<ReturnType<typeof createMember>>
  let bearer: string
  let other: Awaited<ReturnType<typeof createMember>>
  let otherBearer: string
  let outsiderBearer: string
  let foreignOwner: string

  async function account(ownerId: string) {
    const member = await createMember(ownerId)
    const { token } = await createInvite(ownerId, member.id)
    await setPasswordWithToken(token, PASSWORD)
    return { member, bearer: await memberBearer(member.id) }
  }
  async function person(ownerId: string, role: string, hours = true) {
    const row = await prisma.staff.create({ data: { ownerId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role, isCoach: role === 'coach' || role === 'trainer' } })
    if (hours) await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId, staffId: row.id, weekday, startMinute: 540, endMinute: 1020, kind: 'work' })) })
    return { id: row.id, cookie: `auth-token=${await createToken({ ownerId, staffId: row.id, role: role as any })}` }
  }

  beforeAll(async () => {
    gymA = await createGym({ timezone: TZ })
    gymB = await createGym({ timezone: TZ })
    staff.owner = { cookie: `auth-token=${await createToken({ ownerId: gymA, emailVerified: true })}` }
    foreignOwner = `auth-token=${await createToken({ ownerId: gymB, emailVerified: true })}`
    for (const role of ['manager', 'front_desk', 'coach', 'accountant', 'sales']) staff[role] = await person(gymA, role, role === 'coach')
    coachA = staff.coach.id!
    coachB = (await person(gymA, 'coach')).id
    staff.coach2 = { cookie: `auth-token=${await createToken({ ownerId: gymA, staffId: coachB, role: 'coach' })}`, id: coachB }
    const a = await account(gymA); me = a.member; bearer = a.bearer
    const b = await account(gymA); other = b.member; otherBearer = b.bearer
    outsiderBearer = (await account(gymB)).bearer
  })
  afterAll(async () => { await destroyGym(gymA); await destroyGym(gymB) })

  describe('appointment types', () => {
    const body = () => ({ name: '60 Minute Personal Training', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 60, cancelWindowHours: 12, staffIds: [coachA, coachB] })

    it('lets managers create, edit and disable types, and nobody below them', async () => {
      for (const role of ['front_desk', 'coach', 'accountant', 'sales']) expect((await call(staff[role].cookie, 'POST', '/api/appointments/types', body())).status, role).toBe(403)
      expect((await call(null, 'POST', '/api/appointments/types', body())).status).toBe(401)
      const created = await call(staff.manager.cookie, 'POST', '/api/appointments/types', body())
      expect(created.status).toBe(200)
      expect(created.data).toMatchObject({ name: '60 Minute Personal Training', durationMin: 60, isActive: true })
      expect(created.data.staff.map((s: any) => s.id).sort()).toEqual([coachA, coachB].sort())
      typeId = created.data.id

      const edited = await call(staff.owner.cookie, 'PATCH', `/api/appointments/types/${typeId}`, { description: 'One hour with a coach', cancelWindowHours: 24 })
      expect(edited.data).toMatchObject({ description: 'One hour with a coach', cancelWindowHours: 24 })
      expect((await call(staff.front_desk.cookie, 'PATCH', `/api/appointments/types/${typeId}`, { name: 'Hacked' })).status).toBe(403)
      await call(staff.owner.cookie, 'PATCH', `/api/appointments/types/${typeId}`, { cancelWindowHours: 12 })

      const spare = await call(staff.owner.cookie, 'POST', '/api/appointments/types', { ...body(), name: 'Spare' })
      expect((await call(staff.coach.cookie, 'DELETE', `/api/appointments/types/${spare.data.id}`)).status).toBe(403)
      expect((await call(staff.owner.cookie, 'DELETE', `/api/appointments/types/${spare.data.id}`)).data).toEqual({ isActive: false })
      const listed = await call(staff.front_desk.cookie, 'GET', '/api/appointments/types')
      expect(listed.data.map((t: any) => t.name)).not.toContain('Spare')
      expect((await call(staff.owner.cookie, 'GET', '/api/appointments/types?all=1')).data.map((t: any) => t.name)).toContain('Spare')
    })

    it('validates input and refuses ids from another gym', async () => {
      expect((await call(staff.owner.cookie, 'POST', '/api/appointments/types', { ...body(), durationMin: 47 })).status).toBe(400)
      expect((await call(staff.owner.cookie, 'POST', '/api/appointments/types', { ...body(), paymentMode: 'paid', priceCents: 0 })).status).toBe(400)
      const foreignCoach = await person(gymB, 'coach')
      const foreignPlan = await createPlan(gymB)
      expect((await call(staff.owner.cookie, 'POST', '/api/appointments/types', { ...body(), staffIds: [foreignCoach.id] })).status).toBe(404)
      expect((await call(staff.owner.cookie, 'POST', '/api/appointments/types', { ...body(), requiredPlanIds: [foreignPlan.id] })).status).toBe(404)
      // Another gym cannot read or change this gym's types.
      expect((await call(foreignOwner, 'PATCH', `/api/appointments/types/${typeId}`, { name: 'Taken over' })).status).toBe(404)
      expect((await call(foreignOwner, 'GET', '/api/appointments/types?all=1')).data).toEqual([])
    })
  })

  describe('staff availability', () => {
    it('lets a manager set anyone\'s hours and a coach only their own', async () => {
      const week = { hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 960 })), breaks: [{ weekday: 1, startMinute: 720, endMinute: 780 }] }
      const spare = await person(gymA, 'coach', false)
      expect((await call(staff.manager.cookie, 'PUT', `/api/appointments/availability/${spare.id}`, week)).status).toBe(200)
      const read = await call(staff.front_desk.cookie, 'GET', `/api/appointments/availability/${spare.id}`)
      expect(read.data.hours).toHaveLength(5)
      expect(read.data.breaks).toEqual([{ weekday: 1, startMinute: 720, endMinute: 780 }])
      expect((await call(spare.cookie, 'PUT', `/api/appointments/availability/${spare.id}`, week)).status).toBe(200)
      expect((await call(staff.coach.cookie, 'PUT', `/api/appointments/availability/${spare.id}`, week)).status).toBe(403)
      expect((await call(staff.front_desk.cookie, 'PUT', `/api/appointments/availability/${spare.id}`, week)).status).toBe(403)
      expect((await call(staff.owner.cookie, 'PUT', `/api/appointments/availability/${spare.id}`, { hours: [{ weekday: 1, startMinute: 600, endMinute: 540 }] })).status).toBe(400)
      expect((await call(foreignOwner, 'GET', `/api/appointments/availability/${spare.id}`)).status).toBe(404)
      expect((await call(foreignOwner, 'PUT', `/api/appointments/availability/${spare.id}`, week)).status).toBe(404)

      const off = await call(spare.cookie, 'POST', '/api/appointments/time-off', { staffId: spare.id, startsAt: at(day(20), '00:00'), endsAt: at(day(22), '00:00'), kind: 'vacation', note: 'Away' })
      expect(off.status).toBe(200)
      expect((await call(staff.coach.cookie, 'POST', '/api/appointments/time-off', { staffId: spare.id, startsAt: at(day(25), '00:00'), endsAt: at(day(26), '00:00') })).status).toBe(403)
      expect((await call(staff.coach.cookie, 'DELETE', `/api/appointments/time-off/${off.data.id}`)).status).toBe(403)
      expect((await call(foreignOwner, 'DELETE', `/api/appointments/time-off/${off.data.id}`)).status).toBe(404)
      expect((await call(spare.cookie, 'DELETE', `/api/appointments/time-off/${off.data.id}`)).status).toBe(200)
    })
  })

  describe('staff booking and management', () => {
    let appointmentId: string

    it('returns real availability and books a member in', async () => {
      const slots = await call(staff.front_desk.cookie, 'GET', `/api/appointments/slots?typeId=${typeId}&date=${day(4)}&staffId=${coachA}`)
      expect(slots.status).toBe(200)
      expect(slots.data[0]).toMatchObject({ startsAt: at(day(4), '09:00'), staff: [{ id: coachA }] })
      expect(slots.data.at(-1).startsAt).toBe(at(day(4), '16:00'))

      expect((await call(staff.accountant.cookie, 'POST', '/api/appointments', { typeId, memberId: me.id, staffId: coachA, startsAt: at(day(4), '10:00') })).status).toBe(403)
      const booked = await call(staff.front_desk.cookie, 'POST', '/api/appointments', { typeId, memberId: me.id, staffId: coachA, startsAt: at(day(4), '10:00'), notes: 'First session' })
      expect(booked.status).toBe(200)
      expect(booked.data).toMatchObject({ status: 'booked', staff: { id: coachA }, payment: { status: 'none' } })
      appointmentId = booked.data.id
      const clash = await call(staff.front_desk.cookie, 'POST', '/api/appointments', { typeId, memberId: other.id, staffId: coachA, startsAt: at(day(4), '10:30'), override: true })
      expect(clash.status).toBe(409)
      const after = await call(staff.front_desk.cookie, 'GET', `/api/appointments/slots?typeId=${typeId}&date=${day(4)}&staffId=${coachA}`)
      expect(after.data.map((s: any) => s.startsAt)).not.toContain(at(day(4), '10:00'))
    })

    it('handles two simultaneous HTTP bookings for the same coach and time: one wins', async () => {
      const startsAt = at(day(5), '11:00')
      const results = await Promise.all([
        call(staff.front_desk.cookie, 'POST', '/api/appointments', { typeId, memberId: me.id, staffId: coachB, startsAt }),
        call(staff.manager.cookie, 'POST', '/api/appointments', { typeId, memberId: other.id, staffId: coachB, startsAt }),
        call(bearer, 'POST', '/api/portal/me/appointments', { typeId, staffId: coachB, startsAt }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
      expect(await prisma.appointment.count({ where: { ownerId: gymA, staffId: coachB, startsAt: new Date(startsAt), status: 'booked' } })).toBe(1)
    })

    it('limits coaches to their own diary', async () => {
      const mine = await call(staff.coach.cookie, 'GET', '/api/appointments')
      expect(mine.data.length).toBeGreaterThan(0)
      expect(mine.data.every((a: any) => a.staff.id === coachA)).toBe(true)
      // Asking for someone else's diary still returns their own.
      expect((await call(staff.coach.cookie, 'GET', `/api/appointments?staffId=${coachB}`)).data.every((a: any) => a.staff.id === coachA)).toBe(true)
      const theirs = await prisma.appointment.findFirstOrThrow({ where: { ownerId: gymA, staffId: coachB } })
      expect((await call(staff.coach.cookie, 'GET', `/api/appointments/${theirs.id}`)).status).toBe(404)
      expect((await call(staff.coach.cookie, 'POST', `/api/appointments/${theirs.id}`, { action: 'cancel' })).status).toBe(404)
      expect((await call(staff.coach.cookie, 'POST', '/api/appointments', { typeId, memberId: other.id, staffId: coachB, startsAt: at(day(6), '09:00') })).status).toBe(403)
      // In their own diary they can book and manage.
      const own = await call(staff.coach.cookie, 'POST', '/api/appointments', { typeId, memberId: other.id, startsAt: at(day(6), '09:00') })
      expect(own.data.staff.id).toBe(coachA)
      // Being able to run appointments gives a coach nothing financial or administrative.
      for (const path of ['/api/billing/transactions', '/api/reports/financial', '/api/staff', '/api/business-settings', '/api/audit-logs']) expect((await call(staff.coach.cookie, 'GET', path)).status, path).toBe(403)
    })

    it('reschedules, keeps notes, and records attendance and no-shows with the right permissions', async () => {
      expect((await call(staff.accountant.cookie, 'GET', `/api/appointments/${appointmentId}`)).status).toBe(200)
      expect((await call(staff.accountant.cookie, 'POST', `/api/appointments/${appointmentId}`, { action: 'cancel' })).status).toBe(403)
      const moved = await call(staff.front_desk.cookie, 'POST', `/api/appointments/${appointmentId}`, { action: 'reschedule', startsAt: at(day(4), '14:00') })
      expect(moved.data).toMatchObject({ status: 'booked', startsAt: at(day(4), '14:00') })
      expect((await call(staff.front_desk.cookie, 'POST', `/api/appointments/${appointmentId}`, { action: 'reschedule', startsAt: at(day(4), '03:00') })).status).toBe(422)
      expect((await call(staff.front_desk.cookie, 'PATCH', `/api/appointments/${appointmentId}`, { staffNotes: 'Knee injury, go easy' })).status).toBe(200)
      const detail = await call(staff.front_desk.cookie, 'GET', `/api/appointments/${appointmentId}`)
      expect(detail.data).toMatchObject({ staffNotes: 'Knee injury, go easy', notes: 'First session', rescheduleCount: 1, member: { id: me.id } })
      expect((await call(staff.front_desk.cookie, 'POST', `/api/appointments/${appointmentId}`, { action: 'complete' })).json.code).toBe('too_early')

      const soon = new Date(Math.ceil((Date.now() + 10 * 60_000) / 300_000) * 300_000).toISOString()
      const now1 = await call(staff.manager.cookie, 'POST', '/api/appointments', { typeId, memberId: me.id, staffId: coachA, startsAt: soon, override: true })
      expect(now1.status).toBe(200)
      expect((await call(staff.coach.cookie, 'POST', `/api/appointments/${now1.data.id}`, { action: 'complete' })).data).toEqual({ status: 'completed' })
      expect((await call(staff.coach.cookie, 'POST', `/api/appointments/${now1.data.id}`, { action: 'no_show' })).status).toBe(422)
      expect(await prisma.checkin.count({ where: { memberId: me.id, type: 'personal_training' } })).toBe(1)
    })

    it("cannot be read or changed from another gym", async () => {
      expect((await call(foreignOwner, 'GET', `/api/appointments/${appointmentId}`)).status).toBe(404)
      expect((await call(foreignOwner, 'POST', `/api/appointments/${appointmentId}`, { action: 'cancel' })).status).toBe(404)
      expect((await call(foreignOwner, 'PATCH', `/api/appointments/${appointmentId}`, { staffNotes: 'x' })).status).toBe(404)
      expect((await call(foreignOwner, 'GET', '/api/appointments')).data).toEqual([])
      expect((await call(foreignOwner, 'GET', `/api/appointments/slots?typeId=${typeId}&date=${day(4)}`)).status).toBe(404)
      const theirMember = await createMember(gymB)
      expect((await call(foreignOwner, 'POST', '/api/appointments', { typeId, memberId: theirMember.id, staffId: coachA, startsAt: at(day(7), '09:00') })).status).toBe(404)
      expect((await call(staff.owner.cookie, 'POST', '/api/appointments', { typeId, memberId: theirMember.id, staffId: coachA, startsAt: at(day(7), '09:00') })).status).toBe(404)
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe('booked')
    })
  })

  describe('member app', () => {
    let mineId: string

    it('shows what can be booked, who offers it and real times', async () => {
      const options = await call(bearer, 'GET', '/api/portal/me/appointments/options')
      expect(options.status).toBe(200)
      const type = options.data.types.find((t: any) => t.id === typeId)
      expect(type).toMatchObject({ name: '60 Minute Personal Training', durationMin: 60, priceLabel: 'Included', blocked: null, cancelWindowHours: 12 })
      expect(type.coaches.map((c: any) => c.id).sort()).toEqual([coachA, coachB].sort())
      expect(options.data.types.map((t: any) => t.name)).not.toContain('Spare')
      const slots = await call(bearer, 'GET', `/api/portal/me/appointments/slots?typeId=${typeId}&date=${day(8)}`)
      expect(slots.data[0]).toMatchObject({ startsAt: at(day(8), '09:00') })
      expect(slots.data[0].coaches.length).toBe(2)
      // Staff ids and names only: no emails, roles or other members.
      expect(slots.text).not.toMatch(/@test\.local|"role"|"email"/)
      expect((await call(null, 'GET', `/api/portal/me/appointments/slots?typeId=${typeId}&date=${day(8)}`)).status).toBe(401)
    })

    it('books, appears on Home and in the lists, moves and cancels', async () => {
      const booked = await call(bearer, 'POST', '/api/portal/me/appointments', { typeId, staffId: null, startsAt: at(day(8), '10:00'), notes: 'Work on squat' })
      expect(booked.status).toBe(200)
      expect(booked.data.appointment).toMatchObject({ status: 'booked', durationMin: 60, notes: 'Work on squat', can: { cancel: true, cancelFree: true, reschedule: true } })
      mineId = booked.data.appointment.id
      // Overlapping their own appointment: with "any available" the time is simply not offered; naming a coach is a clash.
      expect((await call(bearer, 'POST', '/api/portal/me/appointments', { typeId, staffId: null, startsAt: at(day(8), '10:30') })).json.code).toBe('slot_unavailable')
      expect((await call(staff.owner.cookie, 'POST', '/api/appointments', { typeId, memberId: me.id, staffId: booked.data.appointment.coach.id === coachA ? coachB : coachA, startsAt: at(day(8), '10:30'), override: true })).json.code).toBe('member_busy')
      // A member cannot use the staff override.
      expect((await call(bearer, 'POST', '/api/portal/me/appointments', { typeId, staffId: coachA, startsAt: at(day(8), '05:00'), override: true })).status).toBe(422)

      const home = await call(bearer, 'GET', '/api/portal/me')
      expect(home.data.appointments.map((a: any) => a.id)).toContain(mineId)
      expect(home.data.inbox.latest.some((n: any) => n.category === 'appointment')).toBe(true)
      const lists = await call(bearer, 'GET', '/api/portal/me/appointments')
      expect(lists.data.upcoming.map((a: any) => a.id)).toContain(mineId)
      expect(lists.text).not.toContain('Knee injury')
      const detail = await call(bearer, 'GET', `/api/portal/me/appointments/${mineId}`)
      expect(detail.data).toMatchObject({ id: mineId, type: { name: '60 Minute Personal Training' }, cancelWindowHours: 12 })
      expect(detail.data.staffNotes).toBeUndefined()

      const ics = await fetch(`${BASE}/api/portal/me/appointments/${mineId}/calendar`, { headers: { Authorization: bearer } })
      expect(ics.status).toBe(200)
      expect(ics.headers.get('content-type')).toContain('text/calendar')
      expect(await ics.text()).toContain('BEGIN:VEVENT')

      const coach = detail.data.coach.id
      const slots = await call(bearer, 'GET', `/api/portal/me/appointments/slots?typeId=${typeId}&date=${day(8)}&staffId=${coach}&reschedule=${mineId}`)
      // Its own current time is offered again when rescheduling.
      expect(slots.data.map((s: any) => s.startsAt)).toContain(at(day(8), '10:30'))
      const moved = await call(bearer, 'POST', `/api/portal/me/appointments/${mineId}`, { action: 'reschedule', startsAt: at(day(9), '15:00'), staffId: coach })
      expect(moved.data.appointment).toMatchObject({ startsAt: at(day(9), '15:00'), rescheduledFrom: at(day(8), '10:00') })
      expect((await call(bearer, 'POST', `/api/portal/me/appointments/${mineId}`, { action: 'reschedule', startsAt: at(day(9), '23:00'), staffId: coach })).status).toBe(422)

      const cancelled = await call(bearer, 'POST', `/api/portal/me/appointments/${mineId}`, { action: 'cancel', reason: 'Away' })
      expect(cancelled.data).toMatchObject({ late: false })
      expect(cancelled.data.appointment.status).toBe('cancelled')
      const after = await call(bearer, 'GET', '/api/portal/me/appointments')
      expect(after.data.cancelled.map((a: any) => a.id)).toContain(mineId)
      expect(after.data.upcoming.map((a: any) => a.id)).not.toContain(mineId)
      const kinds = (await call(bearer, 'GET', '/api/portal/me/notifications?category=appointment')).data.items.map((n: any) => n.type)
      expect(kinds).toEqual(expect.arrayContaining(['appointment_booked', 'appointment_rescheduled', 'appointment_cancelled']))
    })

    it('spends and returns package sessions through the app', async () => {
      const pack = await createPlan(gymA, { name: '10 PT Sessions', type: 'pt_package', credits: 10, priceCents: 60000, billingInterval: 'once', isPublic: true })
      const credit = await call(staff.owner.cookie, 'POST', '/api/appointments/types', { name: 'PT (credits)', durationMin: 30, paymentMode: 'credit', minNoticeMinutes: 0, maxAdvanceDays: 60, cancelWindowHours: 12, staffIds: [coachA] })
      const before = (await call(bearer, 'GET', '/api/portal/me/appointments/options')).data.types.find((t: any) => t.id === credit.data.id)
      expect(before).toMatchObject({ blocked: 'needs_package', creditsAvailable: 0 })
      expect(before.packages.map((p: any) => p.name)).toContain('10 PT Sessions')
      expect((await call(bearer, 'POST', '/api/portal/me/appointments', { typeId: credit.data.id, staffId: coachA, startsAt: at(day(10), '09:00') })).json.code).toBe('no_package')
      // This test gym has no processor connected, so buying online is refused rather than granted unpaid.
      const buy = await call(bearer, 'POST', '/api/portal/me/packages', { planId: pack.id })
      expect(buy.status).toBe(409)
      expect(await prisma.membership.count({ where: { memberId: me.id, planId: pack.id } })).toBe(0)

      await tx((db) => sellMembership(db, { ownerId: gymA, memberId: me.id, planId: pack.id, paymentMethod: 'cash', collectNow: true }))
      const options = (await call(bearer, 'GET', '/api/portal/me/appointments/options')).data
      expect(options.packages).toEqual([expect.objectContaining({ name: '10 PT Sessions', sessionsRemaining: 10 })])
      const booked = await call(bearer, 'POST', '/api/portal/me/appointments', { typeId: credit.data.id, staffId: coachA, startsAt: at(day(10), '09:00') })
      expect(booked.data.creditsRemaining).toBe(9)
      expect(booked.data.appointment.payment).toMatchObject({ mode: 'credit', label: '1 session from 10 PT Sessions' })
      expect((await call(bearer, 'GET', '/api/portal/me/appointments/options')).data.packages[0].sessionsRemaining).toBe(9)
      const cancelled = await call(bearer, 'POST', `/api/portal/me/appointments/${booked.data.appointment.id}`, { action: 'cancel' })
      expect(cancelled.data).toMatchObject({ late: false, creditsReturned: true })
      expect((await call(bearer, 'GET', '/api/portal/me/appointments/options')).data.packages[0].sessionsRemaining).toBe(10)
    })

    it("never shows or touches another member's appointments, in or out of the gym", async () => {
      const theirs = await call(otherBearer, 'POST', '/api/portal/me/appointments', { typeId, staffId: coachA, startsAt: at(day(11), '09:00') })
      expect(theirs.status).toBe(200)
      const id = theirs.data.appointment.id
      for (const auth of [bearer, outsiderBearer]) {
        expect((await call(auth, 'GET', `/api/portal/me/appointments/${id}`)).status).toBe(404)
        expect((await call(auth, 'POST', `/api/portal/me/appointments/${id}`, { action: 'cancel' })).status).toBe(404)
        expect((await call(auth, 'POST', `/api/portal/me/appointments/${id}`, { action: 'reschedule', startsAt: at(day(11), '13:00') })).status).toBe(404)
        expect((await fetch(`${BASE}/api/portal/me/appointments/${id}/calendar`, { headers: { Authorization: auth } })).status).toBe(404)
        expect((await call(auth, 'GET', '/api/portal/me/appointments')).text).not.toContain(id)
      }
      // A member cannot free up a slot by naming someone else's appointment as the one being moved.
      expect((await call(bearer, 'GET', `/api/portal/me/appointments/slots?typeId=${typeId}&date=${day(11)}&staffId=${coachA}&reschedule=${id}`)).status).toBe(404)
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('booked')
      // A member of another gym cannot see or book this gym's types.
      expect((await call(outsiderBearer, 'GET', '/api/portal/me/appointments/options')).data.types).toEqual([])
      expect((await call(outsiderBearer, 'GET', `/api/portal/me/appointments/slots?typeId=${typeId}&date=${day(11)}`)).status).toBe(404)
      expect((await call(outsiderBearer, 'POST', '/api/portal/me/appointments', { typeId, staffId: coachA, startsAt: at(day(11), '14:00') })).status).toBe(404)
      // Members have no access to the staff appointment API at all.
      expect((await call(bearer, 'GET', '/api/appointments')).status).toBe(401)
      expect((await call(bearer, 'POST', '/api/appointments', { typeId, memberId: me.id, staffId: coachA, startsAt: at(day(12), '09:00') })).status).toBe(401)
    })
  })
})
