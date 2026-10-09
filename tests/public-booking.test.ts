// Online booking: the public page's API, the services behind it, and the rules it must not bend.
// The HTTP half needs a running dev server (npm run dev) and is skipped without one; the service
// half (payments, races) runs in this process against the same local database.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { setPaymentProviderForTests, type ChargeRequest, type PaymentProvider } from '@/lib/payments/provider'
import { readBookingSession, readManageToken, signBookingSession, signManageToken } from '@/lib/public-booking/tokens'
import { resumePath } from '@/lib/public-booking/links'
import { themeCss } from '@/lib/public-booking/theme'
import { bookAppointmentOnline, bookClassOnline, bookingStats, cancelOnline, getBookingSite, identifyGuest, publicClass, publicClasses, resolveSite, saveBookingSite, siteSchema, slugify, startAccount, startPlanOnline, type SiteInput, type Viewer } from '@/lib/services/public-booking'
import { bookClass } from '@/lib/services/bookings'
import { sellMembership } from '@/lib/services/memberships'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
// A zone where it is the middle of the day, so "today" and "in two days" never straddle midnight oddly.
const TZ = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Honolulu', 'America/Sao_Paulo'].find((zone) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return hour >= 5 && hour <= 15
}) || 'UTC'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

type Res = { status: number; json: any; data: any; text: string; headers: Headers }
// A fresh caller address for every test, from a block reserved for testing, so one test's requests never count against another's limits.
const ip = () => `198.${18 + Math.floor(Math.random() * 2)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`
let address = ip()
async function call(method: string, path: string, body?: unknown, opts: { token?: string | null; cookie?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { 'X-Forwarded-For': address, ...(opts.token && { Authorization: `Bearer ${opts.token}` }), ...(opts.cookie && { Cookie: opts.cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...opts.headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text, headers: res.headers }
}

const defaults = (slug: string, extra: Partial<SiteInput> = {}): SiteInput => siteSchema.parse({
  enabled: true, slug, displayName: null, tagline: null, primaryColor: '#0f766e', buttonStyle: 'rounded', appearance: 'light', showLogo: true,
  locationIds: [], allClassTypes: true, classTypeIds: [], appointmentTypeIds: [], requireAccount: false, allowGuests: true, advanceDays: null,
  cancellationPolicy: null, contactEmail: null, contactPhone: null, termsUrl: null, ...extra,
})
const noSend = async () => {}

/** A staffed appointment type with open hours every day. */
async function appointmentType(ownerId: string, data: Record<string, unknown> = {}) {
  const coach = await prisma.staff.create({ data: { ownerId, name: `Coach ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
  await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId, staffId: coach.id, weekday, startMinute: 480, endMinute: 1200, kind: 'work' })) })
  const type = await prisma.appointmentType.create({ data: { ownerId, name: 'Intro Session', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 60, cancelWindowHours: 12, memberBookable: true, ...data } })
  await prisma.appointmentTypeStaff.create({ data: { ownerId, typeId: type.id, staffId: coach.id } })
  return { type, coach }
}
async function withAccount(ownerId: string, data: Record<string, unknown> = {}) {
  const member = await createMember(ownerId, data)
  const { token } = await createInvite(ownerId, member.id)
  await setPasswordWithToken(token, 'correct-horse-42')
  return member
}
const viewerOf = (member: Member, hasAccount = true): Viewer => ({ member, hasAccount })
const tokenOf = async (member: Member, account = true) => signBookingSession({ ownerId: member.ownerId, memberId: member.id, sessionVersion: account ? (await prisma.memberAccount.findUniqueOrThrow({ where: { memberId: member.id } })).sessionVersion : null })

class FakeProcessor implements PaymentProvider {
  name = 'fake'
  canAutoCharge = true
  charges: ChargeRequest[] = []
  seen = new Map<string, string>()
  decline = false
  async charge(request: ChargeRequest) {
    this.charges.push(request)
    if (this.decline) return { status: 'failed' as const, failureReason: 'Your card was declined.' }
    // The same key is the same payment, as at a real processor.
    const reference = this.seen.get(request.idempotencyKey) || `fake_${randomUUID()}`
    this.seen.set(request.idempotencyKey, reference)
    return { status: 'succeeded' as const, reference }
  }
  async refund() { return { status: 'succeeded' as const, reference: `fake_refund_${randomUUID()}` } }
}
async function saveCard(member: Member) {
  await prisma.member.update({ where: { id: member.id }, data: { connectCustomerId: `cus_${randomUUID()}` } })
  await prisma.paymentMethod.create({ data: { ownerId: member.ownerId, memberId: member.id, providerId: `pm_${randomUUID()}`, type: 'card', brand: 'visa', last4: '4242', isDefault: true } })
  return prisma.member.findUniqueOrThrow({ where: { id: member.id } })
}

const gyms: string[] = []
async function gymWithSite(extra: Partial<SiteInput> = {}, gymData: Record<string, unknown> = {}) {
  const ownerId = await createGym({ timezone: TZ, ...gymData })
  gyms.push(ownerId)
  await getBookingSite(ownerId)
  const slug = `t-${randomUUID().slice(0, 12)}`
  await saveBookingSite(ownerId, defaults(slug, extra))
  return { ownerId, slug, site: extra.enabled === false ? (null as never) : await resolveSite(slug), owner: `auth-token=${await createToken({ ownerId, emailVerified: true })}` }
}
afterAll(async () => {
  setPaymentProviderForTests(null)
  for (const ownerId of gyms) {
    await prisma.bookingSite.deleteMany({ where: { ownerId } })
    await prisma.bookingSiteDaily.deleteMany({ where: { ownerId } })
    await prisma.idempotencyKey.deleteMany({ where: { ownerId } })
    await destroyGym(ownerId)
  }
})

// ===========================================================================
describe('online booking: settings and pure rules', () => {
  it('makes a usable address from a gym name, and refuses unsafe settings', () => {
    expect(slugify('Iron Harbor Fitness')).toBe('iron-harbor-fitness')
    expect(slugify('Café & Crêpe — Gym!')).toBe('cafe-and-crepe-gym')
    expect(slugify('X')).toBe('gym-x')
    const ok = defaults('good-slug')
    for (const bad of [{ slug: 'ab' }, { slug: 'Has Spaces' }, { slug: 'admin' }, { slug: 'api' }, { slug: '-lead' }, { slug: 'a--b' }, { slug: '../etc' },
      { primaryColor: 'red' }, { primaryColor: '#fff' }, { primaryColor: '#12345g' }, { primaryColor: '#000000;}body{display:none}' },
      { termsUrl: 'javascript:alert(1)' }, { termsUrl: 'data:text/html,<script>1</script>' }, { termsUrl: 'not a link' },
      { buttonStyle: 'expression(alert(1))' }, { appearance: '</style><script>' }, { contactEmail: 'nope' }, { advanceDays: 0 }]) {
      expect(siteSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false)
    }
    expect(siteSchema.parse({ ...ok, termsUrl: '', contactEmail: '' })).toMatchObject({ termsUrl: null, contactEmail: null })
  })

  it('builds the page theme only from a checked colour and fixed choices', () => {
    const css = themeCss({ primaryColor: '#0f766e', buttonStyle: 'pill', appearance: 'auto' })
    expect(css).toContain('--color-accent:15 118 110')
    expect(css).toContain('--bk-radius:9999px')
    expect(css).toContain('prefers-color-scheme: dark')
    // Dark text on a pale colour, white on a deep one.
    expect(themeCss({ primaryColor: '#fde047', buttonStyle: 'rounded', appearance: 'light' })).toContain('--color-accent-fg:23 23 23')
    expect(themeCss({ primaryColor: '#1e3a8a', buttonStyle: 'rounded', appearance: 'light' })).toContain('--color-accent-fg:255 255 255')
    // Anything that is not a colour falls back; nothing typed can reach the stylesheet.
    const hostile = themeCss({ primaryColor: '#000;}</style><script>alert(1)</script>', buttonStyle: '</style>', appearance: 'x{}' })
    expect(hostile).not.toMatch(/script|<\/style>|alert/)
    expect(hostile).toContain('--color-accent:37 99 235')
  })

  it('signs tokens that only mean what they say', async () => {
    const session = { ownerId: randomUUID(), memberId: randomUUID(), sessionVersion: 3 }
    const token = await signBookingSession(session)
    expect(await readBookingSession(token)).toEqual(session)
    expect(await readBookingSession(`${token}x`)).toBeNull()
    expect(await readBookingSession(null)).toBeNull()
    const manage = await signManageToken({ ownerId: session.ownerId, memberId: session.memberId, kind: 'class', id: randomUUID() }, new Date(Date.now() + HOUR))
    // One kind of token is never accepted as the other, and a member-app session is neither.
    expect(await readBookingSession(manage)).toBeNull()
    expect(await readManageToken(token)).toBeNull()
    expect((await readManageToken(manage))?.kind).toBe('class')
    const memberSession = await createToken({ ownerId: session.ownerId, emailVerified: true })
    expect(await readBookingSession(memberSession)).toBeNull()
    expect(await readManageToken(memberSession)).toBeNull()
    expect(resumePath('gym', { classId: '6f1c2d8e-3b4a-4c5d-9e8f-7a6b5c4d3e2f' })).toBe('/book/gym?class=6f1c2d8e-3b4a-4c5d-9e8f-7a6b5c4d3e2f')
    expect(resumePath('gym', null)).toBe('/book/gym')
  })
})

// ===========================================================================
describe('online booking: services', () => {
  let processor: FakeProcessor
  afterEach(() => setPaymentProviderForTests(null))
  const useProcessor = () => { processor = new FakeProcessor(); setPaymentProviderForTests(processor); return processor }

  describe('settings', () => {
    it('gives each gym its own address and only lets it publish its own things', async () => {
      const a = await gymWithSite()
      const b = await gymWithSite()
      await expect(saveBookingSite(b.ownerId, defaults(a.slug))).rejects.toMatchObject({ status: 409, code: 'slug_taken' })
      const location = await prisma.location.create({ data: { ownerId: a.ownerId, name: 'A Only' } })
      const classType = await prisma.classType.create({ data: { ownerId: a.ownerId, name: 'A Class' } })
      const { type } = await appointmentType(a.ownerId)
      for (const theirs of [{ locationIds: [location.id] }, { allClassTypes: false, classTypeIds: [classType.id] }, { appointmentTypeIds: [type.id] }]) {
        await expect(saveBookingSite(b.ownerId, defaults(b.slug, theirs))).rejects.toMatchObject({ status: 404 })
      }
      await saveBookingSite(a.ownerId, defaults(a.slug, { locationIds: [location.id], appointmentTypeIds: [type.id] }))
      // Two gyms with the same name get different addresses.
      const [c, d] = [await createGym({ name: 'Same Name Gym' }), await createGym({ name: 'Same Name Gym' })]
      gyms.push(c, d)
      const [sc, sd] = [await getBookingSite(c), await getBookingSite(d)]
      expect(sc.slug).toBe('same-name-gym')
      expect(sd.slug).not.toBe(sc.slug)
      expect(sd.enabled).toBe(false)
      await expect(resolveSite(sd.slug)).rejects.toMatchObject({ status: 404 })
      await expect(resolveSite('no-such-gym-anywhere')).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('guests and accounts', () => {
    it('creates one inactive member for a new guest, marked as coming from online booking', async () => {
      const g = await gymWithSite()
      const email = `new-${randomUUID()}@test.local`
      const first = await identifyGuest(g.site, { name: 'Gina Guest', email, phone: '555-0100' }, noSend)
      expect(first.status).toBe('ok')
      const member = (first as { member: Member }).member
      expect(member).toMatchObject({ ownerId: g.ownerId, status: 'inactive', leadSource: 'online_booking', email, phone: '555-0100', smsOptIn: false })
      // The same address again is someone we know: an email, not a second member and not a way in.
      const sent: string[] = []
      for (const again of [email, email.toUpperCase()]) {
        const r = await identifyGuest(g.site, { name: 'Someone Else', email: again, phone: null }, async (_m, kind) => { sent.push(kind) })
        expect(r).toEqual({ status: 'check_email' })
      }
      expect(await prisma.member.count({ where: { ownerId: g.ownerId, email: { equals: email, mode: 'insensitive' } } })).toBe(1)
      // One email per person per ten minutes, however many times the form is sent.
      expect(sent).toEqual(['invite'])
      expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).name).toBe('Gina Guest')
    })

    it('closes an existing lead onto the new member and keeps where the lead came from', async () => {
      const g = await gymWithSite()
      const email = `lead-${randomUUID()}@test.local`
      const lead = await prisma.prospect.create({ data: { ownerId: g.ownerId, name: 'Lena Lead', email, phone: '555-0111', source: 'Instagram ad', status: 'contacted' } })
      const r = await identifyGuest(g.site, { name: 'Lena Lead', email, phone: null }, noSend)
      const member = (r as { member: Member }).member
      expect(member).toMatchObject({ leadSource: 'Instagram ad', phone: '555-0111' })
      expect(await prisma.prospect.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: 'converted', convertedMemberId: member.id, source: 'Instagram ad' })
      // An existing member's own source is never touched by them booking online.
      const existing = await withAccount(g.ownerId, { leadSource: 'Referral' })
      await identifyGuest(g.site, { name: existing.name, email: existing.email, phone: null }, noSend)
      expect((await prisma.member.findUniqueOrThrow({ where: { id: existing.id } })).leadSource).toBe('Referral')
    })

    it('answers account creation the same way for any address, and never lets a known address in without proof', async () => {
      const g = await gymWithSite()
      const member = await withAccount(g.ownerId)
      const noAccount = await createMember(g.ownerId)
      const sent: [string, string, boolean][] = []
      const send = async (m: Member, kind: 'invite' | 'sign_in', token: string | null) => { sent.push([m.email, kind, !!token]) }
      const fresh = `fresh-${randomUUID()}@test.local`
      for (const email of [fresh, member.email, noAccount.email]) expect(await startAccount(g.site, { name: 'Any Body', email, phone: null }, send)).toEqual({ status: 'check_email' })
      expect(sent).toEqual([[fresh, 'invite', true], [member.email, 'sign_in', false], [noAccount.email, 'invite', true]])
      expect(await prisma.memberAccount.count({ where: { member: { email: fresh } } })).toBe(0)
      // The same address at another gym is a different person there: nothing is shared or revealed.
      const other = await gymWithSite()
      const r = await identifyGuest(other.site, { name: 'Twin', email: member.email, phone: null }, send)
      expect(r.status).toBe('ok')
      expect((r as { member: Member }).member.ownerId).toBe(other.ownerId)
      expect(sent).toHaveLength(3)
    })

    it('respects "account required" and "no guests"', async () => {
      const strict = await gymWithSite({ requireAccount: true })
      await expect(identifyGuest(strict.site, { name: 'G', email: `g-${randomUUID()}@test.local`, phone: null }, noSend)).rejects.toMatchObject({ status: 403, code: 'account_required' })
      const noGuests = await gymWithSite({ allowGuests: false })
      await expect(identifyGuest(noGuests.site, { name: 'G', email: `g-${randomUUID()}@test.local`, phone: null }, noSend)).rejects.toMatchObject({ status: 403, code: 'account_required' })
      const session = await createSession(strict.ownerId)
      const guest = await createMember(strict.ownerId, { status: 'inactive' })
      await expect(bookClassOnline(strict.site, viewerOf(guest, false), { classId: session.id }, BASE)).rejects.toMatchObject({ status: 403, code: 'account_required' })
    })

    it('stops taking new people when the gym is at its member limit', async () => {
      const g = await gymWithSite()
      await prisma.owner.update({ where: { id: g.ownerId }, data: { planType: 'starter' } })
      await prisma.member.createMany({ data: Array.from({ length: 75 }, (_, i) => ({ ownerId: g.ownerId, name: `Full ${i}`, email: `full-${i}-${randomUUID()}@test.local`, qrCode: `q-${randomUUID()}`, status: 'active' })) })
      await expect(identifyGuest(g.site, { name: 'One More', email: `more-${randomUUID()}@test.local`, phone: null }, noSend)).rejects.toMatchObject({ status: 409, code: 'unavailable' })
    })
  })

  describe('classes and memberships', () => {
    it('shows only public classes, with honest statuses and nothing private', async () => {
      const g = await gymWithSite()
      const downtown = await prisma.location.create({ data: { ownerId: g.ownerId, name: 'Downtown', address: '1 Main St', city: 'Portland' } })
      const backroom = await prisma.location.create({ data: { ownerId: g.ownerId, name: 'Staff Only Annex' } })
      const coach = await prisma.staff.create({ data: { ownerId: g.ownerId, name: 'Sam Coach', email: 'sam.private@test.local', phone: '555-PRIVATE', password: 'x', role: 'coach', isCoach: true } })
      const at = (hours: number) => new Date(Date.now() + 2 * DAY + hours * HOUR)
      const open = await createSession(g.ownerId, { startsAt: at(0), capacity: 10, locationId: downtown.id, coachId: coach.id, notes: 'Staff note: key under mat' })
      const nearly = await createSession(g.ownerId, { startsAt: at(1.5), capacity: 5, locationId: downtown.id })
      const full = await createSession(g.ownerId, { startsAt: at(3), capacity: 1, waitlistCapacity: 2, locationId: downtown.id })
      const packed = await createSession(g.ownerId, { startsAt: at(4.5), capacity: 1, waitlistCapacity: 0, locationId: downtown.id })
      const cancelled = await createSession(g.ownerId, { startsAt: at(6), locationId: downtown.id, status: 'cancelled', cancelReason: 'Coach ill' })
      const hidden = await createSession(g.ownerId, { startsAt: at(7.5), locationId: backroom.id })
      const far = await createSession(g.ownerId, { startsAt: new Date(Date.now() + 18 * DAY), locationId: downtown.id })
      const priv = await createSession(g.ownerId, { startsAt: at(9), locationId: downtown.id })
      await saveBookingSite(g.ownerId, defaults(g.slug, { locationIds: [downtown.id], allClassTypes: false, classTypeIds: [open, nearly, full, packed, cancelled, hidden, far].map((s) => s.classTypeId) }))
      const site = await resolveSite(g.slug)
      const filler = async (sessionId: string, n: number) => { for (let i = 0; i < n; i++) await prisma.booking.create({ data: { ownerId: g.ownerId, sessionId, memberId: (await createMember(g.ownerId)).id, status: 'booked', source: 'staff' } }) }
      await filler(nearly.id, 4); await filler(full.id, 1); await filler(packed.id, 1)

      const day = zonedParts(open.startsAt, TZ).date
      const listed = (await publicClasses(site, null, { date: day, days: 2 })).classes
      const status = (id: string) => listed.find((c) => c.id === id)?.status
      expect(status(open.id)).toBe('available')
      expect(status(nearly.id)).toBe('almost_full')
      expect(status(full.id)).toBe('waitlist')
      expect(status(packed.id)).toBe('full')
      expect(status(cancelled.id)).toBe('cancelled')
      expect(listed.find((c) => c.id === hidden.id)).toBeUndefined()
      expect(listed.find((c) => c.id === priv.id)).toBeUndefined()
      expect(listed.find((c) => c.id === open.id)).toMatchObject({ coach: 'Sam Coach', location: 'Downtown', spotsLeft: 10 })
      expect(listed.find((c) => c.id === nearly.id)?.spotsLeft).toBe(1)
      expect(listed.find((c) => c.id === full.id)).toMatchObject({ spotsLeft: 0, waitlistAvailable: true })
      const text = JSON.stringify(listed)
      for (const secret of ['sam.private', '555-PRIVATE', 'key under mat', g.ownerId, coach.id, 'capacity']) expect(text, secret).not.toContain(secret)
      // Beyond the booking window it is listed as not open yet, and cannot be booked.
      const later = (await publicClasses(site, null, { date: zonedParts(far.startsAt, TZ).date, days: 1 })).classes.find((c) => c.id === far.id)
      expect(later).toMatchObject({ status: 'not_open', spotsLeft: 0 })
      const member = await createMember(g.ownerId)
      await expect(bookClassOnline(site, viewerOf(member), { classId: far.id }, BASE)).rejects.toMatchObject({ status: 422 })
      // A class that is not public does not exist as far as the page is concerned, whoever asks.
      for (const id of [hidden.id, priv.id, randomUUID()]) {
        await expect(publicClass(site, null, id)).rejects.toMatchObject({ status: 404 })
        await expect(bookClassOnline(site, viewerOf(member), { classId: id }, BASE)).rejects.toMatchObject({ status: 404 })
      }
      // The website's own, shorter window wins over the gym's.
      await saveBookingSite(g.ownerId, defaults(g.slug, { locationIds: [downtown.id], advanceDays: 1 }))
      const short = await resolveSite(g.slug)
      expect((await publicClasses(short, null, { date: day, days: 2 })).classes.find((c) => c.id === open.id)?.status).toBe('not_open')
      await expect(bookClassOnline(short, viewerOf(member), { classId: open.id }, BASE)).rejects.toMatchObject({ code: 'booking_not_open' })
    })

    it('enforces membership requirements, and offers the ways in that the gym sells publicly', async () => {
      const g = await gymWithSite()
      const unlimited = await createPlan(g.ownerId, { name: 'Unlimited', priceCents: 15000, isPublic: true })
      const trial = await createPlan(g.ownerId, { name: 'Free Trial Class', type: 'trial', priceCents: 0, credits: 1, isPublic: true })
      const secret = await createPlan(g.ownerId, { name: 'Staff Comp', priceCents: 0, isPublic: false })
      const session = await createSession(g.ownerId, { capacity: 5 })
      const vip = await createSession(g.ownerId, { capacity: 5, allowedPlanIds: [unlimited.id] })

      // A member whose plan covers it: eligible, and booked.
      const holder = await withAccount(g.ownerId)
      await tx((db) => sellMembership(db, { ownerId: g.ownerId, memberId: holder.id, planId: unlimited.id, paymentMethod: 'cash' }))
      const holderNow = await prisma.member.findUniqueOrThrow({ where: { id: holder.id } })
      expect((await publicClass(g.site, viewerOf(holderNow), vip.id)).eligibility).toMatchObject({ eligible: true })
      const booked = await bookClassOnline(g.site, viewerOf(holderNow), { classId: vip.id }, BASE)
      expect(booked).toMatchObject({ kind: 'class', status: 'booked' })
      expect(booked.reference).toMatch(/^[0-9A-F]{8}$/)
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: booked.id } })).toMatchObject({ channel: 'online', source: 'member', memberId: holder.id })

      // A guest with nothing: told what is needed, shown the public plans (not the private one), and refused if they try anyway.
      const guest = ((await identifyGuest(g.site, { name: 'Greg Guest', email: `greg-${randomUUID()}@test.local`, phone: null }, noSend)) as { member: Member }).member
      const view = await publicClass(g.site, viewerOf(guest, false), session.id)
      expect(view.eligibility).toMatchObject({ eligible: false, code: 'no_membership' })
      expect(view.eligibility!.message).not.toContain('Greg')
      expect(view.plans.map((p) => p.name).sort()).toEqual(['Free Trial Class', 'Unlimited'])
      expect(view.plans.find((p) => p.name === 'Free Trial Class')).toMatchObject({ free: true, priceLabel: 'Free' })
      expect(JSON.stringify(view)).not.toContain(secret.id)
      await expect(bookClassOnline(g.site, viewerOf(guest, false), { classId: session.id }, BASE)).rejects.toMatchObject({ status: 422, code: 'no_membership' })
      expect(await prisma.booking.count({ where: { memberId: guest.id } })).toBe(0)
      // For the plan-restricted class only the plan that opens it is offered.
      expect((await publicClass(g.site, viewerOf(guest, false), vip.id)).plans.map((p) => p.name)).toEqual(['Unlimited'])

      // A guest may start the free trial, but not anything that bills, and not a plan the gym does not sell publicly.
      await expect(startPlanOnline(g.site, viewerOf(guest, false), unlimited.id)).rejects.toMatchObject({ status: 403, code: 'account_required' })
      await expect(startPlanOnline(g.site, viewerOf(guest, false), secret.id)).rejects.toMatchObject({ status: 404 })
      expect(await startPlanOnline(g.site, viewerOf(guest, false), trial.id)).toMatchObject({ name: 'Free Trial Class', creditsRemaining: 1 })
      const active = await prisma.member.findUniqueOrThrow({ where: { id: guest.id } })
      const after = await publicClass(g.site, viewerOf(active, false), session.id)
      expect(after.eligibility).toMatchObject({ eligible: true, usesCredit: true })
      const trialBooking = await bookClassOnline(g.site, viewerOf(active, false), { classId: session.id }, BASE)
      expect(trialBooking).toMatchObject({ status: 'booked', usedCredit: true })
      // The trial is one class and one time only.
      await expect(startPlanOnline(g.site, viewerOf(active, false), trial.id)).rejects.toMatchObject({ status: 409, code: 'already_used' })
      const another = await createSession(g.ownerId, { capacity: 5 })
      await expect(bookClassOnline(g.site, viewerOf(active, false), { classId: another.id }, BASE)).rejects.toMatchObject({ status: 422 })
      expect((await publicClass(g.site, viewerOf(active, false), another.id)).plans.map((p) => p.name)).toEqual(['Unlimited'])
      // The trial does not open the plan-restricted class.
      await expect(bookClassOnline(g.site, viewerOf(active, false), { classId: vip.id }, BASE)).rejects.toMatchObject({ status: 422 })
    })

    it('joins the waitlist only when asked, shows the position, and moves people up by the existing rules', async () => {
      const g = await gymWithSite({}, { waitlistOfferMinutes: 0 })
      const plan = await createPlan(g.ownerId)
      const session = await createSession(g.ownerId, { capacity: 1, waitlistCapacity: 2 })
      const people = []
      for (let i = 0; i < 3; i++) { const m = await withAccount(g.ownerId); await tx((db) => sellMembership(db, { ownerId: g.ownerId, memberId: m.id, planId: plan.id, paymentMethod: 'cash' })); people.push(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })) }
      const first = await bookClassOnline(g.site, viewerOf(people[0]), { classId: session.id }, BASE)
      expect(first.status).toBe('booked')
      await expect(bookClassOnline(g.site, viewerOf(people[1]), { classId: session.id }, BASE)).rejects.toMatchObject({ status: 422, code: 'class_full' })
      expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(1)
      const second = await bookClassOnline(g.site, viewerOf(people[1]), { classId: session.id, joinWaitlist: true }, BASE)
      const third = await bookClassOnline(g.site, viewerOf(people[2]), { classId: session.id, joinWaitlist: true }, BASE)
      expect(second).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
      expect(third).toMatchObject({ status: 'waitlisted', waitlistPosition: 2 })
      expect((await publicClasses(g.site, viewerOf(people[2]), { date: zonedParts(session.startsAt, TZ).date })).classes.find((c) => c.id === session.id)).toMatchObject({ status: 'full', myBooking: { status: 'waitlisted' } })
      // The booked member cancels online: the waitlist engine gives the spot to the first in line.
      const cancelled = await cancelOnline(g.site, { memberId: people[0].id }, 'class', first.id, BASE)
      expect(cancelled).toMatchObject({ status: 'cancelled', late: false })
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('booked')
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: third.id } })).status).toBe('waitlisted')
      // Leaving the waitlist is a cancellation too.
      expect((await cancelOnline(g.site, { memberId: people[2].id }, 'class', third.id, BASE)).status).toBe('cancelled')
    })

    it('applies the gym\'s late-cancellation rule and lets nobody cancel for someone else', async () => {
      const g = await gymWithSite({}, { cancelWindowHours: 24, lateCancelUsesCredit: true })
      const pack = await createPlan(g.ownerId, { name: '5 Pack', type: 'class_pack', priceCents: 5000, credits: 5 })
      const soon = await createSession(g.ownerId, { startsAt: new Date(Date.now() + 3 * HOUR), capacity: 5 })
      const member = await withAccount(g.ownerId)
      await tx((db) => sellMembership(db, { ownerId: g.ownerId, memberId: member.id, planId: pack.id, paymentMethod: 'cash' }))
      const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } })
      const booking = await bookClassOnline(g.site, viewerOf(row), { classId: soon.id }, BASE)
      expect(booking.can).toEqual({ cancel: true, cancelFree: false })
      expect(booking.cancelNote).toMatch(/late cancellation/)
      const stranger = await withAccount(g.ownerId)
      await expect(cancelOnline(g.site, { memberId: stranger.id }, 'class', booking.id, BASE)).rejects.toMatchObject({ status: 404 })
      const other = await gymWithSite()
      await expect(cancelOnline(other.site, { memberId: member.id }, 'class', booking.id, BASE)).rejects.toMatchObject({ status: 404 })
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('booked')
      const cancelled = await cancelOnline(g.site, { memberId: member.id }, 'class', booking.id, BASE)
      expect(cancelled).toMatchObject({ status: 'late_cancelled', late: true, creditReturned: false })
      expect((await prisma.membership.findFirstOrThrow({ where: { memberId: member.id } })).creditsRemaining).toBe(4)
    })
  })

  describe('appointments and payments', () => {
    const slot = (days: number, time: string) => zonedToUtc(addDaysToDate(zonedParts(new Date(), TZ).date, days), time, TZ)

    it('lets a guest book a free consultation, and requires an account for anything paid or on sessions', async () => {
      const g = await gymWithSite()
      const intro = await appointmentType(g.ownerId)
      const paid = await appointmentType(g.ownerId, { name: 'Paid PT', paymentMode: 'paid', priceCents: 8000 })
      const hidden = await appointmentType(g.ownerId, { name: 'Not Public' })
      const staffOnly = await appointmentType(g.ownerId, { name: 'Staff Booked', memberBookable: false })
      await saveBookingSite(g.ownerId, defaults(g.slug, { appointmentTypeIds: [intro.type.id, paid.type.id, staffOnly.type.id] }))
      const site = await resolveSite(g.slug)
      const guest = ((await identifyGuest(site, { name: 'Gail Guest', email: `gail-${randomUUID()}@test.local`, phone: null }, noSend)) as { member: Member }).member
      const booked = await bookAppointmentOnline(site, viewerOf(guest, false), { typeId: intro.type.id, startsAt: slot(3, '10:00') }, BASE)
      expect(booked).toMatchObject({ kind: 'appointment', status: 'booked', coach: intro.coach.name, payment: null })
      expect(await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } })).toMatchObject({ channel: 'online', source: 'member', memberId: guest.id })
      await expect(bookAppointmentOnline(site, viewerOf(guest, false), { typeId: paid.type.id, startsAt: slot(3, '12:00') }, BASE)).rejects.toMatchObject({ status: 403, code: 'account_required' })
      // Types that are not public, or that staff book, do not exist here. Nor does a coach who does not offer the type.
      for (const typeId of [hidden.type.id, staffOnly.type.id, randomUUID()]) await expect(bookAppointmentOnline(site, viewerOf(guest, false), { typeId, startsAt: slot(3, '14:00') }, BASE)).rejects.toMatchObject({ status: 404 })
      await expect(bookAppointmentOnline(site, viewerOf(guest, false), { typeId: intro.type.id, startsAt: slot(3, '14:00'), staffId: paid.coach.id }, BASE)).rejects.toMatchObject({ status: 404 })
      // The engine's own rules hold: outside working hours, and a time already taken.
      await expect(bookAppointmentOnline(site, viewerOf(guest, false), { typeId: intro.type.id, startsAt: slot(3, '03:00') }, BASE)).rejects.toMatchObject({ status: 422 })
      const second = await createMember(g.ownerId)
      await expect(bookAppointmentOnline(site, viewerOf(second), { typeId: intro.type.id, startsAt: slot(3, '10:30') }, BASE)).rejects.toMatchObject({ status: expect.any(Number) })
      expect(await prisma.appointment.count({ where: { ownerId: g.ownerId, typeId: intro.type.id, status: 'booked' } })).toBe(1)
      // Cancelling in good time returns nothing to pay and frees the slot.
      const cancelled = await cancelOnline(site, { memberId: guest.id }, 'appointment', booked.id, BASE)
      expect(cancelled).toMatchObject({ status: 'cancelled', late: false })
      expect((await bookAppointmentOnline(site, viewerOf(second), { typeId: intro.type.id, startsAt: slot(3, '10:30') }, BASE)).status).toBe('booked')
    })

    it('charges a paid appointment once through the gym\'s processor, and books nothing when the card is declined', async () => {
      const g = await gymWithSite()
      const paid = await appointmentType(g.ownerId, { name: 'Paid PT', paymentMode: 'paid', priceCents: 8000 })
      await saveBookingSite(g.ownerId, defaults(g.slug, { appointmentTypeIds: [paid.type.id] }))
      const site = await resolveSite(g.slug)
      const p = useProcessor()
      const member = await saveCard(await withAccount(g.ownerId))
      const ok = await bookAppointmentOnline(site, viewerOf(member), { typeId: paid.type.id, startsAt: slot(4, '10:00') }, BASE)
      expect(ok).toMatchObject({ status: 'booked', paymentStatus: 'succeeded', payment: { label: expect.stringContaining('paid') } })
      expect(p.charges).toHaveLength(1)
      expect(p.charges[0]).toMatchObject({ ownerId: g.ownerId, amountCents: 8000, memberId: member.id })
      const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: ok.id }, include: { invoice: true } })
      expect(appointment.invoice).toMatchObject({ status: 'paid', totalCents: 8000, amountPaidCents: 8000 })
      expect(await prisma.transaction.count({ where: { invoiceId: appointment.invoiceId!, type: 'payment', status: 'succeeded' } })).toBe(1)

      // Declined: a clear 402, no appointment left standing, the time free again, and a retry that works.
      p.decline = true
      const at = slot(4, '13:00')
      await expect(bookAppointmentOnline(site, viewerOf(member), { typeId: paid.type.id, startsAt: at }, BASE)).rejects.toMatchObject({ status: 402, code: 'payment_failed' })
      expect(await prisma.appointment.count({ where: { ownerId: g.ownerId, memberId: member.id, status: 'booked' } })).toBe(1)
      expect(await prisma.appointment.count({ where: { ownerId: g.ownerId, memberId: member.id, startsAt: at, status: 'booked' } })).toBe(0)
      expect(await prisma.transaction.count({ where: { ownerId: g.ownerId, memberId: member.id, type: 'payment', status: 'succeeded' } })).toBe(1)
      p.decline = false
      const retry = await bookAppointmentOnline(site, viewerOf(member), { typeId: paid.type.id, startsAt: at }, BASE)
      expect(retry).toMatchObject({ status: 'booked', paymentStatus: 'succeeded' })
      expect(await prisma.transaction.count({ where: { ownerId: g.ownerId, memberId: member.id, type: 'payment', status: 'succeeded' } })).toBe(2)
      // The price charged is the type's price now, whatever the browser showed.
      await prisma.appointmentType.update({ where: { id: paid.type.id }, data: { priceCents: 9500 } })
      await bookAppointmentOnline(site, viewerOf(member), { typeId: paid.type.id, startsAt: slot(5, '10:00') }, BASE)
      expect(p.charges.at(-1)!.amountCents).toBe(9500)
    })

    it('sells a plan with the saved card, undoes the sale on a decline, and needs a card for anything that costs', async () => {
      const g = await gymWithSite()
      const pack = await createPlan(g.ownerId, { name: '10 Class Pack', type: 'class_pack', priceCents: 12000, credits: 10, isPublic: true })
      const p = useProcessor()
      const noCard = await withAccount(g.ownerId)
      await expect(startPlanOnline(g.site, viewerOf(noCard), pack.id)).rejects.toMatchObject({ status: 409, code: 'no_payment_method' })
      expect(await prisma.membership.count({ where: { memberId: noCard.id } })).toBe(0)
      const member = await saveCard(await withAccount(g.ownerId))
      p.decline = true
      await expect(startPlanOnline(g.site, viewerOf(member), pack.id)).rejects.toMatchObject({ status: 402, code: 'payment_failed' })
      expect(await prisma.membership.findFirstOrThrow({ where: { memberId: member.id } })).toMatchObject({ status: 'cancelled', creditsRemaining: 0 })
      const session = await createSession(g.ownerId, { capacity: 5 })
      await expect(bookClassOnline(g.site, viewerOf(await prisma.member.findUniqueOrThrow({ where: { id: member.id } })), { classId: session.id }, BASE)).rejects.toMatchObject({ status: 422 })
      p.decline = false
      expect(await startPlanOnline(g.site, viewerOf(member), pack.id)).toMatchObject({ payment: 'succeeded', creditsRemaining: 10 })
      const now = await prisma.member.findUniqueOrThrow({ where: { id: member.id } })
      expect((await bookClassOnline(g.site, viewerOf(now), { classId: session.id }, BASE)).usedCredit).toBe(true)
      expect(p.charges.filter((c) => c.amountCents === 12000)).toHaveLength(2)
      expect(await prisma.transaction.count({ where: { memberId: member.id, type: 'payment', status: 'succeeded' } })).toBe(1)
    })
  })

  describe('races', () => {
    const settle = async <T>(jobs: Promise<T>[]) => { const r = await Promise.allSettled(jobs); return { ok: r.filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<T>[], failed: r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[] } }
    const slot = (days: number, time: string) => zonedToUtc(addDaysToDate(zonedParts(new Date(), TZ).date, days), time, TZ)
    async function members(ownerId: string, planId: string, n: number) {
      const out: Member[] = []
      for (let i = 0; i < n; i++) { const m = await createMember(ownerId); await tx((db) => sellMembership(db, { ownerId, memberId: m.id, planId, paymentMethod: 'cash' })); out.push(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })) }
      return out
    }

    it('gives the last spot in a class to exactly one of eight people booking at once', async () => {
      const g = await gymWithSite()
      const plan = await createPlan(g.ownerId)
      const session = await createSession(g.ownerId, { capacity: 1, waitlistCapacity: 5 })
      const people = await members(g.ownerId, plan.id, 8)
      const { ok, failed } = await settle(people.map((m) => bookClassOnline(g.site, viewerOf(m), { classId: session.id }, BASE)))
      expect(ok).toHaveLength(1)
      expect(failed.every((f) => f.reason.code === 'class_full')).toBe(true)
      expect(await prisma.booking.count({ where: { sessionId: session.id, status: 'booked' } })).toBe(1)
      expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(1)
    })

    it('gives the last spot to one of a member online and staff at the desk', async () => {
      const g = await gymWithSite()
      const plan = await createPlan(g.ownerId)
      for (let round = 0; round < 3; round++) {
        const session = await createSession(g.ownerId, { capacity: 1, waitlistCapacity: 5 })
        const [online, walkIn] = await members(g.ownerId, plan.id, 2)
        const { ok } = await settle<unknown>([
          bookClassOnline(g.site, viewerOf(online), { classId: session.id }, BASE),
          tx((db) => bookClass(db, { ownerId: g.ownerId, memberId: walkIn.id, sessionId: session.id, joinWaitlist: false, source: 'staff' })),
        ])
        expect(ok).toHaveLength(1)
        expect(await prisma.booking.count({ where: { sessionId: session.id, status: 'booked' } })).toBe(1)
      }
    })

    it('gives one appointment time to exactly one of six people asking for it at once', async () => {
      const g = await gymWithSite()
      const { type } = await appointmentType(g.ownerId)
      await saveBookingSite(g.ownerId, defaults(g.slug, { appointmentTypeIds: [type.id] }))
      const site = await resolveSite(g.slug)
      const people = await Promise.all(Array.from({ length: 6 }, () => createMember(g.ownerId)))
      const { ok, failed } = await settle(people.map((m) => bookAppointmentOnline(site, viewerOf(m), { typeId: type.id, startsAt: slot(3, '11:00') }, BASE)))
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(5)
      expect(await prisma.appointment.count({ where: { ownerId: g.ownerId, typeId: type.id, status: 'booked' } })).toBe(1)
    })

    it('spends a member\'s last class credit once when they book two classes at once', async () => {
      const g = await gymWithSite()
      const pack = await createPlan(g.ownerId, { name: 'Single', type: 'class_pack', priceCents: 2000, credits: 1 })
      const [member] = await members(g.ownerId, pack.id, 1)
      const a = await createSession(g.ownerId, { capacity: 5, startsAt: new Date(Date.now() + 2 * DAY) })
      const b = await createSession(g.ownerId, { capacity: 5, startsAt: new Date(Date.now() + 3 * DAY) })
      const { ok, failed } = await settle([a, b].map((s) => bookClassOnline(g.site, viewerOf(member), { classId: s.id }, BASE)))
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect((await prisma.membership.findFirstOrThrow({ where: { memberId: member.id } })).creditsRemaining).toBe(0)
      expect(await prisma.booking.count({ where: { memberId: member.id, status: 'booked' } })).toBe(1)
    })

    it('charges once when the same paid booking is sent twice at the same moment', async () => {
      const g = await gymWithSite()
      const paid = await appointmentType(g.ownerId, { name: 'Paid PT', paymentMode: 'paid', priceCents: 6000 })
      await saveBookingSite(g.ownerId, defaults(g.slug, { appointmentTypeIds: [paid.type.id] }))
      const site = await resolveSite(g.slug)
      const p = useProcessor()
      const member = await saveCard(await withAccount(g.ownerId))
      const { ok } = await settle(Array.from({ length: 4 }, () => bookAppointmentOnline(site, viewerOf(member), { typeId: paid.type.id, startsAt: slot(6, '09:00') }, BASE)))
      expect(ok).toHaveLength(1)
      expect(await prisma.appointment.count({ where: { ownerId: g.ownerId, memberId: member.id, status: 'booked' } })).toBe(1)
      expect(await prisma.transaction.count({ where: { ownerId: g.ownerId, memberId: member.id, type: 'payment', status: 'succeeded' } })).toBe(1)
      expect(new Set(p.charges.map((c) => c.invoiceId)).size).toBe(p.charges.length)
      expect(p.charges.filter((c) => c.amountCents === 6000)).toHaveLength(1)
    })
  })

  it('reports what online booking has done', async () => {
    const g = await gymWithSite()
    const plan = await createPlan(g.ownerId)
    const session = await createSession(g.ownerId, { capacity: 1, waitlistCapacity: 3 })
    const people: Member[] = []
    for (let i = 0; i < 3; i++) { const m = await createMember(g.ownerId); await tx((db) => sellMembership(db, { ownerId: g.ownerId, memberId: m.id, planId: plan.id, paymentMethod: 'cash' })); people.push(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })) }
    const first = await bookClassOnline(g.site, viewerOf(people[0]), { classId: session.id }, BASE)
    await bookClassOnline(g.site, viewerOf(people[1]), { classId: session.id, joinWaitlist: true }, BASE)
    // A booking made by staff is not an online booking.
    const other = await createSession(g.ownerId)
    await tx((db) => bookClass(db, { ownerId: g.ownerId, memberId: people[2].id, sessionId: other.id, joinWaitlist: false, source: 'staff' }))
    await identifyGuest(g.site, { name: 'New Person', email: `np-${randomUUID()}@test.local`, phone: null }, noSend)
    const { recordVisit } = await import('@/lib/services/public-booking')
    for (let i = 0; i < 10; i++) await recordVisit(g.site)
    let stats = await bookingStats(g.ownerId)
    expect(stats).toMatchObject({ visits: 10, bookings: 2, classBookings: 2, appointmentBookings: 0, waitlistJoins: 1, cancellations: 0, newPeople: 1, conversionPercent: 20 })
    expect(stats.upcoming.map((u) => u.member.id).sort()).toEqual([people[0].id, people[1].id].sort())
    await cancelOnline(g.site, { memberId: people[0].id }, 'class', first.id, BASE)
    stats = await bookingStats(g.ownerId)
    expect(stats.cancellations).toBe(1)
    // Another gym's numbers are its own.
    expect(await bookingStats((await gymWithSite()).ownerId)).toMatchObject({ visits: 0, bookings: 0, upcoming: [] })
  })
})

// ===========================================================================
describe.skipIf(!up)('online booking over HTTP', () => {
  let g: Awaited<ReturnType<typeof gymWithSite>>
  let other: Awaited<ReturnType<typeof gymWithSite>>
  let plan: Awaited<ReturnType<typeof createPlan>>
  let trial: Awaited<ReturnType<typeof createPlan>>
  let intro: Awaited<ReturnType<typeof appointmentType>>
  let session: Awaited<ReturnType<typeof createSession>>
  const api = (slug: string) => `/api/public/booking/${slug}`
  beforeEach(() => { address = ip() })

  beforeAll(async () => {
    g = await gymWithSite({ tagline: 'Strength for everybody', cancellationPolicy: 'Cancel 2 hours ahead.', contactEmail: 'hello@test.local', termsUrl: 'https://example.com/terms' }, { name: 'Harbor & Sons <Gym>' })
    other = await gymWithSite()
    plan = await createPlan(g.ownerId, { name: 'Unlimited', isPublic: true })
    trial = await createPlan(g.ownerId, { name: 'Free Trial Class', type: 'trial', priceCents: 0, credits: 1, isPublic: true })
    intro = await appointmentType(g.ownerId)
    await saveBookingSite(g.ownerId, defaults(g.slug, { tagline: 'Strength for everybody', cancellationPolicy: 'Cancel 2 hours ahead.', contactEmail: 'hello@test.local', termsUrl: 'https://example.com/terms', appointmentTypeIds: [intro.type.id] }))
    session = await createSession(g.ownerId, { capacity: 3, waitlistCapacity: 2 })
  })

  describe('public access', () => {
    it('serves an enabled gym by its address, and nothing at all for an unknown or switched-off one', async () => {
      const ok = await call('GET', api(g.slug))
      expect(ok.status).toBe(200)
      expect(ok.data.site).toMatchObject({ slug: g.slug, name: 'Harbor & Sons <Gym>', tagline: 'Strength for everybody', hasClasses: true, hasAppointments: true, options: { requireAccount: false, allowGuests: true }, policy: { cancellation: 'Cancel 2 hours ahead.', termsUrl: 'https://example.com/terms' }, contact: { email: 'hello@test.local' } })
      expect(ok.data.viewer).toBeNull()
      expect(ok.headers.get('cache-control')).toBe('no-store')
      expect(ok.headers.get('x-robots-tag')).toBe('noindex')
      // Nothing that identifies the gym, its owner or its staff internally.
      for (const secret of [g.ownerId, 'ownerId', 'stripe', 'keyHash', 'password', intro.coach.email]) expect(ok.text, secret).not.toContain(secret)

      const off = await gymWithSite({ enabled: false })
      const unknown = await call('GET', api('no-such-gym-here'))
      const disabled = await call('GET', api(off.slug))
      expect(unknown.status).toBe(404)
      expect(disabled.status).toBe(404)
      expect(disabled.json).toEqual(unknown.json)
      for (const path of ['/classes', `/classes/${session.id}`, '/appointment-types', `/slots?typeId=${intro.type.id}&date=2030-01-01`, '/me', '/session']) expect((await call('GET', api(off.slug) + path)).status, path).toBe(404)
      for (const [path, body] of [['/guest', { name: 'A B', email: 'a@test.local' }], ['/bookings', { classId: session.id }], ['/session', { email: 'a@test.local', password: 'x' }]] as const) expect((await call('POST', api(off.slug) + path, body)).status, path).toBe(404)
      // An address that is not even shaped like one, and the internal id used as one.
      for (const slug of [g.ownerId, 'UPPER', '..%2f..%2fapi', 'a']) expect((await call('GET', api(slug))).status, slug).toBe(404)
      // Turning it off takes effect at once.
      await saveBookingSite(off.ownerId, defaults(off.slug, { enabled: true }))
      expect((await call('GET', api(off.slug))).status).toBe(200)
      await saveBookingSite(off.ownerId, defaults(off.slug, { enabled: false }))
      expect((await call('GET', api(off.slug))).status).toBe(404)
    })

    it('renders a page with a title and description, indexable only in its plain form, and frameable only under /book', async () => {
      const page = await call('GET', `/book/${g.slug}`)
      expect(page.status).toBe(200)
      expect(page.text).toContain('<title>Book online | Harbor &amp; Sons &lt;Gym&gt;</title>')
      expect(page.text).toMatch(/<meta name="description" content="Strength for everybody"/)
      expect(page.text).toMatch(/<meta property="og:title" content="Book online \| Harbor &amp; Sons &lt;Gym&gt;"/)
      expect(page.text).toMatch(/<meta name="robots" content="index, follow"/)
      expect(page.text).toContain('--color-accent:15 118 110')
      // The gym's name is text, never markup.
      expect(page.text).not.toContain('<Gym>')
      expect(page.headers.get('x-frame-options')).toBeNull()
      expect(page.headers.get('content-security-policy')).toContain('frame-ancestors *')
      const embedded = await call('GET', `/book/${g.slug}?embed=1`)
      expect(embedded.text).toMatch(/<meta name="robots" content="noindex, nofollow"/)
      expect((await call('GET', `/book/${g.slug}?class=${session.id}`)).text).toMatch(/noindex/)
      // An address not in use shows "not available" and is never indexed. (The framework sends it with
      // status 200 once the page has started streaming; the API underneath answers a true 404.)
      const missing = await call('GET', '/book/no-such-gym-here')
      expect(missing.text).toContain('This booking page is not available')
      expect(missing.text).toMatch(/<meta name="robots" content="noindex, nofollow"/)
      expect(missing.text).not.toContain('Book online |')
      const token = await signManageToken({ ownerId: g.ownerId, memberId: randomUUID(), kind: 'class', id: randomUUID() }, new Date(Date.now() + DAY))
      const manage = await call('GET', `/book/${g.slug}/manage/${token}`)
      expect(manage.text).toMatch(/noindex/)
      expect(manage.text).toMatch(/name="referrer" content="no-referrer"/)
      // Everything else in the app still refuses to be framed.
      for (const path of ['/login', '/member/login', '/settings/online-booking']) {
        const r = await call('GET', path)
        expect(r.headers.get('x-frame-options'), path).toBe('DENY')
        expect(r.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
      }
      const script = await call('GET', '/embed/booking.js')
      expect(script.status).toBe(200)
      expect(script.headers.get('access-control-allow-origin')).toBe('*')
      expect(script.text).toContain("'/book/' + slug + '?embed=1'")
    })

    it('is configured only by the owner or an admin, with every setting checked', async () => {
      const staff = async (role: string) => { const row = await prisma.staff.create({ data: { ownerId: g.ownerId, name: role, email: `${randomUUID()}@test.local`, password: 'x', role } }); return `auth-token=${await createToken({ ownerId: g.ownerId, staffId: row.id, role: role as never })}` }
      for (const role of ['manager', 'front_desk', 'coach', 'sales']) {
        const cookie = await staff(role)
        expect((await call('GET', '/api/settings/online-booking', undefined, { cookie })).status, role).toBe(403)
        expect((await call('PUT', '/api/settings/online-booking', defaults(g.slug), { cookie })).status, role).toBe(403)
      }
      expect((await call('GET', '/api/settings/online-booking')).status).toBe(401)
      const mine = await call('GET', '/api/settings/online-booking', undefined, { cookie: g.owner })
      expect(mine.status).toBe(200)
      expect(mine.data.site).toMatchObject({ slug: g.slug, enabled: true })
      expect(mine.data.site).not.toHaveProperty('ownerId')
      const current = mine.data.site
      for (const bad of [{ slug: other.slug }, { slug: 'admin' }, { primaryColor: 'red;}' }, { termsUrl: 'javascript:alert(1)' }, { locationIds: [randomUUID()] }, { appointmentTypeIds: [(await appointmentType(other.ownerId)).type.id] }]) {
        const r = await call('PUT', '/api/settings/online-booking', { ...current, ...bad }, { cookie: g.owner })
        expect([400, 404, 409], JSON.stringify(bad)).toContain(r.status)
      }
      expect((await call('GET', api(g.slug))).data.site.slug).toBe(g.slug)
      const stats = await call('GET', '/api/settings/online-booking/stats', undefined, { cookie: g.owner })
      expect(stats.status).toBe(200)
      expect(stats.data.visits).toBeGreaterThanOrEqual(0)
    })
  })

  describe('a guest, start to finish', () => {
    let token: string
    let email: string
    let confirmation: any

    it('browses, gives their details, starts the free trial, books, and gets a confirmation they can return to', async () => {
      const day = zonedParts(session.startsAt, TZ).date
      const listing = await call('GET', `${api(g.slug)}/classes?date=${day}&days=1`)
      const row = listing.data.classes.find((c: any) => c.id === session.id)
      expect(row).toMatchObject({ status: 'available', spotsLeft: 3, myBooking: null })
      // Not known yet: the page can look, but not book.
      expect((await call('POST', `${api(g.slug)}/bookings`, { classId: session.id })).status).toBe(401)
      expect((await call('GET', `${api(g.slug)}/me`)).status).toBe(401)

      email = `walkin-${randomUUID()}@test.local`
      const guest = await call('POST', `${api(g.slug)}/guest`, { name: 'Wendy Walkin', email, phone: '555-0177', resume: { classId: session.id } })
      expect(guest.status).toBe(200)
      expect(guest.data).toMatchObject({ status: 'ok', viewer: { name: 'Wendy Walkin', firstName: 'Wendy', email, hasAccount: false } })
      token = guest.data.token
      expect(guest.text).not.toMatch(/"id"|memberId|ownerId/)

      const detail = await call('GET', `${api(g.slug)}/classes/${session.id}`, undefined, { token })
      expect(detail.data.eligibility).toMatchObject({ eligible: false, code: 'no_membership' })
      expect(detail.data.plans.map((p: any) => p.name).sort()).toEqual(['Free Trial Class', 'Unlimited'])
      const refused = await call('POST', `${api(g.slug)}/bookings`, { classId: session.id }, { token })
      expect(refused.status).toBe(422)
      expect(refused.json.code).toBe('no_membership')
      expect((await call('POST', `${api(g.slug)}/plans`, { planId: plan.id }, { token })).status).toBe(403)
      expect((await call('POST', `${api(g.slug)}/plans`, { planId: trial.id }, { token })).status).toBe(200)

      const key = randomUUID()
      const booked = await call('POST', `${api(g.slug)}/bookings`, { classId: session.id }, { token, headers: { 'Idempotency-Key': key } })
      expect(booked.status, booked.text).toBe(200)
      confirmation = booked.data
      expect(confirmation).toMatchObject({ kind: 'class', status: 'booked', name: 'CrossFit', usedCredit: true, can: { cancel: true, cancelFree: true } })
      expect(confirmation.reference).toMatch(/^[0-9A-F]{8}$/)
      // A double tap, or a retry after a dropped connection, is the same booking.
      const again = await call('POST', `${api(g.slug)}/bookings`, { classId: session.id }, { token, headers: { 'Idempotency-Key': key } })
      expect(again.headers.get('idempotent-replayed')).toBe('true')
      expect(again.data.id).toBe(confirmation.id)
      const member = await prisma.member.findFirstOrThrow({ where: { ownerId: g.ownerId, email } })
      expect(member).toMatchObject({ leadSource: 'online_booking', smsOptIn: false })
      expect(await prisma.booking.count({ where: { memberId: member.id } })).toBe(1)
      expect((await call('GET', `${api(g.slug)}/classes?date=${day}&days=1`, undefined, { token })).data.classes.find((c: any) => c.id === session.id)).toMatchObject({ spotsLeft: 2, myBooking: { status: 'booked' } })
      // A confirmation email was queued through the gym's own messaging, to the address given, and no text was sent.
      const messages = await prisma.message.findMany({ where: { ownerId: g.ownerId, memberId: member.id } })
      expect(messages.filter((m) => m.channel === 'email' && m.subject?.startsWith("You're booked"))).toHaveLength(1)
      expect(messages.find((m) => m.channel === 'email')!.body).toContain(`/book/${g.slug}/manage/`)
      expect(messages.filter((m) => m.channel === 'sms')).toHaveLength(0)
    })

    it('shows the booking through its link, gives a calendar file, and cancels by the rules', async () => {
      const link = `${api(g.slug)}/manage/${confirmation.manageToken}`
      const view = await call('GET', link)
      expect(view.status).toBe(200)
      expect(view.data).toMatchObject({ id: confirmation.id, status: 'booked', reference: confirmation.reference })
      const ics = await call('GET', `${link}/calendar`)
      expect(ics.headers.get('content-type')).toContain('text/calendar')
      expect(ics.text).toContain('BEGIN:VEVENT')
      expect(ics.text).toContain('SUMMARY:CrossFit at Harbor & Sons <Gym>')
      expect(ics.text).toContain(`Reference ${confirmation.reference}`)
      // The link is for this gym's page only, and cannot be altered or guessed.
      expect((await call('GET', `${api(other.slug)}/manage/${confirmation.manageToken}`)).status).toBe(404)
      expect((await call('POST', `${api(other.slug)}/manage/${confirmation.manageToken}`, {})).status).toBe(404)
      const parts = confirmation.manageToken.split('.')
      for (const forged of [`${parts[0]}.${parts[1]}.AAAA`, `${confirmation.manageToken}x`, 'nonsense', token]) expect((await call('GET', `${api(g.slug)}/manage/${forged}`)).status, forged.slice(0, 12)).toBe(404)
      expect((await call('GET', `${api(g.slug)}/me`, undefined, { token })).data.map((b: any) => b.id)).toEqual([confirmation.id])

      const cancelled = await call('POST', link, {})
      expect(cancelled.status).toBe(200)
      expect(cancelled.data).toMatchObject({ status: 'cancelled', late: false, creditReturned: true })
      expect((await call('GET', link)).data.status).toBe('cancelled')
      // Cancelling again is refused by the booking engine, not repeated.
      expect((await call('POST', link, {})).status).toBeGreaterThanOrEqual(400)
      const member = await prisma.member.findFirstOrThrow({ where: { ownerId: g.ownerId, email } })
      expect((await prisma.membership.findFirstOrThrow({ where: { memberId: member.id } })).creditsRemaining).toBe(1)
      expect((await prisma.message.findMany({ where: { memberId: member.id, subject: { startsWith: 'Cancelled' } } }))).toHaveLength(1)
    })

    it('does not let a second person use an address the gym already knows', async () => {
      const again = await call('POST', `${api(g.slug)}/guest`, { name: 'Imposter', email, phone: null })
      expect(again.status).toBe(200)
      expect(again.data).toEqual({ status: 'check_email' })
      const upper = await call('POST', `${api(g.slug)}/guest`, { name: 'Imposter', email: email.toUpperCase(), phone: null })
      expect(upper.data).toEqual({ status: 'check_email' })
      expect(await prisma.member.count({ where: { ownerId: g.ownerId, email: { equals: email, mode: 'insensitive' } } })).toBe(1)
      // The guest's own short session stops the moment they have a real account.
      const member = await prisma.member.findFirstOrThrow({ where: { ownerId: g.ownerId, email } })
      const { token: invite } = await createInvite(g.ownerId, member.id)
      await setPasswordWithToken(invite, 'correct-horse-42')
      expect((await call('GET', `${api(g.slug)}/me`, undefined, { token })).status).toBe(401)
    })
  })

  describe('accounts', () => {
    it('signs a member in with the member app\'s own account, for this gym only', async () => {
      const member = await withAccount(g.ownerId)
      const elsewhere = await withAccount(other.ownerId)
      const ok = await call('POST', `${api(g.slug)}/session`, { email: member.email.toUpperCase(), password: 'correct-horse-42' })
      expect(ok.status).toBe(200)
      expect(ok.data.viewer).toMatchObject({ email: member.email, hasAccount: true })
      const token = ok.data.token
      expect((await call('GET', `${api(g.slug)}/me`, undefined, { token })).status).toBe(200)
      // The token opens the booking endpoints of this gym and nothing else.
      expect((await call('GET', `${api(other.slug)}/me`, undefined, { token })).status).toBe(401)
      expect((await call('GET', '/api/portal/me', undefined, { token })).status).toBe(401)
      expect((await call('GET', '/api/member-auth/session', undefined, { token })).json?.data?.member ?? null).toBeNull()
      expect((await call('GET', '/api/v1/members', undefined, { token })).status).toBe(401)
      for (const [email, password] of [[member.email, 'wrong-password'], [elsewhere.email, 'correct-horse-42'], [`nobody-${randomUUID()}@test.local`, 'correct-horse-42']]) {
        const r = await call('POST', `${api(g.slug)}/session`, { email, password })
        expect(r.status, email).toBe(401)
        expect(r.json).toEqual({ error: 'That email or password is not right.', code: 'invalid_credentials' })
      }
      // Changing the password ends booking sessions too.
      await prisma.memberAccount.update({ where: { memberId: member.id }, data: { sessionVersion: { increment: 1 } } })
      expect((await call('GET', `${api(g.slug)}/me`, undefined, { token })).status).toBe(401)
    })

    it('creates an account through the existing invitation, and comes back to the booking in progress', async () => {
      const email = `joiner-${randomUUID()}@test.local`
      const known = await withAccount(g.ownerId)
      const fresh = await call('POST', `${api(g.slug)}/account`, { name: 'Joan Joiner', email, phone: null, resume: { classId: session.id } })
      const existing = await call('POST', `${api(g.slug)}/account`, { name: 'Joan Joiner', email: known.email, phone: null, resume: { classId: session.id } })
      // Indistinguishable from outside.
      expect(fresh.status).toBe(200)
      expect(existing.status).toBe(200)
      expect(fresh.json).toEqual(existing.json)
      expect(fresh.data).toEqual({ status: 'check_email' })
      const member = await prisma.member.findFirstOrThrow({ where: { ownerId: g.ownerId, email } })
      expect(member).toMatchObject({ status: 'inactive', leadSource: 'online_booking' })
      expect(await prisma.memberAccount.count({ where: { memberId: member.id } })).toBe(0)
      // The link in that email is the member app's activation link; this is the same step it performs.
      await prisma.memberAuthToken.deleteMany({ where: { memberId: member.id } })
      const { token: invite } = await createInvite(g.ownerId, member.id)
      const activated = await call('POST', '/api/member-auth/set-password', { token: invite, password: 'correct-horse-42' })
      expect(activated.status).toBe(200)
      const cookie = (activated.headers.get('set-cookie') || '').split(';')[0]
      expect(cookie).toMatch(/^member-session=/)
      // Back on the booking page, the member app session is recognised and exchanged for a booking token.
      const back = await call('GET', api(g.slug), undefined, { cookie })
      expect(back.data.viewer).toMatchObject({ email, hasAccount: true })
      expect(back.data.token).toBeTruthy()
      const booked = await call('POST', `${api(g.slug)}/plans`, { planId: trial.id }, { token: back.data.token })
      expect(booked.status).toBe(200)
      expect((await call('POST', `${api(g.slug)}/bookings`, { classId: session.id }, { token: back.data.token })).data.status).toBe('booked')
      // That session is not honoured from inside another website's page, or on another gym's address.
      expect((await call('GET', api(g.slug), undefined, { cookie, headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } })).data.viewer).toBeNull()
      expect((await call('GET', api(other.slug), undefined, { cookie })).data.viewer).toBeNull()
    })
  })

  describe('appointments', () => {
    it('lists only what is public, offers the engine\'s free times, books one and frees it on cancel', async () => {
      const hidden = await appointmentType(g.ownerId, { name: 'Members Only Review' })
      const types = await call('GET', `${api(g.slug)}/appointment-types`)
      expect(types.data.map((t: any) => t.name)).toEqual(['Intro Session'])
      expect(types.data[0]).toMatchObject({ durationMin: 60, priceLabel: 'Free', needsAccount: false, blocked: null, coaches: [{ id: intro.coach.id, name: intro.coach.name }] })
      expect(types.text).not.toContain(intro.coach.email)
      const date = addDaysToDate(zonedParts(new Date(), TZ).date, 2)
      const slots = await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=${date}`)
      expect(slots.status).toBe(200)
      expect(slots.data.length).toBeGreaterThan(5)
      expect(slots.data[0].coaches).toEqual([{ id: intro.coach.id, name: intro.coach.name }])
      // Nothing for a type that is not public, a coach who does not offer it, a past date or one too far ahead.
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${hidden.type.id}&date=${date}`)).status).toBe(404)
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=${date}&staffId=${hidden.coach.id}`)).data).toEqual([])
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=2020-01-01`)).data).toEqual([])
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=${addDaysToDate(date, 200)}`)).data).toEqual([])
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=soon`)).status).toBe(400)

      const guest = await call('POST', `${api(g.slug)}/guest`, { name: 'Ian Intro', email: `ian-${randomUUID()}@test.local`, phone: null })
      const startsAt = slots.data[2].startsAt
      const booked = await call('POST', `${api(g.slug)}/appointments`, { typeId: intro.type.id, startsAt, notes: 'First time' }, { token: guest.data.token, headers: { 'Idempotency-Key': randomUUID() } })
      expect(booked.status, booked.text).toBe(200)
      expect(booked.data).toMatchObject({ kind: 'appointment', status: 'booked', name: 'Intro Session', coach: intro.coach.name, paymentStatus: 'none' })
      expect(booked.text).not.toMatch(/staffNotes|staffId|memberId/)
      // That time is gone for everyone else, at once.
      const after = await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=${date}`)
      expect(after.data.map((s: any) => s.startsAt)).not.toContain(startsAt)
      const second = await call('POST', `${api(g.slug)}/guest`, { name: 'Late Larry', email: `larry-${randomUUID()}@test.local`, phone: null })
      const clash = await call('POST', `${api(g.slug)}/appointments`, { typeId: intro.type.id, startsAt }, { token: second.data.token })
      expect(clash.status).toBeGreaterThanOrEqual(400)
      expect(clash.json.error).toBeTruthy()
      expect(clash.text).not.toMatch(/prisma|constraint|SELECT/i)
      const cancelled = await call('POST', `${api(g.slug)}/me`, { kind: 'appointment', id: booked.data.id }, { token: guest.data.token })
      expect(cancelled.data).toMatchObject({ status: 'cancelled', late: false })
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${intro.type.id}&date=${date}`)).data.map((s: any) => s.startsAt)).toContain(startsAt)
    })
  })

  describe('hostile callers', () => {
    it('cannot reach another gym, another customer, or anything private', async () => {
      const theirs = await createSession(other.ownerId, { capacity: 5 })
      const theirType = await appointmentType(other.ownerId)
      const theirPlan = await createPlan(other.ownerId, { name: 'Their Trial', type: 'trial', priceCents: 0, credits: 1, isPublic: true })
      const a = await withAccount(g.ownerId)
      await tx((db) => sellMembership(db, { ownerId: g.ownerId, memberId: a.id, planId: plan.id, paymentMethod: 'cash' }))
      const b = await withAccount(g.ownerId, { medicalNotes: 'PRIVATE-MEDICAL', phone: '555-PRIVATE-B' })
      await tx((db) => sellMembership(db, { ownerId: g.ownerId, memberId: b.id, planId: plan.id, paymentMethod: 'cash' }))
      const [ta, tb] = [await tokenOf(a), await tokenOf(b)]
      const mine = await createSession(g.ownerId, { capacity: 5 })
      const bBooking = await call('POST', `${api(g.slug)}/bookings`, { classId: mine.id }, { token: tb })
      expect(bBooking.status).toBe(200)

      // Gym A's page with gym B's ids: nothing.
      expect((await call('GET', `${api(g.slug)}/classes/${theirs.id}`, undefined, { token: ta })).status).toBe(404)
      expect((await call('POST', `${api(g.slug)}/bookings`, { classId: theirs.id }, { token: ta })).status).toBe(404)
      expect((await call('POST', `${api(g.slug)}/appointments`, { typeId: theirType.type.id, startsAt: new Date(Date.now() + 3 * DAY).toISOString() }, { token: ta })).status).toBe(404)
      expect((await call('POST', `${api(g.slug)}/plans`, { planId: theirPlan.id }, { token: ta })).status).toBe(404)
      expect((await call('GET', `${api(g.slug)}/slots?typeId=${theirType.type.id}&date=${addDaysToDate(zonedParts(new Date(), TZ).date, 2)}`)).status).toBe(404)
      // Gym A's token on gym B's page: not signed in at all.
      for (const path of ['/me', '/me/payment-methods']) expect((await call('GET', api(other.slug) + path, undefined, { token: ta })).status, path).toBe(401)
      expect((await call('POST', `${api(other.slug)}/bookings`, { classId: theirs.id }, { token: ta })).status).toBe(401)
      expect(await prisma.booking.count({ where: { ownerId: other.ownerId } })).toBe(0)

      // Another customer's booking: cannot be cancelled, seen, or found by trying ids.
      expect((await call('POST', `${api(g.slug)}/me`, { kind: 'class', id: bBooking.data.id }, { token: ta })).status).toBe(404)
      expect((await call('POST', `${api(g.slug)}/me`, { kind: 'appointment', id: bBooking.data.id }, { token: ta })).status).toBe(404)
      expect((await call('GET', `${api(g.slug)}/me`, undefined, { token: ta })).data).toEqual([])
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bBooking.data.id } })).status).toBe('booked')
      // Naming someone else in the request changes nothing: the token says who is booking.
      const sneaky = await call('POST', `${api(g.slug)}/bookings`, { classId: mine.id, memberId: b.id, ownerId: other.ownerId }, { token: ta })
      expect(sneaky.status).toBe(200)
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: sneaky.data.id } })).memberId).toBe(a.id)
      // What comes back never includes another person, or anything internal.
      const everything = [await call('GET', api(g.slug), undefined, { token: ta }), await call('GET', `${api(g.slug)}/classes`, undefined, { token: ta }), await call('GET', `${api(g.slug)}/classes/${mine.id}`, undefined, { token: ta }), await call('GET', `${api(g.slug)}/me`, undefined, { token: ta }), await call('GET', `${api(g.slug)}/appointment-types`, undefined, { token: ta }), sneaky].map((r) => r.text).join('\n')
      for (const secret of ['PRIVATE-MEDICAL', '555-PRIVATE-B', b.email, b.name, b.id, g.ownerId, 'ownerId', 'memberId', 'stripe', 'connectCustomerId', 'qrCode', 'accessToken', 'passwordHash', 'staffNotes', 'cc_live_', 'whsec_']) expect(everything, secret).not.toContain(secret)
      // A forged or foreign token is nobody.
      const forged = await signBookingSession({ ownerId: other.ownerId, memberId: b.id, sessionVersion: 0 })
      for (const token of [forged, `${ta}x`, await memberBearer(a.id).then((s) => s.replace('Bearer ', '')), 'cc_live_00000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) expect((await call('GET', `${api(g.slug)}/me`, undefined, { token })).status).toBe(401)
      // Bad input is refused plainly, with nothing internal.
      for (const [path, body] of [['/bookings', { classId: 'not-an-id' }], ['/bookings', {}], ['/appointments', { typeId: intro.type.id, startsAt: 'whenever' }], ['/guest', { name: '', email: 'x' }], ['/guest', { name: 'A B', email: 'a@test.local', phone: '<script>alert(1)</script>' }], ['/me', { kind: 'invoice', id: randomUUID() }]] as const) {
        const r = await call('POST', api(g.slug) + path, body, { token: ta })
        expect(r.status, path).toBe(400)
        expect(r.text).not.toMatch(/prisma|stack|at \w+ \(|node_modules|ZodError/i)
      }
      const notJson = await fetch(`${BASE}${api(g.slug)}/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address }, body: '{nope' })
      expect(notJson.status).toBe(400)
    })

    it('is rate limited per caller: sign-up and sign-in attempts, bookings, and availability lookups', async () => {
      const here = address
      try {
        // Guessing whether addresses are known, or filling the gym with fake people.
        address = ip()
        const sign: number[] = []
        for (let i = 0; i < 10; i++) sign.push((await call('POST', `${api(g.slug)}/guest`, { name: 'Flood Er', email: `flood-${i}-${randomUUID()}@test.local`, phone: null })).status)
        expect(sign.slice(0, 8).every((s) => s === 200)).toBe(true)
        expect(sign.slice(8)).toEqual([429, 429])
        const limited = await call('POST', `${api(g.slug)}/account`, { name: 'Flood Er', email: `flood-${randomUUID()}@test.local`, phone: null })
        expect(limited.status).toBe(429)
        expect(limited.json).toMatchObject({ code: 'rate_limited' })
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
        // Someone else is unaffected.
        address = ip()
        expect((await call('POST', `${api(g.slug)}/guest`, { name: 'Real Person', email: `real-${randomUUID()}@test.local`, phone: null })).status).toBe(200)

        address = ip()
        const logins: number[] = []
        for (let i = 0; i < 12; i++) logins.push((await call('POST', `${api(g.slug)}/session`, { email: `guess-${i}@test.local`, password: 'guess' })).status)
        expect(logins.slice(0, 10).every((s) => s === 401)).toBe(true)
        expect(logins.slice(10)).toEqual([429, 429])

        address = ip()
        const member = await withAccount(g.ownerId)
        const token = await tokenOf(member)
        const books: number[] = []
        for (let i = 0; i < 14; i++) books.push((await call('POST', `${api(g.slug)}/bookings`, { classId: randomUUID() }, { token })).status)
        expect(books.slice(0, 12).every((s) => s === 404)).toBe(true)
        expect(books.slice(12)).toEqual([429, 429])

        address = ip()
        const looks = await Promise.all(Array.from({ length: 66 }, () => call('GET', `${api(g.slug)}/classes`).then((r) => r.status)))
        expect(looks.filter((s) => s === 200)).toHaveLength(60)
        expect(looks.filter((s) => s === 429)).toHaveLength(6)
      } finally {
        address = here
      }
    })
  })
})

describe('online booking: embed script', () => {
  it('only ever frames this site\'s booking page, and only obeys its own frame', () => {
    const script = readFileSync(resolve(__dirname, '../public/embed/booking.js'), 'utf8')
    // The address comes from data-gym and must look like one; the frame's origin is the script's own.
    expect(script).toContain("/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)")
    expect(script).toContain('new URL(script.src).origin')
    expect(script).toContain("event.origin !== origin || event.source !== frame.contentWindow")
    // It writes no HTML and evaluates nothing.
    expect(script).not.toMatch(/innerHTML|document\.write|eval\(|new Function/)
    expect(script.length).toBeLessThan(4000)
  })
})
