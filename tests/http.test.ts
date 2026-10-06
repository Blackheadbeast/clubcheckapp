// End-to-end checks over real HTTP against a running dev server (npm run dev).
// Skipped automatically when nothing is listening on TEST_BASE_URL.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { createGym, createMember, createPlan, createSession, destroyGym } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try {
  up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0
} catch {}

interface Session { cookie: string }
let gymA: string
let gymB: string
const users: Record<string, Session> = {}
const staffIds: Record<string, string> = {}

async function call(who: Session | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(who && { Cookie: who.cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text }
}

describe.skipIf(!up)('HTTP API', () => {
  beforeAll(async () => {
    gymA = await createGym()
    gymB = await createGym()
    const password = await bcrypt.hash('irrelevant-password', 4)
    users.owner = { cookie: `auth-token=${await createToken({ ownerId: gymA, emailVerified: true })}` }
    users.otherOwner = { cookie: `auth-token=${await createToken({ ownerId: gymB, emailVerified: true })}` }
    for (const role of ['admin', 'manager', 'front_desk', 'coach', 'sales', 'accountant'] as const) {
      const staff = await prisma.staff.create({ data: { ownerId: gymA, name: `Test ${role}`, email: `${role}@test.local`, password, role } })
      staffIds[role] = staff.id
      users[role] = { cookie: `auth-token=${await createToken({ ownerId: gymA, staffId: staff.id, role })}` }
    }
  })
  afterAll(async () => {
    await destroyGym(gymA)
    await destroyGym(gymB)
  })

  describe('authentication', () => {
    it('rejects requests with no session', async () => {
      for (const path of ['/api/members', '/api/dashboard', '/api/billing/transactions', '/api/reports/financial', '/api/me']) {
        expect((await call(null, 'GET', path)).status, path).toBe(401)
      }
    })
    it('rejects a forged token', async () => {
      expect((await call({ cookie: 'auth-token=eyJhbGciOiJIUzI1NiJ9.eyJvd25lcklkIjoieCJ9.invalid' }, 'GET', '/api/members')).status).toBe(401)
    })
    it('rejects a valid token whose account has been deleted', async () => {
      const gone = await createGym()
      const session = { cookie: `auth-token=${await createToken({ ownerId: gone, emailVerified: true })}` }
      expect((await call(session, 'GET', '/api/dashboard')).status).toBe(200)
      await destroyGym(gone)
      expect((await call(session, 'GET', '/api/dashboard')).status).toBe(401)
      expect((await call(session, 'GET', '/api/settings')).status).toBe(401)
    })
    it('locks out a deactivated staff account immediately, without waiting for the token to expire', async () => {
      const staff = await prisma.staff.create({ data: { ownerId: gymA, name: 'Leaver', email: 'leaver@test.local', password: 'x', role: 'manager' } })
      const session = { cookie: `auth-token=${await createToken({ ownerId: gymA, staffId: staff.id, role: 'manager' })}` }
      expect((await call(session, 'GET', '/api/members')).status).toBe(200)
      await prisma.staff.update({ where: { id: staff.id }, data: { active: false } })
      expect((await call(session, 'GET', '/api/members')).status).toBe(401)
      expect((await call(session, 'GET', '/api/settings')).status).toBe(401)
    })
    it('applies a role downgrade immediately, even though the token still says manager', async () => {
      const staff = await prisma.staff.create({ data: { ownerId: gymA, name: 'Demoted', email: 'demoted@test.local', password: 'x', role: 'manager' } })
      const session = { cookie: `auth-token=${await createToken({ ownerId: gymA, staffId: staff.id, role: 'manager' })}` }
      expect((await call(session, 'GET', '/api/billing/transactions')).status).toBe(200)
      await prisma.staff.update({ where: { id: staff.id }, data: { role: 'coach' } })
      expect((await call(session, 'GET', '/api/billing/transactions')).status).toBe(403)
    })
  })

  describe('tenant isolation', () => {
    it("never returns or changes another gym's records", async () => {
      const theirs = await createMember(gymB, { name: 'Other Gym Member' })
      const theirPlan = await createPlan(gymB)
      const theirSession = await createSession(gymB)
      const mine = await createMember(gymA)

      expect((await call(users.owner, 'GET', `/api/members/${theirs.id}`)).status).toBe(404)
      expect((await call(users.owner, 'PATCH', `/api/members/${theirs.id}`, { name: 'Hacked' })).status).toBe(404)
      expect((await call(users.owner, 'DELETE', `/api/members/${theirs.id}`)).status).toBe(404)
      expect((await call(users.owner, 'GET', `/api/members/${theirs.id}/timeline`)).status).toBe(404)
      expect((await call(users.owner, 'GET', `/api/checkin/card/${theirs.id}`)).status).toBe(404)
      expect((await call(users.owner, 'POST', '/api/checkin', { memberId: theirs.id })).status).toBe(404)
      expect((await call(users.owner, 'POST', `/api/members/${mine.id}/memberships`, { planId: theirPlan.id, paymentMethod: 'cash' })).status).toBe(404)
      expect((await call(users.owner, 'POST', '/api/bookings', { memberId: mine.id, sessionId: theirSession.id })).status).toBe(404)
      expect((await call(users.owner, 'GET', `/api/schedule/sessions/${theirSession.id}`)).status).toBe(404)
      expect((await call(users.owner, 'POST', '/api/members/bulk', { action: 'delete', ids: [theirs.id] })).data).toEqual({ affected: 0 })
      expect((await call(users.owner, 'PATCH', `/api/members/${mine.id}`, { homeLocationId: (await prisma.location.create({ data: { ownerId: gymB, name: 'Theirs' } })).id })).status).toBe(404)

      const search = await call(users.owner, 'GET', '/api/search?q=Other%20Gym')
      expect(search.data).toEqual([])
      const list = await call(users.owner, 'GET', '/api/members?search=Other')
      expect(list.data).toEqual([])
      expect((await prisma.member.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe('Other Gym Member')
    })
  })

  describe('role permissions (enforced server-side)', () => {
    const cases: [string, string, string, unknown, number][] = [
      // role, method, path, body, expected status
      ['coach', 'GET', '/api/billing/transactions', undefined, 403],
      ['coach', 'GET', '/api/billing/invoices', undefined, 403],
      ['coach', 'GET', '/api/reports/financial', undefined, 403],
      ['coach', 'GET', '/api/staff', undefined, 403],
      ['coach', 'POST', '/api/members', { name: 'X', email: 'x@test.local' }, 403],
      ['coach', 'GET', '/api/members', undefined, 200],
      ['coach', 'GET', '/api/schedule/sessions', undefined, 200],
      ['front_desk', 'GET', '/api/members', undefined, 200],
      ['front_desk', 'GET', '/api/reports/financial', undefined, 403],
      ['front_desk', 'GET', '/api/staff', undefined, 403],
      ['front_desk', 'POST', '/api/membership-plans', { name: 'P', type: 'recurring', priceCents: 100 }, 403],
      ['front_desk', 'PUT', '/api/business-settings', {}, 403],
      ['front_desk', 'POST', '/api/schedule/class-types', { name: 'Zumba' }, 403],
      ['front_desk', 'POST', '/api/campaigns', {}, 403],
      ['accountant', 'GET', '/api/billing/transactions', undefined, 200],
      ['accountant', 'GET', '/api/reports/financial', undefined, 200],
      ['accountant', 'POST', '/api/checkin', { memberId: '00000000-0000-4000-8000-000000000000' }, 403],
      ['accountant', 'POST', '/api/leads', { name: 'L', email: 'l@test.local' }, 403],
      ['sales', 'GET', '/api/leads', undefined, 200],
      ['sales', 'GET', '/api/reports/financial', undefined, 403],
      ['sales', 'GET', '/api/pos/products', undefined, 403],
      ['manager', 'GET', '/api/reports/financial', undefined, 200],
      ['manager', 'GET', '/api/staff', undefined, 403],
      ['manager', 'PUT', '/api/business-settings', {}, 403],
      ['manager', 'GET', '/api/audit-logs', undefined, 403],
      ['admin', 'GET', '/api/staff', undefined, 200],
      ['admin', 'GET', '/api/audit-logs', undefined, 200],
      // Legacy routes guarded by the middleware + session re-check
      ['front_desk', 'GET', '/api/members/export', undefined, 403],
      ['coach', 'POST', '/api/broadcast', { subject: 's', message: 'm', targetGroup: 'all' }, 403],
      ['admin', 'POST', '/api/settings/password', { currentPassword: 'a', newPassword: 'bbbbbbbb' }, 403],
      ['manager', 'GET', '/api/invoices', undefined, 403],
      ['admin', 'POST', '/api/stripe/create-subscription', { plan: 'pro' }, 403],
      ['front_desk', 'PUT', '/api/settings', { gymName: 'Renamed' }, 403],
    ]
    it.each(cases)('%s %s %s -> %i', async (role, method, path, body, expected) => {
      expect((await call(users[role], method, path, body)).status).toBe(expected)
    })

    it('ignores a client-supplied copy of the internal permission header', async () => {
      const res = await call(users.front_desk, 'PUT', '/api/settings', { gymName: 'Renamed' }, { 'x-cc-requires': 'any' })
      expect(res.status).toBe(403)
      expect((await prisma.gymProfile.findUniqueOrThrow({ where: { ownerId: gymA } })).name).toBe('Test Gym')
    })

    it('lets front desk take payments but not refund them, and hides billing from coaches', async () => {
      const member = await createMember(gymA)
      const plan = await createPlan(gymA)
      const sale = await call(users.owner, 'POST', `/api/members/${member.id}/memberships`, { planId: plan.id, paymentMethod: 'cash' })
      expect(sale.status).toBe(200)
      const invoiceId = sale.data.invoice.id
      const pay = await call(users.front_desk, 'POST', `/api/billing/invoices/${invoiceId}/pay`, { method: 'cash' })
      expect(pay.status).toBe(200)
      expect((await call(users.front_desk, 'POST', `/api/billing/transactions/${pay.data.transactionId}/refund`, {})).status).toBe(403)
      expect((await call(users.front_desk, 'POST', `/api/members/${member.id}/credit`, { amountCents: 5000 })).status).toBe(403)
      // A coach can open the profile but gets no financial fields and no payment events
      const profile = await call(users.coach, 'GET', `/api/members/${member.id}`)
      expect(profile.status).toBe(200)
      expect(profile.data.billing).toBeNull()
      const timeline = await call(users.coach, 'GET', `/api/members/${member.id}/timeline`)
      expect(timeline.data.some((a: any) => a.type === 'payment')).toBe(false)
      expect((await call(users.coach, 'GET', `/api/members/${member.id}/invoices`)).status).toBe(403)
      // Accountant can refund
      expect((await call(users.accountant, 'POST', `/api/billing/transactions/${pay.data.transactionId}/refund`, { amountCents: 1000 })).status).toBe(200)
    })

    it('never sends password hashes or portal tokens to the browser', async () => {
      const member = await createMember(gymA, { accessToken: 'a'.repeat(64) })
      for (const path of [`/api/members/${member.id}`, '/api/members', '/api/staff', '/api/me', '/api/lookups']) {
        const res = await call(users.owner, 'GET', path)
        expect(res.text, path).not.toMatch(/"password"|\$2[aby]\$|"accessToken"|"waiverSignature"|"kioskPinHash"/)
      }
    })

    it('stops staff changing their own role', async () => {
      const res = await call(users.admin, 'PATCH', `/api/staff/${staffIds.admin}`, { active: false })
      expect(res.status).toBe(403)
    })
  })

  describe('validation and errors', () => {
    it('returns a consistent error shape', async () => {
      const bad = await call(users.owner, 'POST', '/api/members', { name: '', email: 'not-an-email' })
      expect(bad.status).toBe(400)
      expect(bad.json).toMatchObject({ code: 'validation_error', error: expect.any(String) })
      const notJson = await fetch(`${BASE}/api/members`, { method: 'POST', headers: { Cookie: users.owner.cookie, 'Content-Type': 'application/json' }, body: '{nope' })
      expect(notJson.status).toBe(400)
      expect((await call(users.owner, 'GET', '/api/members/not-a-real-id')).status).toBe(404)
      expect((await call(users.owner, 'GET', '/api/reports/nonsense')).status).toBe(404)
    })
    it('paginates and caps page size', async () => {
      const res = await call(users.owner, 'GET', '/api/members?pageSize=5000')
      expect(res.json.meta.pageSize).toBe(100)
      expect(res.json.meta).toMatchObject({ page: 1, total: expect.any(Number), totalPages: expect.any(Number) })
    })
    it('refuses a duplicate member email', async () => {
      const body = { name: 'Dup One', email: 'dup@test.local' }
      expect((await call(users.owner, 'POST', '/api/members', body)).status).toBe(200)
      expect((await call(users.owner, 'POST', '/api/members', { ...body, name: 'Dup Two' })).json.code).toBe('duplicate_email')
    })
  })

  describe('a day at the gym', () => {
    it('runs the whole member journey and the numbers add up', async () => {
      const o = users.owner
      const before = (await call(o, 'GET', '/api/reports/financial?range=today')).data.summary

      // Set up: location, plan, class type, a weekly class and a one-off session today
      const location = (await call(o, 'POST', '/api/locations', { name: 'Main' })).data
      const plan = (await call(o, 'POST', '/api/membership-plans', { name: 'Journey Unlimited', type: 'recurring', priceCents: 12000 })).data
      const classType = (await call(o, 'POST', '/api/schedule/class-types', { name: 'Journey HIIT', defaultCapacity: 1 })).data
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      const recurring = await call(o, 'POST', '/api/schedule/schedules', { classTypeId: classType.id, capacity: 10, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '07:00', durationMin: 60, startDate: tomorrow })
      expect(recurring.data.sessionsCreated).toBeGreaterThan(40)
      const session = (await call(o, 'POST', '/api/schedule/sessions', { classTypeId: classType.id, locationId: location.id, capacity: 1, waitlistCapacity: 2, date: tomorrow, startTime: '18:00', durationMin: 60 })).data

      // Lead -> member with a membership, paid at the desk
      const lead = (await call(o, 'POST', '/api/leads', { name: 'Journey Lead', email: 'journey@test.local', source: 'Referral' })).data
      expect((await call(o, 'PATCH', `/api/leads/${lead.id}`, { status: 'trial_scheduled', trialDate: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(200)
      const converted = await call(o, 'POST', `/api/leads/${lead.id}/convert`, { planId: plan.id, paymentMethod: 'cash', collectNow: true })
      expect(converted.status).toBe(200)
      const memberId = converted.data.memberId
      let profile = (await call(o, 'GET', `/api/members/${memberId}`)).data
      expect(profile.status).toBe('active')
      expect(profile.billing.lifetimePaidCents).toBe(12000)
      expect(profile.leadSource).toBe('Referral')

      // Booking: first member gets the spot, the second is waitlisted, then promoted when the first cancels
      const second = await createMember(gymA)
      await call(o, 'POST', `/api/members/${second.id}/memberships`, { planId: plan.id, paymentMethod: 'cash' })
      const b1 = await call(o, 'POST', '/api/bookings', { memberId, sessionId: session.id })
      expect(b1.data.status).toBe('booked')
      const b2 = await call(o, 'POST', '/api/bookings', { memberId: second.id, sessionId: session.id })
      expect(b2.data).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
      const roster = (await call(o, 'GET', `/api/schedule/sessions/${session.id}`)).data
      expect(roster.booked).toBe(1)
      expect(roster.waitlist).toHaveLength(1)
      const cancelled = await call(o, 'POST', `/api/bookings/${b1.data.id}`, { action: 'cancel' })
      expect(cancelled.data.promoted).toBe(1)
      expect((await call(o, 'POST', `/api/bookings/${b2.data.id}`, { action: 'claim' })).data.status).toBe('booked')

      // Check-in by scanned QR code, then a double scan
      const qr = (await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).qrCode
      const checkin = await call(users.front_desk, 'POST', '/api/checkin', { qrCode: qr, locationId: location.id })
      expect(checkin.data).toMatchObject({ duplicate: false, streak: { current: 1 } })
      expect(checkin.data.member.membership.name).toBe('Journey Unlimited')
      expect((await call(users.front_desk, 'POST', '/api/checkin', { qrCode: qr })).data.duplicate).toBe(true)

      // POS sale against stock, then a refund that restocks
      const product = (await call(o, 'POST', '/api/pos/products', { name: 'Journey Shake', priceCents: 650, stock: 3 })).data
      const tooMany = await call(users.front_desk, 'POST', '/api/pos/orders', { items: [{ productId: product.id, quantity: 4 }], paymentMethod: 'cash' })
      expect(tooMany.json.code).toBe('out_of_stock')
      const order = await call(users.front_desk, 'POST', '/api/pos/orders', { items: [{ productId: product.id, quantity: 2 }], memberId, paymentMethod: 'cash', locationId: location.id, discountCents: 600 })
      expect(order.data.totalCents).toBe(1300) // the till cannot apply an ad-hoc discount
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1)
      expect((await call(users.front_desk, 'POST', `/api/pos/orders/${order.data.id}`, { action: 'refund' })).status).toBe(403)
      expect((await call(o, 'POST', `/api/pos/orders/${order.data.id}`, { action: 'refund', restock: true })).data.refundedCents).toBe(1300)
      expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3)

      // Freeze blocks check-in; unfreeze restores it; cancel at period end keeps access
      const membershipId = profile.memberships[0].id
      expect((await call(o, 'POST', `/api/memberships/${membershipId}`, { action: 'freeze' })).data.status).toBe('frozen')
      expect((await call(o, 'GET', `/api/members/${memberId}`)).data.status).toBe('frozen')
      await prisma.checkin.deleteMany({ where: { memberId } }) // clear the double-scan guard
      expect((await call(users.front_desk, 'POST', '/api/checkin', { memberId })).json.code).toBe('member_frozen')
      expect((await call(o, 'POST', `/api/memberships/${membershipId}`, { action: 'unfreeze' })).data.status).toBe('active')
      const cancel = await call(o, 'POST', `/api/memberships/${membershipId}`, { action: 'cancel', when: 'period_end', reason: 'Moving' })
      expect(cancel.data.immediate).toBe(false)
      profile = (await call(o, 'GET', `/api/members/${memberId}`)).data
      expect(profile.status).toBe('active')
      expect(profile.memberships[0].cancelAt).not.toBeNull()

      // Reports are computed from what just happened
      const after = (await call(o, 'GET', '/api/reports/financial?range=today')).data.summary
      expect(after.grossCents - before.grossCents).toBe(12000 + 1300)
      expect(after.refundsCents - before.refundsCents).toBe(1300)
      const sales = (await call(o, 'GET', '/api/reports/sales?range=today')).data.summary
      expect(sales.converted).toBeGreaterThanOrEqual(1)
      const dashboard = (await call(o, 'GET', `/api/dashboard?range=today&locationId=${location.id}`)).data
      expect(dashboard.attendance.checkins).toBe(0) // the check-ins were cleared above
      expect(dashboard.revenue.netCents).toBe(0) // POS sale at this location was fully refunded

      // The timeline tells the story, and the audit log recorded who did what
      const timeline = (await call(o, 'GET', `/api/members/${memberId}/timeline?pageSize=100`)).data.map((a: any) => a.type)
      for (const type of ['joined', 'lead_converted', 'membership_purchased', 'payment', 'class_booked', 'purchase', 'refund', 'membership_frozen', 'membership_unfrozen', 'membership_cancel_scheduled']) {
        expect(timeline, type).toContain(type)
      }
      const audit = await prisma.auditLog.findMany({ where: { ownerId: gymA }, select: { action: true } })
      for (const action of ['membership.freeze', 'membership.cancel', 'order.refund', 'prospect_convert', 'plan.create']) {
        expect(audit.map((a) => a.action), action).toContain(action)
      }
      const csv = await call(o, 'GET', '/api/billing/transactions?format=csv')
      expect(csv.text.split('\n')[0]).toContain('Transaction ID')
    })
  })

  describe('member portal', () => {
    it('lets a member book and cancel only their own classes, by token', async () => {
      const plan = await createPlan(gymA, { name: 'Portal Plan' })
      const token = 'b'.repeat(64)
      const member = await createMember(gymA, { accessToken: token, accessTokenExpiry: new Date(Date.now() + 86_400_000) })
      const other = await createMember(gymA)
      for (const m of [member, other]) await call(users.owner, 'POST', `/api/members/${m.id}/memberships`, { planId: plan.id, paymentMethod: 'cash' })
      const session = await createSession(gymA, { capacity: 5 })

      expect((await call(null, 'GET', `/api/portal/${'c'.repeat(64)}`)).status).toBe(404)
      const home = await call(null, 'GET', `/api/portal/${token}`)
      expect(home.status).toBe(200)
      expect(home.data.member.name).toBe(member.name)
      expect(home.text).not.toMatch(/accessToken|medicalNotes/)

      const booked = await call(null, 'POST', `/api/portal/${token}/bookings`, { sessionId: session.id })
      expect(booked.data.status).toBe('booked')
      const theirs = await call(users.owner, 'POST', '/api/bookings', { memberId: other.id, sessionId: session.id })
      // A member cannot cancel someone else's booking with their own token
      expect((await call(null, 'POST', `/api/portal/${token}/bookings/${theirs.data.id}`, { action: 'cancel' })).status).toBe(404)
      const ics = await call(null, 'GET', `/api/portal/${token}/bookings/${booked.data.id}/calendar`)
      expect(ics.text).toContain('BEGIN:VEVENT')
      expect((await call(null, 'POST', `/api/portal/${token}/bookings/${booked.data.id}`, { action: 'cancel' })).data.status).toBe('cancelled')
      // The schedule shows availability but never other members' names
      const schedule = await call(null, 'GET', `/api/portal/${token}/schedule?days=7`)
      expect(schedule.text).not.toContain(other.name)
      // Archived members lose portal access
      await prisma.member.update({ where: { id: member.id }, data: { archivedAt: new Date() } })
      expect((await call(null, 'GET', `/api/portal/${token}`)).status).toBe(404)
    })
  })
})
