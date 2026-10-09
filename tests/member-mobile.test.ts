// The member app's API (Priority 3), over real HTTP. Needs `npm run dev`.
// Authenticates the way a native app would (bearer token) as well as by cookie.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { MEMBER_COOKIE, createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, memberBearer } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const PASSWORD = 'correct-horse-42'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

async function call(auth: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text, setCookie: res.headers.get('set-cookie') || '' }
}

describe.skipIf(!up)('member app API', () => {
  let gymA: string
  let gymB: string
  let owner: string
  let me: Awaited<ReturnType<typeof createMember>>
  let bearer: string
  let other: Awaited<ReturnType<typeof createMember>>
  let otherBearer: string
  let outsiderBearer: string
  let plan: Awaited<ReturnType<typeof createPlan>>
  let membershipId: string

  async function account(ownerId: string, data: Record<string, unknown> = {}) {
    const member = await createMember(ownerId, data)
    const { token } = await createInvite(ownerId, member.id)
    await setPasswordWithToken(token, PASSWORD)
    return { member, bearer: await memberBearer(member.id) }
  }
  const sell = (memberId: string, planId: string) => call(owner, 'POST', `/api/members/${memberId}/memberships`, { planId, paymentMethod: 'cash', collectNow: true })

  beforeAll(async () => {
    gymA = await createGym()
    gymB = await createGym()
    owner = `auth-token=${await createToken({ ownerId: gymA, emailVerified: true })}`
    const a = await account(gymA); me = a.member; bearer = a.bearer
    const b = await account(gymA); other = b.member; otherBearer = b.bearer
    outsiderBearer = (await account(gymB)).bearer
    plan = await createPlan(gymA, { name: 'Unlimited', isPublic: true })
    const sold = await sell(me.id, plan.id)
    membershipId = sold.data.membershipId
    await sell(other.id, plan.id)
  })
  afterAll(async () => { await destroyGym(gymA); await destroyGym(gymB) })

  describe('authentication for a native app', () => {
    it('returns a token only to a client that asks as native, and sets no cookie for it', async () => {
      const native = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: PASSWORD }, { 'X-ClubCheck-Client': 'native' })
      expect(native.status).toBe(200)
      expect(native.data).toMatchObject({ status: 'ok', expiresInDays: 14 })
      expect(typeof native.data.token).toBe('string')
      expect(native.setCookie).not.toContain(MEMBER_COOKIE)
      const web = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: PASSWORD })
      expect(web.data).toEqual({ status: 'ok' })
      expect(web.setCookie).toContain(`${MEMBER_COOKIE}=`)
    })

    it('accepts the bearer token for reads and writes, and rejects a bad or missing one', async () => {
      expect((await call(bearer, 'GET', '/api/portal/me')).data.member.email).toBe(me.email)
      // No browser origin is involved, so the cross-site check does not apply to bearer requests.
      expect((await call(bearer, 'PATCH', '/api/portal/me', { phone: '555-0199' }, { Origin: 'capacitor://localhost' })).status).toBe(200)
      expect((await call('Bearer not-a-real-token', 'GET', '/api/portal/me')).status).toBe(401)
      expect((await call(null, 'GET', '/api/portal/me')).status).toBe(401)
      expect((await call(bearer, 'GET', '/api/member-auth/session')).data).toMatchObject({ authenticated: true, email: me.email })
      // A member token is still not a staff credential.
      expect((await call(bearer, 'GET', '/api/members')).status).toBe(401)
    })

    it('ends a bearer session on "sign out everywhere"', async () => {
      const temp = await account(gymA)
      expect((await call(temp.bearer, 'GET', '/api/portal/me')).status).toBe(200)
      expect((await call(temp.bearer, 'POST', '/api/member-auth/logout', { everywhere: true })).status).toBe(200)
      expect((await call(temp.bearer, 'GET', '/api/portal/me')).status).toBe(401)
    })
  })

  describe('home', () => {
    it('gives the app everything for the home screen in one request', async () => {
      const home = (await call(bearer, 'GET', '/api/portal/me')).data
      expect(home.memberships[0]).toMatchObject({ name: 'Unlimited', status: 'active', priceCents: 15000 })
      expect(home.memberships[0].renewsAt).toBeTruthy()
      expect(home.memberships[0].can).toMatchObject({ freeze: true, cancel: true, change: true, unfreeze: false, resume: false })
      expect(home.billing).toMatchObject({ balanceCents: 0, canPayOnline: false })
      expect(home.billing.nextBillingAt).toBeTruthy()
      expect(home.inbox.unread).toBeGreaterThan(0)
      expect(Array.isArray(home.recentActivity)).toBe(true)
      expect(home.recentActivity.some((r: any) => r.kind === 'payment' && r.amountCents === 15000)).toBe(true)
      expect(home.checkin).toEqual({ selfCheckin: true })
      // Reserved for the next phases so apps do not need an API change.
      expect(home.appointments).toEqual([])
      expect(home.events).toEqual([])
    })
  })

  describe('schedule and booking', () => {
    it('lists classes with time, duration, coach, location, capacity and the member\'s own status, and filters them', async () => {
      const downtown = await prisma.location.create({ data: { ownerId: gymA, name: 'Downtown' } })
      const uptown = await prisma.location.create({ data: { ownerId: gymA, name: 'Uptown' } })
      const elsewhere = await prisma.location.create({ data: { ownerId: gymB, name: 'Other City' } })
      const coach = await prisma.staff.create({ data: { ownerId: gymA, name: 'Coach Kim', email: `kim-${Date.now()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
      const startsAt = new Date(Date.now() + 26 * HOUR)
      const a = await createSession(gymA, { startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60_000), capacity: 8, locationId: downtown.id, coachId: coach.id, room: 'Studio A' })
      const b = await createSession(gymA, { startsAt, capacity: 5, locationId: uptown.id })
      await prisma.classType.update({ where: { id: b.classTypeId }, data: { category: 'workshop', name: 'Mobility Workshop' } })
      const foreign = await createSession(gymB, { startsAt })

      const all = await call(bearer, 'GET', '/api/portal/me/schedule?days=3')
      expect(all.status).toBe(200)
      const ids = all.data.sessions.map((s: any) => s.id)
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]))
      expect(ids).not.toContain(foreign.id)
      expect(all.data.sessions.find((s: any) => s.id === a.id)).toMatchObject({ durationMin: 45, coach: 'Coach Kim', location: 'Downtown · Studio A', capacity: 8, spotsLeft: 8, category: 'class', myBooking: null, bookable: true })
      expect(all.data.locations.map((l: any) => l.name).sort()).toEqual(['Downtown', 'Uptown'])
      expect(all.data.categories.sort()).toEqual(['class', 'workshop'])
      // Who else is booked is never exposed.
      expect(all.text).not.toMatch(/"members"|"roster"|"bookings":\[/)

      const byLocation = (await call(bearer, 'GET', `/api/portal/me/schedule?days=3&locationId=${uptown.id}`)).data.sessions.map((s: any) => s.id)
      expect(byLocation).toContain(b.id)
      expect(byLocation).not.toContain(a.id)
      const byCategory = (await call(bearer, 'GET', '/api/portal/me/schedule?days=3&category=workshop')).data.sessions.map((s: any) => s.id)
      expect(byCategory).toEqual([b.id])
      // Another gym's location matches nothing rather than leaking its classes.
      expect((await call(bearer, 'GET', `/api/portal/me/schedule?days=3&locationId=${elsewhere.id}`)).data.sessions).toEqual([])
    })

    it('books, shows the status, cancels, and handles the waitlist both ways', async () => {
      const session = await createSession(gymA, { capacity: 1 })
      const booked = await call(bearer, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      expect(booked.data).toMatchObject({ status: 'booked' })
      const listed = (await call(bearer, 'GET', '/api/portal/me/schedule?days=4')).data.sessions.find((s: any) => s.id === session.id)
      expect(listed).toMatchObject({ spotsLeft: 0, myBooking: { id: booked.data.id, status: 'booked' } })

      // Full for the next member: refused, then an explicit waitlist join.
      expect((await call(otherBearer, 'POST', '/api/portal/me/bookings', { sessionId: session.id })).json.code).toBe('class_full')
      const waiting = await call(otherBearer, 'POST', '/api/portal/me/bookings', { sessionId: session.id, joinWaitlist: true })
      expect(waiting.data).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
      const theirView = (await call(otherBearer, 'GET', '/api/portal/me')).data.upcoming.find((u: any) => u.sessionId === session.id)
      expect(theirView).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })

      // Leaving the waitlist.
      expect((await call(otherBearer, 'POST', `/api/portal/me/bookings/${waiting.data.id}`, { action: 'cancel' })).status).toBe(200)
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: waiting.data.id } })).status).not.toBe('waitlisted')
      // Nobody can cancel someone else's booking.
      expect((await call(otherBearer, 'POST', `/api/portal/me/bookings/${booked.data.id}`, { action: 'cancel' })).status).toBe(404)
      const cancelled = await call(bearer, 'POST', `/api/portal/me/bookings/${booked.data.id}`, { action: 'cancel' })
      expect(cancelled.status).toBe(200)
      expect((await call(bearer, 'GET', '/api/portal/me/schedule?days=4')).data.sessions.find((s: any) => s.id === session.id)).toMatchObject({ spotsLeft: 1, myBooking: null })
    })

    it('still applies the gym\'s booking rules', async () => {
      const far = await createSession(gymA, { startsAt: new Date(Date.now() + 40 * DAY) })
      const tooEarly = await call(bearer, 'POST', '/api/portal/me/bookings', { sessionId: far.id })
      expect(tooEarly.status).toBe(422)
      const noMembership = await account(gymA)
      const session = await createSession(gymA)
      const refused = await call(noMembership.bearer, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      expect(refused.status).toBe(422)
      expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(0)
    })
  })

  describe('check-in', () => {
    it('checks the member into the class they are booked on, once', async () => {
      const startsAt = new Date(Date.now() + 20 * 60_000)
      const session = await createSession(gymA, { startsAt, capacity: 5 })
      const booking = await call(bearer, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      const screen = (await call(bearer, 'GET', '/api/portal/me/checkin')).data
      expect(screen.selfCheckin).toBe(true)
      expect(screen.currentClass).toMatchObject({ sessionId: session.id, bookingId: booking.data.id })

      const before = await prisma.checkin.count({ where: { memberId: me.id } })
      const done = await call(bearer, 'POST', '/api/portal/me/checkin')
      expect(done.status).toBe(200)
      expect(done.data).toMatchObject({ duplicate: false, attended: { sessionId: session.id } })
      expect(await prisma.checkin.count({ where: { memberId: me.id } })).toBe(before + 1)
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.data.id } })).status).toBe('attended')
      const row = await prisma.checkin.findFirstOrThrow({ where: { memberId: me.id }, orderBy: { timestamp: 'desc' } })
      expect(row).toMatchObject({ sessionId: session.id, type: 'class' })

      // A double tap is not a second visit.
      const again = await call(bearer, 'POST', '/api/portal/me/checkin')
      expect(again.data.duplicate).toBe(true)
      expect(await prisma.checkin.count({ where: { memberId: me.id } })).toBe(before + 1)
      const after = (await call(bearer, 'GET', '/api/portal/me/checkin')).data
      expect(after.recent[0].label).toBeTruthy()
      expect(after.lastCheckinAt).toBeTruthy()
      // Nobody else was checked in.
      expect(await prisma.checkin.count({ where: { memberId: other.id } })).toBe(0)
    })

    it('refuses members the front desk would refuse, with no override', async () => {
      const inactive = await account(gymA, { status: 'inactive' })
      const refused = await call(inactive.bearer, 'POST', '/api/portal/me/checkin', { force: true })
      expect(refused.status).toBe(422)
      expect(await prisma.checkin.count({ where: { memberId: inactive.member.id } })).toBe(0)
    })

    it('can be turned off by the gym', async () => {
      const gym = await createGym({ memberSelfCheckin: false })
      try {
        const m = await account(gym)
        expect((await call(m.bearer, 'GET', '/api/portal/me/checkin')).data.selfCheckin).toBe(false)
        const refused = await call(m.bearer, 'POST', '/api/portal/me/checkin')
        expect(refused.status).toBe(403)
        expect(refused.json.code).toBe('self_checkin_disabled')
        expect(await prisma.checkin.count({ where: { memberId: m.member.id } })).toBe(0)
      } finally {
        await destroyGym(gym)
      }
    })
  })

  describe('membership self-service', () => {
    const act = (auth: string, id: string, body: unknown) => call(auth, 'POST', `/api/portal/me/memberships/${id}`, body)

    it('freezes and resumes within the plan\'s limits', async () => {
      const tooLong = await act(bearer, membershipId, { action: 'freeze', until: new Date(Date.now() + 200 * DAY).toISOString() })
      expect(tooLong.status).toBe(400)
      expect(tooLong.json.code).toBe('freeze_too_long')
      const frozen = await act(bearer, membershipId, { action: 'freeze', until: new Date(Date.now() + 14 * DAY).toISOString(), reason: 'Travel' })
      expect(frozen.data.status).toBe('frozen')
      expect((await call(bearer, 'GET', '/api/portal/me')).data.memberships[0]).toMatchObject({ status: 'frozen', can: { unfreeze: true, freeze: false } })
      const resumed = await act(bearer, membershipId, { action: 'unfreeze' })
      expect(resumed.data.status).toBe('active')
    })

    it('cancels at the end of the paid period, can be undone, and never mid-contract', async () => {
      const cancelled = await act(bearer, membershipId, { action: 'cancel', reason: 'Moving away' })
      expect(cancelled.status).toBe(200)
      const row = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })
      expect(row.status).toBe('active')
      expect(row.cancelAt?.getTime()).toBe(row.currentPeriodEnd?.getTime())
      expect((await call(bearer, 'GET', '/api/portal/me')).data.memberships[0]).toMatchObject({ can: { resume: true, cancel: false } })
      expect((await act(bearer, membershipId, { action: 'resume' })).status).toBe(200)
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).cancelAt).toBeNull()

      // A staff-only override in the request changes nothing: still end of period, never "now".
      const sneaky = await act(bearer, membershipId, { action: 'cancel', when: 'now', override: true })
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe('active')
      expect(sneaky.data.cancelsAt).toBeTruthy()
      await act(bearer, membershipId, { action: 'resume' })

      const contract = await createPlan(gymA, { name: 'Annual', contractMonths: 12 })
      const bound = await account(gymA)
      const sold = await sell(bound.member.id, contract.id)
      const refused = await act(bound.bearer, sold.data.membershipId, { action: 'cancel' })
      expect(refused.status).toBe(409)
      expect(refused.json.code).toBe('under_contract')
      expect((await call(bound.bearer, 'GET', '/api/portal/me')).data.memberships[0].can.cancel).toBe(false)
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: sold.data.membershipId } })).cancelAt).toBeNull()
    })

    it('switches only to plans the gym offers publicly, from the next billing date', async () => {
      const premium = await createPlan(gymA, { name: 'Premium', priceCents: 20000, isPublic: true })
      const hidden = await createPlan(gymA, { name: 'Staff Rate', priceCents: 100, isPublic: false })
      const foreign = await createPlan(gymB, { name: 'Foreign', isPublic: true })
      const offered = (await call(bearer, 'GET', '/api/portal/me/plans')).data.map((p: any) => p.name)
      expect(offered).toEqual(expect.arrayContaining(['Unlimited', 'Premium']))
      expect(offered).not.toContain('Staff Rate')
      expect(offered).not.toContain('Foreign')
      // Changing plan is previewed and then confirmed (the money side is covered in advanced-billing.test.ts).
      const route = `/api/portal/me/memberships/${membershipId}/plan-change`
      expect((await call(bearer, 'GET', `${route}?planId=${hidden.id}&effective=next_period`)).status).toBe(404)
      expect((await call(bearer, 'GET', `${route}?planId=${foreign.id}&effective=next_period`)).status).toBe(404)
      const invoicesBefore = await prisma.invoice.count({ where: { membershipId } })
      const preview = await call(bearer, 'GET', `${route}?planId=${premium.id}&effective=next_period`)
      expect(preview.data).toMatchObject({ allowed: true, calc: { mode: 'next_period', amountDueNowCents: 0, creditCents: 0, nextBillingCents: 20000 } })
      const changed = await call(bearer, 'POST', route, { planId: premium.id, effective: 'next_period', expected: { fromPlanId: preview.data.from.id, amountDueNowCents: 0, creditCents: 0 }, idempotencyKey: `member-change-${membershipId}` })
      expect(changed.status).toBe(200)
      expect(changed.data).toMatchObject({ status: 'scheduled', nextBillingCents: 20000 })
      // They stay on their plan until the billing date, and nothing is charged at the moment of the change.
      const row = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })
      expect(row).toMatchObject({ pendingPlanId: premium.id })
      expect(await prisma.invoice.count({ where: { membershipId } })).toBe(invoicesBefore)
    })

    it("cannot touch another member's membership, in or out of the gym", async () => {
      for (const auth of [otherBearer, outsiderBearer]) {
        expect((await act(auth, membershipId, { action: 'freeze' })).status).toBe(404)
        expect((await act(auth, membershipId, { action: 'cancel' })).status).toBe(404)
      }
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe('active')
    })

    it('respects the gym switching self-service off', async () => {
      const gym = await createGym({ memberSelfFreeze: false, memberSelfCancel: false, memberSelfChangePlan: false })
      try {
        const staff = `auth-token=${await createToken({ ownerId: gym, emailVerified: true })}`
        const m = await account(gym)
        const p = await createPlan(gym)
        const sold = await call(staff, 'POST', `/api/members/${m.member.id}/memberships`, { planId: p.id, paymentMethod: 'cash' })
        expect((await call(m.bearer, 'GET', '/api/portal/me')).data.memberships[0].can).toEqual({ freeze: false, unfreeze: false, cancel: false, resume: false, change: false })
        for (const body of [{ action: 'freeze' }, { action: 'cancel' }]) {
          const refused = await act(m.bearer, sold.data.membershipId, body)
          expect(refused.status, body.action).toBe(403)
          expect(refused.json.code).toBe('self_service_disabled')
        }
        const change = await call(m.bearer, 'GET', `/api/portal/me/memberships/${sold.data.membershipId}/plan-change?planId=${p.id}`)
        expect(change.status).toBe(403)
        expect(change.json.code).toBe('self_service_disabled')
      } finally {
        await destroyGym(gym)
      }
    })
  })

  describe('billing and payment methods', () => {
    it('shows invoices, history and saved methods for this member only', async () => {
      await prisma.paymentMethod.create({ data: { ownerId: gymA, memberId: me.id, providerId: `pm_app_${Date.now()}`, type: 'us_bank_account', bankName: 'Test Bank', last4: '6789', isDefault: true } })
      await prisma.paymentMethod.create({ data: { ownerId: gymA, memberId: other.id, providerId: `pm_app_o_${Date.now()}`, type: 'card', brand: 'visa', last4: '1111', isDefault: true } })
      const home = await call(bearer, 'GET', '/api/portal/me')
      expect(home.data.billing.invoices.length).toBeGreaterThan(0)
      expect(home.data.billing.payments[0]).toMatchObject({ type: 'payment', status: 'succeeded', amountCents: 15000 })
      expect(home.data.billing.paymentMethods).toEqual([expect.objectContaining({ type: 'us_bank_account', bankName: 'Test Bank', last4: '6789', isDefault: true })])
      expect(home.text).not.toContain('1111')
      expect(home.text).not.toMatch(/pm_app_|providerId|connectCustomerId/)
      const open = await prisma.invoice.create({ data: { ownerId: gymA, memberId: me.id, number: `INV-APP-${Date.now()}`, totalCents: 2500, subtotalCents: 2500 } })
      // No processor is connected for this test gym; the charge itself is proven by scripts/stripe-testmode.ts.
      expect((await call(bearer, 'POST', `/api/portal/me/invoices/${open.id}/pay`, {})).json.code).toBe('payments_not_connected')
      expect((await call(otherBearer, 'POST', `/api/portal/me/invoices/${open.id}/pay`, {})).status).toBe(404)
    })
  })

  describe('profile', () => {
    it('updates the member\'s own details and nothing else', async () => {
      const saved = await call(bearer, 'PATCH', '/api/portal/me', { name: 'Renamed Member', phone: '555-0142', emergencyContactName: 'Sam', smsOptIn: true, status: 'active', creditBalanceCents: 99999, ownerId: gymB })
      expect(saved.status).toBe(200)
      const row = await prisma.member.findUniqueOrThrow({ where: { id: me.id } })
      expect(row).toMatchObject({ name: 'Renamed Member', phone: '555-0142', emergencyContactName: 'Sam', smsOptIn: true, ownerId: gymA, creditBalanceCents: 0 })
      expect((await call(bearer, 'PATCH', '/api/portal/me', { name: 'X' })).status).toBe(400)
      // An email change waits for confirmation.
      const pending = await call(bearer, 'PATCH', '/api/portal/me', { email: `new-${Date.now()}@test.local` })
      expect(pending.data.emailPending).toBeTruthy()
      expect((await prisma.member.findUniqueOrThrow({ where: { id: me.id } })).email).toBe(me.email)
    })
  })

  describe('notifications', () => {
    it('records bookings, payments, membership and account events, and messages from the gym', async () => {
      const fresh = await account(gymA)
      await sell(fresh.member.id, plan.id)
      const session = await createSession(gymA, { capacity: 3 })
      await call(fresh.bearer, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      await call(owner, 'POST', `/api/members/${fresh.member.id}/messages`, { channel: 'email', subject: 'Holiday hours', body: 'We close early on Friday.' })
      const inbox = await call(fresh.bearer, 'GET', '/api/portal/me/notifications')
      expect(inbox.status).toBe(200)
      const categories = inbox.data.items.map((n: any) => n.category)
      expect(categories).toEqual(expect.arrayContaining(['account', 'membership', 'payment', 'booking']))
      expect(inbox.data.items.find((n: any) => n.category === 'account').title).toBe('Your account is set up')
      expect(inbox.data.items.every((n: any) => n.read === false)).toBe(true)
      expect(inbox.data.unread).toBe(inbox.data.items.length)
      const message = inbox.data.items.find((n: any) => n.category === 'message')
      if (message) expect(message).toMatchObject({ title: 'Holiday hours', body: 'We close early on Friday.' })
      expect((await call(fresh.bearer, 'GET', '/api/portal/me/notifications?category=booking')).data.items.every((n: any) => n.category === 'booking')).toBe(true)
      expect((await call(fresh.bearer, 'GET', '/api/portal/me')).data.inbox.unread).toBe(inbox.data.unread)

      // Mark one read, then the rest; paginate.
      const one = await call(fresh.bearer, 'POST', '/api/portal/me/notifications/read', { ids: [inbox.data.items[0].id] })
      expect(one.data).toMatchObject({ updated: 1, unread: inbox.data.unread - 1 })
      const page = await call(fresh.bearer, 'GET', '/api/portal/me/notifications?take=2')
      expect(page.data.items).toHaveLength(2)
      expect(page.data.nextBefore).toBeTruthy()
      const older = await call(fresh.bearer, 'GET', `/api/portal/me/notifications?take=2&before=${encodeURIComponent(page.data.nextBefore)}`)
      expect(older.data.items.map((n: any) => n.id)).not.toContain(page.data.items[0].id)
      expect((await call(fresh.bearer, 'POST', '/api/portal/me/notifications/read', {})).data.unread).toBe(0)
    })

    it("never shows or changes another member's notifications", async () => {
      const mine = (await call(bearer, 'GET', '/api/portal/me/notifications?take=50')).data.items
      const theirs = (await call(otherBearer, 'GET', '/api/portal/me/notifications?take=50')).data.items
      expect(mine.length).toBeGreaterThan(0)
      expect(theirs.length).toBeGreaterThan(0)
      const myIds = new Set(mine.map((n: any) => n.id))
      expect(theirs.some((n: any) => myIds.has(n.id))).toBe(false)
      const unreadBefore = await prisma.memberNotification.count({ where: { memberId: other.id, readAt: null } })
      const attempt = await call(bearer, 'POST', '/api/portal/me/notifications/read', { ids: theirs.map((n: any) => n.id).slice(0, 20) })
      expect(attempt.data.updated).toBe(0)
      expect(await prisma.memberNotification.count({ where: { memberId: other.id, readAt: null } })).toBe(unreadBefore)
      expect((await call(outsiderBearer, 'GET', '/api/portal/me/notifications?take=50')).data.items.some((n: any) => myIds.has(n.id))).toBe(false)
      expect((await call(null, 'GET', '/api/portal/me/notifications')).status).toBe(401)
    })

    it('registers a device for push, and a device belongs to whoever signed in on it last', async () => {
      const pushToken = `ExponentPushToken[test-${Date.now()}]`
      expect((await call(bearer, 'POST', '/api/portal/me/devices', { platform: 'ios', pushToken })).data).toEqual({ registered: true })
      expect(await prisma.memberDevice.count({ where: { memberId: me.id, pushToken } })).toBe(1)
      await call(otherBearer, 'POST', '/api/portal/me/devices', { platform: 'ios', pushToken })
      expect(await prisma.memberDevice.count({ where: { pushToken } })).toBe(1)
      expect((await prisma.memberDevice.findUniqueOrThrow({ where: { pushToken } })).memberId).toBe(other.id)
      // The previous owner cannot remove it; the current one can.
      await call(bearer, 'DELETE', '/api/portal/me/devices', { pushToken })
      expect(await prisma.memberDevice.count({ where: { pushToken } })).toBe(1)
      await call(otherBearer, 'DELETE', '/api/portal/me/devices', { pushToken })
      expect(await prisma.memberDevice.count({ where: { pushToken } })).toBe(0)
      expect((await call(bearer, 'POST', '/api/portal/me/devices', { platform: 'windows', pushToken })).status).toBe(400)
    })
  })

  describe('installable app', () => {
    it('serves a web app manifest for the member area', async () => {
      const res = await fetch(`${BASE}/member/manifest.webmanifest`)
      expect(res.status).toBe(200)
      const manifest = await res.json()
      expect(manifest).toMatchObject({ start_url: '/member/me', scope: '/member/', display: 'standalone' })
      expect(manifest.icons.length).toBeGreaterThan(0)
    })
  })
})
