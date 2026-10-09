// Security: what an attacker who controls one gym, one member account or no account at all
// can do to another gym's data, to other people's accounts, and to the platform itself.
// Each block is an attack that was tried against the running app; several found real holes,
// which are noted where they were. The HTTP half needs a running dev server and is skipped without one.

import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createToken, passwordVersion } from '@/lib/auth'
import { ADMIN_EMAILS } from '@/lib/admin'
import { signMemberSession } from '@/lib/member-auth'
import { googleSignInDecision } from '@/lib/google-sign-in'
import { getClientIP } from '@/lib/rate-limit'
import { emailSafety } from '@/lib/email'
import { emailHtml } from '@/lib/services/messaging'
import { MAX_FAILED_SIGN_INS } from '@/lib/login-attempts'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { sellMembership } from '@/lib/services/memberships'
import { recordPayment } from '@/lib/services/payments'
import { getBookingSite, saveBookingSite, siteSchema } from '@/lib/services/public-booking'
import { signBookingSession } from '@/lib/public-booking/tokens'
import { createApiKey } from '@/lib/public-api/keys'
import { SCOPE_KEYS } from '@/lib/public-api/scopes'
import { createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}
const ip = () => `198.22.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
const gyms: string[] = []
const gym = async (data: Record<string, unknown> = {}) => { const g = await createGym(data); gyms.push(g); return g }
afterAll(async () => { for (const g of gyms) { await prisma.bookingSite.deleteMany({ where: { ownerId: g } }); await destroyGym(g) } })

type Res = { status: number; json: any; text: string; headers: Headers }
/** A request to the dev server. `next dev` restarts itself under memory pressure; a refused connection is waited out, not counted. */
async function call(auth: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
        headers: { 'X-Forwarded-For': ip(), ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      })
      const text = await res.text()
      let json: any = null
      try { json = JSON.parse(text) } catch {}
      return { status: res.status, json, text, headers: res.headers }
    } catch (error) {
      if (attempt >= 5) throw error
      for (let waited = 0; waited < 90; waited++) { await new Promise((r) => setTimeout(r, 1000)); if (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(5000) }).then(() => true, () => false)) break }
    }
  }
}
const ownerCookie = async (ownerId: string) => `auth-token=${await createToken({ ownerId, emailVerified: true })}`
const staffCookie = async (ownerId: string, role: string) => {
  const s = await prisma.staff.create({ data: { ownerId, name: `Test ${role}`, email: `${role}-${randomUUID()}@test.local`, password: 'x', role } })
  return { staff: s, cookie: `auth-token=${await createToken({ ownerId, staffId: s.id, role: role as never })}` }
}

// ===========================================================================
describe('security: rules that need no server', () => {
  it('only signs someone in with Google when Google has verified the address, and never lets an unproven password survive', () => {
    const verified = { id: 'g-1', email: 'owner@gym.test', verified_email: true }
    // Found: the callback trusted any address Google returned. An unverified one could open an existing account.
    expect(googleSignInDecision({ ...verified, verified_email: false }, null)).toEqual({ action: 'reject', reason: 'unverified_email' })
    expect(googleSignInDecision({ id: 'g-1', email: 'owner@gym.test' }, { emailVerified: new Date(), provider: null, providerAccountId: null })).toEqual({ action: 'reject', reason: 'unverified_email' })
    expect(googleSignInDecision({ ...verified, verified_email: 'true' }, null)).toEqual({ action: 'reject', reason: 'unverified_email' })
    for (const bad of [{}, { email: 'a@b.test', verified_email: true }, { id: 'g', verified_email: true }, { id: 1, email: 'a@b.test', verified_email: true }]) expect(googleSignInDecision(bad, null)).toEqual({ action: 'reject', reason: 'no_profile' })
    expect(googleSignInDecision(verified, null)).toEqual({ action: 'create' })
    // An established account: linked, password untouched.
    expect(googleSignInDecision(verified, { emailVerified: new Date(), provider: null, providerAccountId: null })).toEqual({ action: 'sign_in', link: true, resetPassword: false })
    // Found: someone could register a victim's address first (never verifying it) and keep their password
    // working after the victim arrived through Google. That password is now thrown away at that moment.
    expect(googleSignInDecision(verified, { emailVerified: null, provider: null, providerAccountId: null })).toEqual({ action: 'sign_in', link: true, resetPassword: true })
    // Already linked to this Google identity: in. Linked to another: not in.
    expect(googleSignInDecision(verified, { emailVerified: new Date(), provider: 'google', providerAccountId: 'g-1' })).toEqual({ action: 'sign_in', link: false, resetPassword: false })
    expect(googleSignInDecision(verified, { emailVerified: new Date(), provider: 'google', providerAccountId: 'g-other' })).toEqual({ action: 'reject', reason: 'different_google_account' })
  })

  it('takes the caller\'s address from what the platform saw, not from what the caller claims', () => {
    const from = (headers: Record<string, string>) => getClientIP(new Request('http://x/', { headers }))
    // Found: the first X-Forwarded-For entry was always used, so a caller could pick their own "address"
    // for every rate limit and for the address recorded beside an e-signature.
    expect(from({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '203.0.113.9' })).toBe('203.0.113.9')
    expect(from({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-vercel-forwarded-for': '203.0.113.10', 'x-real-ip': '203.0.113.9' })).toBe('203.0.113.10')
    expect(from({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })).toBe('1.2.3.4')
    expect(from({})).toBe('unknown')
  })

  it('never lets a name or a link become markup in an email', () => {
    const hostile = '<img src=x onerror=alert(1)>"\'><script>alert(document.cookie)</script>'
    // Found: the older templates (waiver, payment reminder, welcome, feedback) put names straight into the HTML.
    expect(emailSafety.esc(hostile)).not.toMatch(/[<>"']/)
    expect(emailSafety.esc(hostile)).toContain('&lt;script&gt;')
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', ' javascript:alert(1)', 'not a url', '', null, undefined]) expect(emailSafety.safeUrl(bad as never), String(bad)).toBe('#')
    expect(emailSafety.safeUrl('https://pay.example.com/x?a=1')).toBe('https://pay.example.com/x?a=1')
    // A gym's name is the sender's display name: it cannot smuggle in an address or a second header.
    expect(emailSafety.displayName('Gym" <ceo@bank.example>\r\nBcc: everyone@x.test')).not.toMatch(/[<>"\r\n@:;,]/)
    expect(emailSafety.displayName('<<>>')).toBe('ClubCheck')
    const html = emailHtml(hostile, `Hello ${hostile} https://example.com/"onmouseover="x`)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toMatch(/href="[^"]*"onmouseover/)
  })

  it('ties a session to the password it began under', () => {
    const a = passwordVersion('$2a$10$abcdefghijklmnopqrstuv')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(passwordVersion('$2a$10$abcdefghijklmnopqrstuv')).toBe(a)
    expect(passwordVersion('$2a$10$abcdefghijklmnopqrstuw')).not.toBe(a)
    // Not the hash, and nothing the hash can be read back from.
    expect('$2a$10$abcdefghijklmnopqrstuv').not.toContain(a)
  })
})

// ===========================================================================
describe.skipIf(!up)('security over HTTP', () => {
  describe('the platform administrator', () => {
    it('is the verified account holder of a listed address, and nobody else on or near that account', async () => {
      const email = ADMIN_EMAILS[0]
      const existing = await prisma.owner.findUnique({ where: { email } })
      // The attack: register the administrator's address before they do. It never has to be verified to sign in.
      const admin = existing || (await prisma.owner.create({ data: { id: randomUUID(), email, password: await bcrypt.hash('attacker-chosen-1', 4), emailVerified: null } }))
      const coach = await prisma.staff.create({ data: { ownerId: admin.id, name: 'Any Coach', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach' } })
      const adminStaff = await prisma.staff.create({ data: { ownerId: admin.id, name: 'Gym Admin', email: `${randomUUID()}@test.local`, password: 'x', role: 'admin' } })
      const routes: [string, string, unknown?][] = [['GET', '/api/admin/analytics'], ['GET', '/api/admin/verify'], ['GET', '/api/admin/sales-reps'], ['POST', '/api/admin/sales-reps', { name: 'Planted Rep', email: `planted-${randomUUID()}@test.local`, password: 'planted-pass-1' }], ['PATCH', `/api/admin/sales-reps/${randomUUID()}`, { active: false }], ['POST', '/api/admin/demo/reset', {}]]
      try {
        const sessions: Record<string, string> = {
          // Found: both of these were let in. A coach on the administrator's own gym account had the platform's sales and analytics API.
          'a coach on the account': `auth-token=${await createToken({ ownerId: admin.id, staffId: coach.id, role: 'coach' })}`,
          'an admin-role staff member on the account': `auth-token=${await createToken({ ownerId: admin.id, staffId: adminStaff.id, role: 'admin' })}`,
          'the owner of some other gym': await ownerCookie(await gym()),
        }
        // Found: the address alone was enough, verified or not.
        if (!existing) sessions['whoever registered the address without verifying it'] = `auth-token=${await createToken({ ownerId: admin.id, emailVerified: false })}`
        for (const [who, cookie] of Object.entries(sessions)) for (const [method, path, body] of routes) expect((await call(cookie, method, path, body)).status, `${who}: ${method} ${path}`).toBe(403)
        for (const [method, path, body] of routes) expect([401, 403], `signed out: ${method} ${path}`).toContain((await call(null, method, path, body)).status)
        expect(await prisma.salesRep.count({ where: { name: 'Planted Rep' } })).toBe(0)
        // The real thing still works: the account holder, once the address is verified.
        if (!existing) {
          await prisma.owner.update({ where: { id: admin.id }, data: { emailVerified: new Date() } })
          expect((await call(`auth-token=${await createToken({ ownerId: admin.id, emailVerified: true })}`, 'GET', '/api/admin/verify')).json).toEqual({ isAdmin: true })
        }
      } finally {
        await prisma.staff.deleteMany({ where: { id: { in: [coach.id, adminStaff.id] } } })
        if (!existing) await prisma.owner.delete({ where: { id: admin.id } })
      }
    })
  })

  describe('sessions and tokens', () => {
    it('ends every earlier session when a password changes, for owners and for staff', async () => {
      const g = await gym()
      const email = `owner-${g}@test.local`
      await prisma.owner.update({ where: { id: g }, data: { password: await bcrypt.hash('first-password-1', 4) } })
      const signIn = async (password: string) => { const r = await call(null, 'POST', '/api/auth/login', { email, password }); expect(r.status, r.text).toBe(200); return (r.headers.get('set-cookie') || '').split(';')[0] }
      const laptop = await signIn('first-password-1')
      const stolen = await signIn('first-password-1')
      expect((await call(stolen, 'GET', '/api/me')).status).toBe(200)
      const changed = await call(laptop, 'POST', '/api/settings/password', { currentPassword: 'first-password-1', newPassword: 'second-password-2' })
      expect(changed.status, changed.text).toBe(200)
      const renewed = (changed.headers.get('set-cookie') || '').split(';')[0]
      expect(renewed).toMatch(/^auth-token=/)
      // Found: a session used to live out its seven days whatever happened to the password.
      expect((await call(stolen, 'GET', '/api/me')).status).toBe(401)
      expect((await call(laptop, 'GET', '/api/me')).status).toBe(401)
      expect((await call(stolen, 'GET', '/api/members')).status).toBe(401)
      expect((await call(stolen, 'GET', '/api/settings')).status).toBe(401)
      // The device that changed it carries on, with a cookie scripts cannot read.
      expect((await call(renewed, 'GET', '/api/me')).status).toBe(200)
      expect(changed.headers.get('set-cookie')).toMatch(/HttpOnly/i)
      expect((await call(renewed, 'POST', '/api/settings/password', { currentPassword: 'wrong', newPassword: 'third-password-3' })).status).toBe(400)

      // Staff: an admin resets someone's password; the session they had is over at once.
      const hash = await bcrypt.hash('staff-password-1', 4)
      const desk = await prisma.staff.create({ data: { ownerId: g, name: 'Dee Desk', email: `dee-${randomUUID()}@test.local`, password: hash, role: 'front_desk' } })
      const gymCode = `S${g.slice(0, 7).toUpperCase()}`
      await prisma.owner.update({ where: { id: g }, data: { gymCode } })
      const staffIn = await call(null, 'POST', '/api/auth/staff-login', { gymCode, email: desk.email, password: 'staff-password-1' })
      expect(staffIn.status, staffIn.text).toBe(200)
      const deskCookie = (staffIn.headers.get('set-cookie') || '').split(';')[0]
      expect((await call(deskCookie, 'GET', '/api/me')).status).toBe(200)
      expect((await call(renewed, 'PATCH', `/api/staff/${desk.id}`, { password: 'reset-by-admin-9' })).status).toBe(200)
      expect((await call(deskCookie, 'GET', '/api/me')).status).toBe(401)
      // And deactivating someone ends theirs too.
      const again = await call(null, 'POST', '/api/auth/staff-login', { gymCode, email: desk.email, password: 'reset-by-admin-9' })
      const fresh = (again.headers.get('set-cookie') || '').split(';')[0]
      expect((await call(fresh, 'GET', '/api/me')).status).toBe(200)
      await call(renewed, 'PATCH', `/api/staff/${desk.id}`, { active: false })
      expect((await call(fresh, 'GET', '/api/me')).status).toBe(401)
    })

    it('accepts each kind of token only where that kind belongs, and nothing forged or altered', async () => {
      const g = await gym()
      const member = await createMember(g)
      await setPasswordWithToken((await createInvite(g, member.id)).token, 'correct-horse-42')
      const account = await prisma.memberAccount.findUniqueOrThrow({ where: { memberId: member.id } })
      const memberToken = await signMemberSession({ memberId: member.id, ownerId: g, sessionVersion: account.sessionVersion })
      const bookingToken = await signBookingSession({ memberId: member.id, ownerId: g, sessionVersion: account.sessionVersion })
      const ownerToken = await createToken({ ownerId: g, emailVerified: true })
      const secret = new TextEncoder().encode(process.env.JWT_SECRET)
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
      const forged: Record<string, string> = {
        'a member session used as a staff cookie': memberToken,
        'a booking session used as a staff cookie': bookingToken,
        'an unsigned token (alg none)': `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ownerId: g, emailVerified: true, exp: Math.floor(Date.now() / 1000) + 3600 })}.`,
        'a token signed with the wrong secret': await new SignJWT({ ownerId: g, emailVerified: true }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode('not-the-secret')),
        'an expired token': await new SignJWT({ ownerId: g, emailVerified: true }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(secret),
        'a real token with its payload swapped': (() => { const [h, , s] = ownerToken.split('.'); return `${h}.${b64({ ownerId: gyms[0], emailVerified: true, exp: Math.floor(Date.now() / 1000) + 3600 })}.${s}` })(),
        'a real token with a character changed': ownerToken.slice(0, -2) + (ownerToken.endsWith('AA') ? 'BB' : 'AA'),
        // A member-style payload under the staff secret is still not a staff session: there is no account in it.
        'a correctly signed token with no account': await new SignJWT({ mid: member.id, gid: g, typ: 'member' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret),
        'a token for an account that no longer exists': await createToken({ ownerId: randomUUID(), emailVerified: true }),
        'a token naming staff from another gym': await createToken({ ownerId: g, staffId: (await staffCookie(await gym(), 'admin')).staff.id, role: 'admin' }),
        'a sales-rep token': await createToken({ ownerId: undefined as never, salesRepId: randomUUID() }),
      }
      for (const [what, token] of Object.entries(forged)) for (const path of ['/api/me', '/api/members', '/api/payroll/periods', '/api/billing/transactions', '/api/settings']) expect((await call(`auth-token=${token}`, 'GET', path)).status, `${what} → ${path}`).toBe(401)
      // The other direction: staff and booking tokens are not member sessions, and a booking token is not the member app.
      for (const [what, token] of Object.entries({ 'an owner token': ownerToken, 'a booking token': bookingToken, 'an unsigned token': forged['an unsigned token (alg none)'] })) {
        expect((await call(`Bearer ${token}`, 'GET', '/api/portal/me')).status, `${what} as a member bearer`).toBe(401)
        expect((await call(`member-session=${token}`, 'GET', '/api/portal/me')).status, `${what} as a member cookie`).toBe(401)
      }
      expect((await call(`Bearer ${memberToken}`, 'GET', '/api/portal/me')).status).toBe(200)
      // Our internal permission header cannot be supplied from outside.
      const coach = await staffCookie(g, 'coach')
      for (const spoof of [{ 'x-cc-requires': 'any' }, { 'X-CC-Requires': 'any' }, { 'x-cc-requires': '' }, { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' }, { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' }] as Record<string, string>[]) {
        for (const path of ['/api/analytics', '/api/checkin/export', '/api/invoices', '/api/billing-events', '/api/prospects']) expect((await call(coach.cookie, 'GET', path, undefined, spoof)).status, `${JSON.stringify(spoof)} ${path}`).toBe(403)
      }
    })

    it('runs the permission check on every API path, however the path is dressed up', async () => {
      const g = await gym()
      const coach = await staffCookie(g, 'coach')
      const lead = await prisma.prospect.create({ data: { ownerId: g, name: 'Lena Lead', email: `lena-${randomUUID()}@test.local` } })
      // Found: the middleware skipped any path ending like a file name, and the older routes rely on it for
      // their permission. A coach (no access to leads) reached the leads route by adding ".png".
      for (const path of [`/api/prospects/${lead.id}.png`, `/api/prospects/x.txt`, '/api/prospects/anything.xml', `/api/prospects/${lead.id}.webmanifest`]) {
        for (const method of ['GET', 'PATCH', 'DELETE']) expect((await call(coach.cookie, method, path, method === 'PATCH' ? { status: 'lost' } : undefined)).status, `${method} ${path}`).toBe(403)
      }
      for (const path of ['/api/analytics', '/api/analytics/', '/api//analytics', '/api/./analytics', '/api/x/../analytics', '/api/analytics?x=.png', '/api/analytics%2F', '/API/analytics', '/api/Analytics', '/api/analytics;.png', '/api/analytics%00.png', '/api/members/import', '/api/checkin/export', '/api/invoices', '/api/broadcast']) {
        const r = await call(coach.cookie, 'GET', path)
        expect([301, 307, 308, 400, 403, 404, 405], `${path} → ${r.status}`).toContain(r.status)
        expect(r.text, path).not.toMatch(/"revenue"|"members":\[|"prospects":\[/)
      }
      expect(await prisma.prospect.count({ where: { id: lead.id, status: { not: 'lost' } } })).toBe(1)
    })
  })

  describe('requests from another site', () => {
    it('refuses a cookie-authenticated change that arrives with another site\'s Origin', async () => {
      const g = await gym()
      const owner = await ownerCookie(g)
      const member = await createMember(g)
      const evil = { Origin: 'https://evil.example' }
      // Found: nothing on the server checked where a request came from; it relied on the browser's SameSite default alone.
      const attempts: [string, string, unknown][] = [
        ['POST', '/api/tags', { name: 'Planted', color: '#ff0000' }], ['DELETE', `/api/members/${member.id}`, undefined], ['PATCH', `/api/members/${member.id}`, { name: 'Renamed By Evil' }],
        ['POST', '/api/prospects', { name: 'Planted Lead', email: `planted-${randomUUID()}@test.local` }], ['POST', '/api/settings/password', { currentPassword: 'x', newPassword: 'evil-password-1' }],
        ['POST', '/api/staff', { name: 'Evil Admin', email: `evil-${randomUUID()}@test.local`, password: 'evil-password-1', role: 'admin' }], ['POST', '/api/developer/keys', { name: 'Evil key', scopes: ['members:read'] }],
        ['POST', '/api/payroll/periods', { startDate: '2026-01-01', endDate: '2026-01-14' }],
      ]
      for (const [method, path, body] of attempts) {
        const r = await call(owner, method, path, body, evil)
        expect(r.status, `${method} ${path}`).toBe(403)
        expect(r.json?.code).toBe('cross_site')
      }
      for (const origin of ['null', 'https://localhost.evil.example', 'http://localhost:3000.evil.example', 'https://evil.example:3000', 'file://']) expect((await call(owner, 'POST', '/api/tags', { name: 'Planted' }, { Origin: origin })).status, origin).toBe(403)
      expect(await prisma.tag.count({ where: { ownerId: g } })).toBe(0)
      expect(await prisma.staff.count({ where: { ownerId: g } })).toBe(0)
      expect(await prisma.prospect.count({ where: { ownerId: g } })).toBe(0)
      expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).name).toBe(member.name)
      // The site itself, and a client that is not a browser, are unaffected.
      expect((await call(owner, 'POST', '/api/tags', { name: 'Mine', color: '#00ff00' }, { Origin: BASE })).status).toBe(200)
      expect((await call(owner, 'POST', '/api/tags', { name: 'Also mine', color: '#00ff00' })).status).toBe(200)
      // Reading is not changed by this, and neither are the routes other sites are meant to call.
      expect((await call(owner, 'GET', '/api/tags', undefined, evil)).status).toBe(200)
      expect((await call(null, 'GET', '/api/public/booking/no-such-gym', undefined, evil)).status).toBe(404)
      // The member app already refused cross-site cookie writes; it still does.
      const m = await createMember(g)
      await setPasswordWithToken((await createInvite(g, m.id)).token, 'correct-horse-42')
      const login = await call(null, 'POST', '/api/member-auth/login', { email: m.email, password: 'correct-horse-42' })
      const session = (login.headers.get('set-cookie') || '').split(';')[0]
      expect(session).toMatch(/^member-session=/)
      expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/i)
      expect((await call(session, 'POST', '/api/member-auth/logout', {}, evil)).status).toBe(403)
      expect((await call(session, 'GET', '/api/portal/me')).status).toBe(200)
    })

    it('answers no cross-origin reads, and lets only the booking page be framed', async () => {
      const g = await gym()
      const owner = await ownerCookie(g)
      for (const path of ['/api/me', '/api/members', '/api/payroll/periods', '/api/v1/members', '/api/portal/me', '/api/public/booking/x']) {
        const r = await call(owner, 'GET', path, undefined, { Origin: 'https://evil.example' })
        expect(r.headers.get('access-control-allow-origin'), path).toBeNull()
        expect(r.headers.get('access-control-allow-credentials'), path).toBeNull()
        const pre = await call(null, 'OPTIONS', path, undefined, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' })
        expect(pre.headers.get('access-control-allow-origin'), `preflight ${path}`).toBeNull()
      }
      for (const path of ['/dashboard', '/login', '/member/login', '/sign/x', '/payroll', '/settings/developer', '/api/me', '/admin', '/sales/login', '/waiver/x', '/kiosk']) {
        const r = await call(null, 'GET', path)
        expect(r.headers.get('x-frame-options'), path).toBe('DENY')
        expect(r.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
        expect(r.headers.get('x-content-type-options'), path).toBe('nosniff')
      }
      // A path that only looks like the booking page is not frameable.
      for (const path of ['/booking', '/books', '/bookkeeping/x', '/x/book/y', '/api/book/x']) expect((await call(null, 'GET', path)).headers.get('content-security-policy') || "frame-ancestors 'none'", path).toContain("frame-ancestors 'none'")
      const book = await call(null, 'GET', '/book/some-gym')
      expect(book.headers.get('content-security-policy')).toContain('frame-ancestors *')
      expect(book.headers.get('x-powered-by')).toBeNull()
    })
  })

  describe('one gym against another', () => {
    /** Every dynamic API route, with the methods it exports. */
    function dynamicRoutes(dir = 'app/api', out: { path: string[]; methods: string[] }[] = []) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) dynamicRoutes(full, out)
        else if (name === 'route.ts' && full.includes('[')) out.push({ path: full.replace(/^app\//, '').replace('/route.ts', '').split('/'), methods: [...readFileSync(full, 'utf8').matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]) })
      }
      return out
    }

    it('cannot read, change or delete anything of another gym by putting its IDs in any route', async () => {
      // The victim owns one of nearly everything, made through the same services the app uses.
      const victim = await gym({ name: 'Victim Gym' })
      const plan = await createPlan(victim, { name: 'Victim Plan', priceCents: 9900 })
      const vMember = await createMember(victim, { name: 'Vera Victim', email: `vera-${randomUUID()}@victim.test` })
      const session = await createSession(victim, { capacity: 5 })
      const sale = await tx((db) => sellMembership(db, { ownerId: victim, memberId: vMember.id, planId: plan.id, paymentMethod: 'cash' }))
      const payment = await tx((db) => recordPayment(db, { ownerId: victim, invoiceId: sale.invoice!.id, method: 'cash' }))
      const staff = await prisma.staff.create({ data: { ownerId: victim, name: 'Victor Staff', email: `victor-${randomUUID()}@victim.test`, password: 'x', role: 'manager' } })
      const location = await prisma.location.create({ data: { ownerId: victim, name: 'Victim Location' } })
      const lead = await prisma.prospect.create({ data: { ownerId: victim, name: 'Victim Lead', email: `lead-${randomUUID()}@victim.test` } })
      const booking = await prisma.booking.create({ data: { ownerId: victim, memberId: vMember.id, sessionId: session.id, status: 'booked' } })
      const product = await prisma.product.create({ data: { ownerId: victim, name: 'Victim Product', priceCents: 500 } })
      const tag = await prisma.tag.create({ data: { ownerId: victim, name: 'Victim Tag' } })
      const period = await prisma.payrollPeriod.create({ data: { ownerId: victim, name: 'Victim Period', startDate: '2026-01-01', endDate: '2026-01-14', startsAt: new Date('2026-01-01T05:00:00Z'), endsAt: new Date('2026-01-15T05:00:00Z') } })
      const commission = await prisma.commissionPlan.create({ data: { ownerId: victim, name: 'Victim Commission' } })
      const template = await prisma.documentTemplate.create({ data: { ownerId: victim, name: 'Victim Waiver', type: 'waiver' } })
      const household = await prisma.household.create({ data: { ownerId: victim, name: 'Victim Household', payerMemberId: vMember.id } })
      const ids: [string, string][] = [['member', vMember.id], ['membership', sale.membership.id], ['invoice', sale.invoice!.id], ['transaction', payment.id], ['plan', plan.id], ['session', session.id], ['classType', session.classTypeId], ['staff', staff.id], ['location', location.id], ['lead', lead.id], ['booking', booking.id], ['product', product.id], ['tag', tag.id], ['period', period.id], ['commission', commission.id], ['template', template.id], ['household', household.id], ['owner', victim]]
      const models = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'ownerId') && m.fields.some((f) => f.name === 'id'))
      const key = (name: string) => name[0].toLowerCase() + name.slice(1)
      const snapshot = async () => {
        const out: Record<string, string> = {}
        for (const m of models) { const rows = await (prisma as any)[key(m.name)].findMany({ where: { ownerId: victim }, orderBy: { id: 'asc' } }); if (rows.length) out[m.name] = `${rows.length}:${createHash('sha1').update(JSON.stringify(rows)).digest('hex')}` }
        return out
      }
      const before = await snapshot()
      expect(Object.keys(before).length).toBeGreaterThan(15)

      const attacker = await ownerCookie(await gym({ name: 'Attacker Gym' }))
      const problems: string[] = []
      const skip = /^api\/(cron|webhooks|stripe|admin|sales|auth|member-auth|portal|public)\//
      // Read-only answers that say nothing: an empty history for a membership that is not theirs.
      const harmless = (method: string, url: string, text: string) => method === 'GET' && /\/plan-change$/.test(url) && text === '{"data":{"history":[]}}'
      let sent = 0
      for (const route of dynamicRoutes().filter((r) => !skip.test(r.path.join('/')))) {
        const positions = route.path.map((s, i) => (s.startsWith('[') && !s.startsWith('[...') ? i : -1)).filter((i) => i >= 0)
        for (const method of route.methods) for (const pos of positions) for (const [what, id] of ids) {
          const url = '/' + route.path.map((s, i) => (i === pos ? id : s.startsWith('[...') ? 'x' : s.startsWith('[') ? randomUUID() : s)).join('/')
          const r = await call(attacker, method, url, method === 'GET' || method === 'DELETE' ? undefined : {})
          sent++
          if (r.status >= 500) problems.push(`${r.status} ${method} ${url} (${what}): ${r.text.slice(0, 80)}`)
          else if (r.status < 300 && !harmless(method, url, r.text)) problems.push(`${r.status} ${method} ${url} (${what}): ${r.text.slice(0, 120)}`)
          if (/Vera Victim|Victim Plan|Victor Staff|Victim Lead|victim\.test|Victim Gym/.test(r.text)) problems.push(`LEAK ${method} ${url} (${what}): ${r.text.slice(0, 120)}`)
        }
      }
      // The same through the public API, with a key from the attacker's gym that holds every scope.
      const attackerGym = gyms[gyms.length - 1]
      const { key: apiKey } = await createApiKey(attackerGym, { name: 'Attacker key', description: null, scopes: SCOPE_KEYS, expiresInDays: null }, { type: 'owner', id: attackerGym, name: 'Owner', role: 'owner' })
      await prisma.apiKey.updateMany({ where: { ownerId: attackerGym }, data: { rateLimit: 5000 } })
      let viaKey = 0
      for (const route of dynamicRoutes().filter((r) => r.path[1] === 'v1' && !r.path.some((s) => s.startsWith('[...')))) {
        const positions = route.path.map((s, i) => (s.startsWith('[') ? i : -1)).filter((i) => i >= 0)
        for (const method of route.methods) for (const pos of positions) for (const [what, id] of ids) {
          const url = '/' + route.path.map((s, i) => (i === pos ? id : s.startsWith('[') ? (s === '[action]' ? 'cancel' : randomUUID()) : s)).join('/')
          const r = await call(`Bearer ${apiKey}`, method, url, method === 'GET' || method === 'DELETE' ? undefined : {}, { 'Idempotency-Key': randomUUID() })
          viaKey++
          if (r.status === 429) continue
          if (r.status >= 500 || r.status < 300) problems.push(`API key: ${r.status} ${method} ${url} (${what}): ${r.text.slice(0, 120)}`)
          if (/Vera Victim|Victim Plan|Victor Staff|Victim Lead|victim\.test|Victim Gym/.test(r.text)) problems.push(`API key LEAK ${method} ${url} (${what})`)
        }
      }
      expect(viaKey).toBeGreaterThan(100)
      // Lists through the key hold only the attacker's own (empty) gym.
      for (const list of ['/api/v1/members', '/api/v1/memberships', '/api/v1/invoices', '/api/v1/payments', '/api/v1/classes', '/api/v1/bookings', '/api/v1/leads']) {
        const r = await call(`Bearer ${apiKey}`, 'GET', list)
        if (r.status === 200) expect(r.json.data, list).toEqual([])
        else expect([403, 404, 429], `${list} → ${r.status}`).toContain(r.status)
      }
      expect(sent).toBeGreaterThan(3000)
      expect(problems).toEqual([])
      // Whatever the answers were, nothing of the victim's has changed, been added to or removed.
      expect(await snapshot()).toEqual(before)
    }, 900_000)

    it('cannot use another gym\'s things in its own requests, with every field filled in properly', async () => {
      const victim = await gym({ name: 'Victim Gym' })
      const vPlan = await createPlan(victim, { name: 'Victim Plan', priceCents: 9900 })
      const vMember = await createMember(victim, { name: 'Vera Victim' })
      const vSession = await createSession(victim, { capacity: 5 })
      const vSale = await tx((db) => sellMembership(db, { ownerId: victim, memberId: vMember.id, planId: vPlan.id, paymentMethod: 'cash' }))
      const vPayment = await tx((db) => recordPayment(db, { ownerId: victim, invoiceId: vSale.invoice!.id, method: 'cash', amountCents: 5000 }))
      const vStaff = await prisma.staff.create({ data: { ownerId: victim, name: 'Victor Staff', email: `victor-${randomUUID()}@victim.test`, password: 'x', role: 'coach', isCoach: true } })
      const vLocation = await prisma.location.create({ data: { ownerId: victim, name: 'Victim Location' } })
      const vProduct = await prisma.product.create({ data: { ownerId: victim, name: 'Victim Product', priceCents: 500, stock: 10 } })
      const vTag = await prisma.tag.create({ data: { ownerId: victim, name: 'Victim Tag' } })
      const vType = await prisma.appointmentType.create({ data: { ownerId: victim, name: 'Victim PT', durationMin: 60, paymentMode: 'included' } })
      const vPeriod = await prisma.payrollPeriod.create({ data: { ownerId: victim, name: 'Victim Period', startDate: '2026-01-01', endDate: '2026-01-14', startsAt: new Date('2026-01-01T05:00:00Z'), endsAt: new Date('2026-01-15T05:00:00Z') } })

      const g = await gym({ name: 'Attacker Gym' })
      const me = await ownerCookie(g)
      const myMember = await createMember(g)
      const myPlan = await createPlan(g)
      const mySession = await createSession(g, { capacity: 5 })
      const mySale = await tx((db) => sellMembership(db, { ownerId: g, memberId: myMember.id, planId: myPlan.id, paymentMethod: 'cash' }))
      const myLead = await prisma.prospect.create({ data: { ownerId: g, name: 'My Lead', email: `lead-${randomUUID()}@test.local` } })
      const myPeriod = await prisma.payrollPeriod.create({ data: { ownerId: g, name: 'Mine', startDate: '2026-01-01', endDate: '2026-01-14', startsAt: new Date('2026-01-01T05:00:00Z'), endsAt: new Date('2026-01-15T05:00:00Z') } })
      const key = () => `sec-${randomUUID()}`
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

      const attacks: [string, string, string, unknown][] = [
        ['refund their payment', 'POST', `/api/billing/transactions/${vPayment.id}/refund`, { amountCents: 100, refundReason: 'requested', idempotencyKey: key() }],
        ['refund their payment to credit', 'POST', `/api/billing/transactions/${vPayment.id}/refund`, { destination: 'credit', idempotencyKey: key() }],
        ['mark their invoice paid', 'POST', `/api/billing/invoices/${vSale.invoice!.id}/pay`, { method: 'cash', amountCents: 100 }],
        ['invoice their member', 'POST', '/api/billing/invoices', { memberId: vMember.id, items: [{ description: 'Planted', quantity: 1, unitPriceCents: 100 }] }],
        ['book their member into my class', 'POST', '/api/bookings', { memberId: vMember.id, sessionId: mySession.id }],
        ['book my member into their class', 'POST', '/api/bookings', { memberId: myMember.id, sessionId: vSession.id }],
        ['archive their members in bulk', 'POST', '/api/members/bulk', { action: 'archive', ids: [vMember.id] }],
        ['delete their members in bulk', 'POST', '/api/members/bulk', { action: 'delete', ids: [vMember.id] }],
        ['put my tag on their member', 'POST', '/api/members/bulk', { action: 'tag', ids: [vMember.id], tagId: vTag.id }],
        ['put their tag on my member', 'PUT', `/api/members/${myMember.id}/tags`, { tagIds: [vTag.id] }],
        ['assign their coach to my member', 'POST', '/api/members/bulk', { action: 'assign_coach', ids: [myMember.id], staffId: vStaff.id }],
        ['give their member credit', 'POST', `/api/members/${vMember.id}/credit`, { amountCents: 5000, idempotencyKey: key() }],
        ['make their member pay for my household', 'POST', '/api/households', { payerMemberId: vMember.id, memberIds: [myMember.id] }],
        ['put their member in my household', 'POST', '/api/households', { payerMemberId: myMember.id, memberIds: [vMember.id] }],
        ['sell their product', 'POST', '/api/pos/orders', { items: [{ productId: vProduct.id, quantity: 1 }], paymentMethod: 'cash' }],
        ['ring a sale to their member', 'POST', '/api/pos/orders', { items: [{ productId: vProduct.id, quantity: 1 }], memberId: vMember.id, paymentMethod: 'cash' }],
        ['sell their plan to my member', 'POST', `/api/members/${myMember.id}/memberships`, { planId: vPlan.id, paymentMethod: 'cash' }],
        ['sell my plan to their member', 'POST', `/api/members/${vMember.id}/memberships`, { planId: myPlan.id, paymentMethod: 'cash' }],
        ['credit my sale to their staff', 'POST', `/api/members/${myMember.id}/memberships`, { planId: myPlan.id, paymentMethod: 'cash', soldByStaffIds: [vStaff.id] }],
        ['credit my membership to their staff', 'PUT', `/api/memberships/${mySale.membership.id}/attribution`, { shares: [{ staffId: vStaff.id, sharePercent: 100 }] }],
        ['read who sold their membership', 'GET', `/api/memberships/${vSale.membership.id}/attribution`, undefined],
        ['change their membership to my plan', 'POST', `/api/memberships/${vSale.membership.id}/plan-change`, { planId: myPlan.id, effective: 'now', expected: { fromPlanId: vPlan.id, amountDueNowCents: 0, creditCents: 0 }, idempotencyKey: key() }],
        ['change my membership to their plan', 'POST', `/api/memberships/${mySale.membership.id}/plan-change`, { planId: vPlan.id, effective: 'now', expected: { fromPlanId: myPlan.id, amountDueNowCents: 0, creditCents: 0 }, idempotencyKey: key() }],
        ['put their coach on my class', 'POST', '/api/schedule/sessions', { classTypeId: mySession.classTypeId, coachId: vStaff.id, date: tomorrow, startTime: '09:00', durationMin: 60, capacity: 10, waitlistCapacity: 0 }],
        ['hold my class at their location', 'POST', '/api/schedule/sessions', { classTypeId: mySession.classTypeId, locationId: vLocation.id, date: tomorrow, startTime: '10:00', durationMin: 60, capacity: 10, waitlistCapacity: 0 }],
        ['schedule their class type', 'POST', '/api/schedule/sessions', { classTypeId: vSession.classTypeId, date: tomorrow, startTime: '11:00', durationMin: 60, capacity: 10, waitlistCapacity: 0 }],
        ['book their appointment type', 'POST', '/api/appointments', { typeId: vType.id, memberId: myMember.id, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), override: true }],
        ['book an appointment for their member', 'POST', '/api/appointments', { typeId: vType.id, memberId: vMember.id, staffId: vStaff.id, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), override: true }],
        ['convert my lead onto their plan', 'POST', `/api/leads/${myLead.id}/convert`, { planId: vPlan.id, paymentMethod: 'cash' }],
        ['adjust pay for their staff in my period', 'POST', `/api/payroll/periods/${myPeriod.id}/adjustments`, { staffId: vStaff.id, type: 'bonus', amountCents: 100, reason: 'Planted' }],
        ['adjust pay in their period', 'POST', `/api/payroll/periods/${vPeriod.id}/adjustments`, { staffId: vStaff.id, type: 'bonus', amountCents: 100, reason: 'Planted' }],
        ['finalize their pay period', 'POST', `/api/payroll/periods/${vPeriod.id}`, { action: 'submit' }],
        ['set pay for their staff', 'PUT', `/api/payroll/compensation/${vStaff.id}`, { basePay: 'hourly', hourlyRateCents: 1 }],
        ['reset their staff member\'s password', 'PATCH', `/api/staff/${vStaff.id}`, { password: 'planted-password-1' }],
        ['make their staff an admin', 'PATCH', `/api/staff/${vStaff.id}`, { role: 'admin' }],
        ['move their member here', 'PATCH', `/api/members/${vMember.id}`, { name: 'Renamed', email: 'taken@evil.example' }],
        ['invite their member to the member app', 'POST', `/api/members/${vMember.id}/invite`, {}],
        ['message their member', 'POST', `/api/members/${vMember.id}/messages`, { channel: 'email', subject: 'Hi', body: 'Planted message' }],
        ['send documents to their member', 'POST', `/api/members/${vMember.id}/documents`, {}],
      ]
      const rowsBefore = { members: await prisma.member.count({ where: { ownerId: g } }), bookings: await prisma.booking.count(), memberships: await prisma.membership.count({ where: { ownerId: g } }), sessions: await prisma.classSession.count({ where: { ownerId: g } }), households: await prisma.household.count({ where: { ownerId: g } }), orders: await prisma.order.count({ where: { ownerId: g } }) }
      for (const [what, method, path, body] of attacks) {
        const r = await call(me, method, path, body)
        // A bulk action answers 200 with a count; on someone else's members that count is nothing.
        if (r.status === 200 && r.text === '{"data":{"affected":0}}') continue
        expect([400, 403, 404, 405, 409, 422], `${what}: ${method} ${path} → ${r.status} ${r.text.slice(0, 160)}`).toContain(r.status)
        expect(r.status, `${what} was refused only for its shape, so the ownership check was never reached: ${r.text.slice(0, 200)}`).not.toBe(400)
        expect(r.text, what).not.toMatch(/Vera Victim|Victim Plan|Victor Staff|Victim Product/)
      }
      // Nothing of theirs moved, and nothing of mine now points at anything of theirs.
      expect(await prisma.member.findUniqueOrThrow({ where: { id: vMember.id } })).toMatchObject({ name: 'Vera Victim', ownerId: victim, archivedAt: null, householdId: null, assignedStaffId: null })
      expect(await prisma.transaction.findUniqueOrThrow({ where: { id: vPayment.id } })).toMatchObject({ refundedCents: 0 })
      expect(await prisma.invoice.findUniqueOrThrow({ where: { id: vSale.invoice!.id } })).toMatchObject({ amountPaidCents: 5000 })
      expect(await prisma.staff.findUniqueOrThrow({ where: { id: vStaff.id } })).toMatchObject({ role: 'coach', password: 'x' })
      expect(await prisma.product.findUniqueOrThrow({ where: { id: vProduct.id } })).toMatchObject({ stock: 10 })
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: vSale.membership.id } })).toMatchObject({ planId: vPlan.id })
      expect(await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: vPeriod.id } })).toMatchObject({ status: 'open' })
      for (const model of ['booking', 'accountCredit', 'memberTag', 'payrollEntry', 'staffCompensation', 'message', 'memberDocument', 'appointment', 'memberAccount'] as const) {
        const where = model === 'memberTag' ? { memberId: vMember.id } : model === 'memberAccount' ? { memberId: vMember.id } : { ownerId: victim }
        expect(await (prisma[model] as any).count({ where }), `their ${model}`).toBe(0)
      }
      expect({ members: await prisma.member.count({ where: { ownerId: g } }), bookings: await prisma.booking.count(), memberships: await prisma.membership.count({ where: { ownerId: g } }), sessions: await prisma.classSession.count({ where: { ownerId: g } }), households: await prisma.household.count({ where: { ownerId: g } }), orders: await prisma.order.count({ where: { ownerId: g } }) }).toEqual(rowsBefore)
      expect(await prisma.member.findUniqueOrThrow({ where: { id: myMember.id } })).toMatchObject({ assignedStaffId: null })
      expect(await prisma.memberTag.count({ where: { memberId: myMember.id } })).toBe(0)
      expect(await prisma.saleAttribution.count({ where: { staffId: vStaff.id } })).toBe(0)
      expect(await prisma.prospect.findUniqueOrThrow({ where: { id: myLead.id } })).toMatchObject({ convertedMemberId: null })
    })
  })

  describe('guessing', () => {
    it('stops password guessing for sales accounts and email guessing on the public waiver, wherever the requests come from', async () => {
      const rep = await prisma.salesRep.create({ data: { name: 'Rhea Rep', email: `rep-${randomUUID()}@test.local`, password: await bcrypt.hash('rep-password-1', 4), referralCode: `R${randomUUID().slice(0, 8).toUpperCase()}`, active: false } })
      try {
        const attempt = (email: string, password: string) => call(null, 'POST', '/api/sales/login', { email, password })
        // Found: a wrong password on a deactivated account said "deactivated", telling a guesser the account exists.
        const known = await attempt(rep.email, 'wrong-password'); const unknown = await attempt(`nobody-${randomUUID()}@test.local`, 'wrong-password')
        expect(known.status).toBe(401)
        expect(known.text).toBe(unknown.text)
        expect((await attempt(rep.email, 'rep-password-1')).status).toBe(403)
        // Found: only an in-memory limit per server instance stood in the way.
        for (let i = 0; i < MAX_FAILED_SIGN_INS - 1; i++) expect((await attempt(rep.email, `guess-${i}`)).status).toBe(401)
        expect((await attempt(rep.email, 'rep-password-1')).status).toBe(429)
      } finally {
        await prisma.salesRep.delete({ where: { id: rep.id } })
      }

      const g = await gym()
      await prisma.gymProfile.update({ where: { ownerId: g }, data: { waiverEnabled: true, waiverText: 'I agree.' } })
      const member = await createMember(g, { email: `real-${randomUUID()}@test.local` })
      const sign = (email: unknown, signature: unknown) => call(null, 'POST', `/api/waiver/${member.id}`, { email, signature })
      // Found: the body was not checked at all. Anything of any size was stored as the "signature".
      expect((await sign(member.email, 'x'.repeat(400_000))).status).toBe(400)
      expect((await sign(member.email, { $ne: null })).status).toBe(400)
      expect((await sign({ toLowerCase: 'x' }, 'sig')).status).toBe(400)
      expect((await call(null, 'POST', `/api/waiver/${member.id}`, 'not json')).status).toBe(400)
      for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) expect((await sign(`guess-${i}@test.local`, 'sig')).status).toBe(400)
      // Found: the member's email could be guessed without limit. Now even the right one waits out the window.
      expect((await sign(member.email, 'sig')).status).toBe(429)
      expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).waiverSignedAt).toBeNull()
      // The page never gives the address away.
      const page = await call(null, 'GET', `/api/waiver/${member.id}`)
      expect(page.status).toBe(200)
      expect(page.text).not.toContain(member.email)
    })
  })

  describe('inbox flooding', () => {
    it('sends at most a few account emails to one address in a quarter of an hour, and answers the same either way', async () => {
      const g = await gym()
      const member = await createMember(g, { email: `flood-${randomUUID()}@test.local` })
      await setPasswordWithToken((await createInvite(g, member.id)).token, 'correct-horse-42')
      const tokens: string[] = []
      for (let i = 0; i < 7; i++) {
        const r = await call(null, 'POST', '/api/member-auth/recover', { email: member.email })
        expect(r.status).toBe(200)
        expect(r.json.data).toEqual({ ok: true })
        tokens.push((await prisma.memberAuthToken.findFirst({ where: { memberId: member.id, type: 'reset', usedAt: null } }))?.tokenHash || '')
      }
      // Found: every request, from any address, sent another email and cancelled the link in the one before.
      // Three links are issued; after that the last one is left alone so the real person can still use it.
      expect(new Set(tokens.slice(0, 3)).size).toBe(3)
      expect(new Set(tokens.slice(2)).size).toBe(1)
      // An address nobody has: the same answer, and nothing to count against anyone.
      expect((await call(null, 'POST', '/api/member-auth/recover', { email: `nobody-${randomUUID()}@test.local` })).json.data).toEqual({ ok: true })
    })
  })

  describe('older routes', () => {
    it('keep a lapsed subscription and the shared demo account from changing anything', async () => {
      const g = await gym()
      await prisma.owner.update({ where: { id: g }, data: { subscriptionStatus: 'canceled', currentPeriodEnd: new Date(Date.now() - 40 * 86_400_000), trialEndsAt: new Date(Date.now() - 40 * 86_400_000) } })
      const me = await ownerCookie(g)
      const member = await createMember(g)
      const lead = await prisma.prospect.create({ data: { ownerId: g, name: 'Lapsed Lead', email: `lead-${randomUUID()}@test.local` } })
      // Found: these three skipped the check the rest of the app applies to every change.
      const form = new FormData(); form.append('file', new Blob(['name,email\nPlanted,planted@test.local\n'], { type: 'text/csv' }), 'members.csv')
      const imported = await fetch(`${BASE}/api/members/import`, { method: 'POST', headers: { Cookie: me, 'X-Forwarded-For': ip() }, body: form })
      expect([402, 403]).toContain(imported.status)
      expect([402, 403]).toContain((await call(me, 'POST', `/api/prospects/${lead.id}/convert`, {})).status)
      expect([402, 403]).toContain((await call(me, 'POST', `/api/members/${member.id}/send-qr`, {})).status)
      expect(await prisma.member.count({ where: { ownerId: g } })).toBe(1)
      expect((await prisma.prospect.findUniqueOrThrow({ where: { id: lead.id } })).status).not.toBe('converted')
    })


    it('answer "not found" for a record that is another gym\'s, not an error', async () => {
      const victim = await gym()
      const theirLead = await prisma.prospect.create({ data: { ownerId: victim, name: 'Their Lead', email: `lead-${randomUUID()}@test.local` } })
      const theirMember = await createMember(victim)
      const me = await ownerCookie(await gym())
      // Found: both of these answered 500. Nothing was changed, but a 500 is the wrong thing to say.
      expect((await call(me, 'DELETE', `/api/prospects/${theirLead.id}`)).status).toBe(404)
      expect((await call(me, 'DELETE', `/api/prospects/${randomUUID()}`)).status).toBe(404)
      expect((await call(me, 'PATCH', `/api/members/${theirMember.id}/billing`, { billingEnabled: true, monthlyFeeCents: 1 })).status).toBe(404)
      expect((await call(me, 'PATCH', `/api/members/${theirMember.id}/billing`, {})).status).toBe(404)
      expect(await prisma.prospect.count({ where: { id: theirLead.id } })).toBe(1)
      expect(await prisma.member.findUniqueOrThrow({ where: { id: theirMember.id } })).toMatchObject({ billingEnabled: false })
    })
  })

  describe('hostile content', () => {
    it('shows a gym\'s hostile name, tagline and policy on its public page as text, never as markup', async () => {
      const g = await gym()
      const xss = '</script><script>alert(document.domain)</script><img src=x onerror=alert(1)>'
      await prisma.gymProfile.update({ where: { ownerId: g }, data: { name: `Gym ${xss}` } })
      await getBookingSite(g)
      const slug = `xss-${randomUUID().slice(0, 10)}`
      // What the settings screen would refuse is put straight into the database here, as if it had got past it.
      await saveBookingSite(g, siteSchema.parse({ enabled: true, slug, displayName: null, tagline: 'Plain tagline', primaryColor: '#0f766e', buttonStyle: 'rounded', appearance: 'light', showLogo: true, locationIds: [], allClassTypes: true, classTypeIds: [], appointmentTypeIds: [], requireAccount: false, allowGuests: true, advanceDays: null, cancellationPolicy: null, contactEmail: null, contactPhone: null, termsUrl: null }))
      await prisma.bookingSite.update({ where: { ownerId: g }, data: { displayName: `Name ${xss}`, tagline: `Tagline ${xss}`, cancellationPolicy: `Policy ${xss}`, primaryColor: 'red;}</style><script>alert(2)</script>', termsUrl: 'javascript:alert(3)' } })
      const type = await prisma.classType.create({ data: { ownerId: g, name: `Class ${xss}` } })
      await createSession(g, { classTypeId: type.id, title: `Session ${xss}` })
      const page = await call(null, 'GET', `/book/${slug}`)
      expect(page.status).toBe(200)
      // The page contains the text (escaped). It never contains it as a live tag, in the HTML or in the data sent for hydration.
      expect(page.text).not.toContain('<script>alert(')
      expect(page.text).not.toContain('<img src=x onerror')
      expect(page.text).not.toMatch(/red;\}<\/style>/)
      expect(page.text).not.toMatch(/href="javascript:/i)
      expect(page.headers.get('content-type')).toContain('text/html')
      // The data itself is JSON, served as JSON, and cannot be sniffed into a page.
      for (const path of [`/api/public/booking/${slug}`, `/api/public/booking/${slug}/classes`]) {
        const api = await call(null, 'GET', path)
        expect(api.headers.get('content-type'), path).toContain('application/json')
        expect(api.headers.get('x-content-type-options'), path).toBe('nosniff')
      }
      // Hostile addresses are refused or shown as "not available", never echoed into the page as markup.
      for (const bad of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', 'x%22%3E%3Cscript%3Ealert(1)%3C/script%3E', '..%2F..%2Fapi%2Fme']) {
        const r = await call(null, 'GET', `/book/${bad}`)
        expect(r.text, bad).not.toContain('<script>alert(1)</script>')
        expect(r.text, bad).not.toContain('<img src=x onerror')
      }
      const error = await call(null, 'GET', `/login?error=${encodeURIComponent('<script>alert(1)</script>')}`)
      expect(error.text).not.toContain('<script>alert(1)</script>')
    })

    it('treats hostile text in members, notes and search as text, in and out', async () => {
      const g = await gym()
      const me = await ownerCookie(g)
      const sqli = `Robert'); DROP TABLE "Member";-- ' OR '1'='1`
      const created = await call(me, 'POST', '/api/members', { name: sqli, email: `bobby-${randomUUID()}@test.local` })
      expect(created.status, created.text).toBe(200)
      const id = created.json.data.id
      expect((await prisma.member.findUniqueOrThrow({ where: { id } })).name).toBe(sqli)
      for (const q of [`' OR '1'='1`, `%' OR 1=1 --`, `\\'; SELECT pg_sleep(5); --`, '%', '_', `${'a'.repeat(5000)}`, '\u0000', `{"$gt":""}`, `Robert'`]) {
        const started = Date.now()
        const r = await call(me, 'GET', `/api/members?search=${encodeURIComponent(q)}`)
        expect([200, 400], `search ${q.slice(0, 20)} → ${r.status}`).toContain(r.status)
        expect(Date.now() - started, 'no injected delay').toBeLessThan(4000)
        // Never anyone else's members, whatever the search says.
        if (r.status === 200) for (const m of r.json.data) expect(m.id).toBe(id)
      }
      for (const sort of [`name; DROP TABLE "Member"`, 'password', 'owner.password', '__proto__', 'constructor']) expect([200, 400]).toContain((await call(me, 'GET', `/api/members?sort=${encodeURIComponent(sort)}&order=${encodeURIComponent('asc; --')}`)).status)
      expect(await prisma.member.count({ where: { ownerId: g } })).toBe(1)
      // Fields the form does not offer cannot be set by sending them anyway.
      const other = await gym()
      const patched = await call(me, 'PATCH', `/api/members/${id}`, { name: 'Plain Name', ownerId: other, id: randomUUID(), qrCode: 'chosen-by-attacker', accessToken: 'chosen', createdAt: '2000-01-01T00:00:00Z', connectCustomerId: 'cus_attacker', householdId: randomUUID(), status: 'active', currentStreak: 9999 })
      expect([200, 400]).toContain(patched.status)
      const row = await prisma.member.findUniqueOrThrow({ where: { id } })
      expect(row).toMatchObject({ ownerId: g, id, connectCustomerId: null, householdId: null })
      expect(row.qrCode).not.toBe('chosen-by-attacker')
      expect(row.accessToken).not.toBe('chosen')
      expect(row.currentStreak).not.toBe(9999)
      // A staff member cannot give themselves a role, switch gym or become the owner by sending extra fields.
      const coach = await staffCookie(g, 'coach')
      const admin = await staffCookie(g, 'admin')
      expect((await call(coach.cookie, 'PATCH', `/api/staff/${coach.staff.id}`, { role: 'admin' })).status).toBe(403)
      expect((await call(admin.cookie, 'PATCH', `/api/staff/${admin.staff.id}`, { role: 'owner' })).status).toBe(400)
      expect((await call(admin.cookie, 'PATCH', `/api/staff/${coach.staff.id}`, { ownerId: other, name: 'Still Here' })).status).toBe(200)
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: coach.staff.id } })).ownerId).toBe(g)
      expect((await call(admin.cookie, 'POST', '/api/staff', { name: 'Second Owner', email: `o-${randomUUID()}@test.local`, password: 'long-enough-1', role: 'owner' })).status).toBe(400)
      // The owner's password is the owner's alone to change.
      for (const who of [coach.cookie, admin.cookie]) expect((await call(who, 'POST', '/api/settings/password', { currentPassword: 'x', newPassword: 'taken-over-1' })).status).toBe(403)
    })
  })
})
