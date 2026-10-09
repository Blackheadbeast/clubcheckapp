// Member accounts: service rules, then the real HTTP surface (needs `npm run dev`).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import {
  MEMBER_COOKIE, accountStatus, changePassword, confirmEmail, createInvite, createReset, describeToken, loginMember, readMemberSessionToken,
  requestEmailChange, resolveMemberSession, revokeSessions, setPasswordWithToken, signMemberSession, startRecovery,
} from '@/lib/member-auth'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym } from './helpers'

const PASSWORD = 'correct-horse-42'
let gymA: string
let gymB: string

beforeAll(async () => { gymA = await createGym(); gymB = await createGym() })
afterAll(async () => { await destroyGym(gymA); await destroyGym(gymB) })

async function activated(ownerId: string, data: Record<string, unknown> = {}, password = PASSWORD) {
  const member = await createMember(ownerId, data)
  const { token } = await createInvite(ownerId, member.id)
  const result = await setPasswordWithToken(token, password)
  return { member, sessionToken: result.sessionToken }
}

describe('invitation and activation', () => {
  it('attaches an account to the existing member without creating another', async () => {
    const member = await createMember(gymA)
    const before = await prisma.member.count({ where: { ownerId: gymA } })
    expect((await accountStatus(gymA, member.id)).status).toBe('none')
    const { token } = await createInvite(gymA, member.id)
    expect((await accountStatus(gymA, member.id)).status).toBe('invited')
    expect(await describeToken(token)).toMatchObject({ type: 'invite', email: member.email, gymName: 'Test Gym' })

    const result = await setPasswordWithToken(token, PASSWORD)
    expect(result.activated).toBe(true)
    expect(await prisma.member.count({ where: { ownerId: gymA } })).toBe(before)
    const account = await prisma.memberAccount.findUniqueOrThrow({ where: { memberId: member.id } })
    expect(account.ownerId).toBe(gymA)
    // Opening the emailed link proves the address.
    expect(account.emailVerifiedAt).not.toBeNull()
    expect(account.passwordHash).not.toContain(PASSWORD)
    expect((await accountStatus(gymA, member.id)).status).toBe('active')
    expect((await resolveMemberSession(result.sessionToken))?.id).toBe(member.id)
  })

  it('stores only a hash of the link, and the link works once', async () => {
    const member = await createMember(gymA)
    const { token } = await createInvite(gymA, member.id)
    const rows = await prisma.memberAuthToken.findMany({ where: { memberId: member.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toBe(token)
    expect(JSON.stringify(rows)).not.toContain(token)
    await setPasswordWithToken(token, PASSWORD)
    await expect(setPasswordWithToken(token, 'another-pass-99')).rejects.toMatchObject({ code: 'invalid_token' })
    await expect(describeToken(token)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('lets only one of two simultaneous activations win', async () => {
    const member = await createMember(gymA)
    const { token } = await createInvite(gymA, member.id)
    const results = await Promise.allSettled([setPasswordWithToken(token, PASSWORD), setPasswordWithToken(token, 'second-choice-77')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.memberAccount.count({ where: { memberId: member.id } })).toBe(1)
  })

  it('rejects expired links, weak passwords, and a second invite for an active account', async () => {
    const member = await createMember(gymA)
    const { token } = await createInvite(gymA, member.id)
    await expect(setPasswordWithToken(token, 'short1')).rejects.toMatchObject({ code: 'weak_password' })
    await expect(setPasswordWithToken(token, 'nodigitsatallhere')).rejects.toMatchObject({ code: 'weak_password' })
    await prisma.memberAuthToken.updateMany({ where: { memberId: member.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(setPasswordWithToken(token, PASSWORD)).rejects.toMatchObject({ code: 'invalid_token' })
    expect((await accountStatus(gymA, member.id)).status).toBe('invite_expired')
    const fresh = await createInvite(gymA, member.id)
    await setPasswordWithToken(fresh.token, PASSWORD)
    await expect(createInvite(gymA, member.id)).rejects.toMatchObject({ code: 'already_active' })
  })

  it("cannot invite another gym's member", async () => {
    const member = await createMember(gymB)
    await expect(createInvite(gymA, member.id)).rejects.toMatchObject({ status: 404 })
    await expect(createReset(gymA, member.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('signing in', () => {
  it('accepts the right password, whatever the email casing, and rejects the wrong one the same way as an unknown email', async () => {
    const { member } = await activated(gymA)
    const ok = await loginMember(member.email.toUpperCase(), PASSWORD)
    expect(ok.status).toBe('ok')
    expect((await resolveMemberSession(ok.sessionToken))?.id).toBe(member.id)
    const wrong = await loginMember(member.email, 'not-the-password-1').catch((e) => e)
    const unknown = await loginMember('nobody-here@test.local', PASSWORD).catch((e) => e)
    expect(wrong).toMatchObject({ status: 401, code: 'invalid_credentials' })
    expect({ status: unknown.status, code: unknown.code, message: unknown.message }).toEqual({ status: wrong.status, code: wrong.code, message: wrong.message })
  })

  it('does not let a member without an account, or an archived member, sign in', async () => {
    const plain = await createMember(gymA)
    await expect(loginMember(plain.email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' })
    const { member, sessionToken } = await activated(gymA)
    await prisma.member.update({ where: { id: member.id }, data: { archivedAt: new Date() } })
    await expect(loginMember(member.email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' })
    // An existing session ends too.
    expect(await resolveMemberSession(sessionToken)).toBeNull()
  })

  it('locks the account after repeated wrong passwords', async () => {
    const { member } = await activated(gymA)
    for (let i = 0; i < 8; i++) await loginMember(member.email, `wrong-password-${i}`).catch(() => {})
    await expect(loginMember(member.email, PASSWORD)).rejects.toMatchObject({ status: 429, code: 'locked' })
    await prisma.memberAccount.update({ where: { memberId: member.id }, data: { lockedUntil: new Date(Date.now() - 1000) } })
    expect((await loginMember(member.email, PASSWORD)).status).toBe('ok')
  })

  it('asks which gym when the same email and password exist at two gyms, and opens only the chosen one', async () => {
    const email = `two-gyms-${Date.now()}@test.local`
    const a = await activated(gymA, { email })
    const b = await activated(gymB, { email })
    const result = await loginMember(email, PASSWORD)
    expect(result.status).toBe('choose_gym')
    expect(result.gyms?.map((g) => g.id).sort()).toEqual([gymA, gymB].sort())
    expect(result.sessionToken).toBeUndefined()
    const chosen = await loginMember(email, PASSWORD, gymB)
    const member = await resolveMemberSession(chosen.sessionToken)
    expect(member?.id).toBe(b.member.id)
    expect(member?.ownerId).toBe(gymB)
    expect(member?.id).not.toBe(a.member.id)
  })

  it('signs straight in when the passwords differ between gyms', async () => {
    const email = `two-pw-${Date.now()}@test.local`
    await activated(gymA, { email }, 'gym-a-password-1')
    const b = await activated(gymB, { email }, 'gym-b-password-2')
    const result = await loginMember(email, 'gym-b-password-2')
    expect(result.status).toBe('ok')
    expect((await resolveMemberSession(result.sessionToken))?.id).toBe(b.member.id)
  })
})

describe('sessions', () => {
  it('expires', async () => {
    const { member } = await activated(gymA)
    const expired = await signMemberSession({ memberId: member.id, ownerId: gymA, sessionVersion: 0 }, -1 / 24)
    expect(await readMemberSessionToken(expired)).toBeNull()
    expect(await resolveMemberSession(expired)).toBeNull()
  })

  it('ends everywhere on "sign out of all devices" and on a password change', async () => {
    const { member, sessionToken } = await activated(gymA)
    await revokeSessions(member.id)
    expect(await resolveMemberSession(sessionToken)).toBeNull()
    const again = await loginMember(member.email, PASSWORD)
    const fresh = await changePassword(member, PASSWORD, 'brand-new-pass-88')
    expect(await resolveMemberSession(again.sessionToken)).toBeNull()
    expect((await resolveMemberSession(fresh))?.id).toBe(member.id)
    await expect(loginMember(member.email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect((await loginMember(member.email, 'brand-new-pass-88')).status).toBe('ok')
    await expect(changePassword(member, 'not-my-password-1', 'whatever-else-22')).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('cannot be forged from a staff token, and a member token is not a staff token', async () => {
    const { member, sessionToken } = await activated(gymA)
    const staffToken = await createToken({ ownerId: gymA, emailVerified: true })
    expect(await readMemberSessionToken(staffToken)).toBeNull()
    expect(await resolveMemberSession(staffToken)).toBeNull()
    const { verifyToken } = await import('@/lib/auth')
    expect(await verifyToken(sessionToken)).toBeNull()
    // A session naming the right member but the wrong gym is refused.
    const crossed = await signMemberSession({ memberId: member.id, ownerId: gymB, sessionVersion: 0 })
    expect(await resolveMemberSession(crossed)).toBeNull()
  })
})

describe('password reset and recovery', () => {
  it('resets the password, signs out old sessions and spends the link', async () => {
    const { member, sessionToken } = await activated(gymA)
    const links = await startRecovery(member.email.toUpperCase())
    expect(links).toHaveLength(1)
    expect(links[0].type).toBe('reset')
    const result = await setPasswordWithToken(links[0].token, 'after-reset-pass-5')
    expect(result.activated).toBe(false)
    expect(await resolveMemberSession(sessionToken)).toBeNull()
    expect((await resolveMemberSession(result.sessionToken))?.id).toBe(member.id)
    await expect(loginMember(member.email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect((await loginMember(member.email, 'after-reset-pass-5')).status).toBe('ok')
    await expect(setPasswordWithToken(links[0].token, 'yet-another-pass-6')).rejects.toMatchObject({ code: 'invalid_token' })
    expect(await prisma.memberAccount.count({ where: { memberId: member.id } })).toBe(1)
  })

  it('rejects an expired reset link', async () => {
    const { member } = await activated(gymA)
    const [link] = await startRecovery(member.email)
    await prisma.memberAuthToken.updateMany({ where: { memberId: member.id, type: 'reset' }, data: { expiresAt: new Date(Date.now() - HOUR) } })
    await expect(setPasswordWithToken(link.token, 'after-reset-pass-5')).rejects.toMatchObject({ status: 410, code: 'invalid_token' })
    expect((await loginMember(member.email, PASSWORD)).status).toBe('ok')
  })

  it('sends an activation link to a member with no account, and nothing for a stranger', async () => {
    const member = await createMember(gymA)
    const links = await startRecovery(member.email)
    expect(links.map((l) => l.type)).toEqual(['invite'])
    expect(await startRecovery('stranger@test.local')).toEqual([])
    const archived = await createMember(gymA, { archivedAt: new Date() })
    expect(await startRecovery(archived.email)).toEqual([])
  })
})

describe('changing email', () => {
  it('only switches after the new address is confirmed, and never onto someone else', async () => {
    const { member } = await activated(gymA)
    const taken = await createMember(gymA)
    await expect(requestEmailChange(member, taken.email)).rejects.toMatchObject({ code: 'duplicate_email' })
    const next = `moved-${Date.now()}@test.local`
    const token = await requestEmailChange(member, next)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).email).toBe(member.email)
    expect((await loginMember(member.email, PASSWORD)).status).toBe('ok')
    await confirmEmail(token)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).email).toBe(next)
    expect((await loginMember(next, PASSWORD)).status).toBe('ok')
    await expect(loginMember(member.email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(confirmEmail(token)).rejects.toMatchObject({ code: 'invalid_token' })
  })
})

// ---------------------------------------------------------------------------
// Over real HTTP
// ---------------------------------------------------------------------------

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

async function call(cookie: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(cookie && { Cookie: cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text, setCookie: res.headers.get('set-cookie') || '', location: res.headers.get('location') }
}
const cookieFrom = (setCookie: string) => (setCookie.match(new RegExp(`${MEMBER_COOKIE}=[^;]+`)) || [''])[0]

describe.skipIf(!up)('member accounts over HTTP', () => {
  let me: Awaited<ReturnType<typeof createMember>>
  let cookie: string
  let neighbour: Awaited<ReturnType<typeof createMember>>
  let outsider: Awaited<ReturnType<typeof createMember>>
  let outsiderCookie: string
  const staff: Record<string, string> = {}

  beforeAll(async () => {
    me = (await activated(gymA)).member
    neighbour = await createMember(gymA)
    const other = await activated(gymB)
    outsider = other.member
    outsiderCookie = `${MEMBER_COOKIE}=${other.sessionToken}`
    staff.owner = `auth-token=${await createToken({ ownerId: gymA, emailVerified: true })}`
    const coach = await prisma.staff.create({ data: { ownerId: gymA, name: 'Coach', email: `coach-${Date.now()}@test.local`, password: 'x', role: 'coach' } })
    staff.coach = `auth-token=${await createToken({ ownerId: gymA, staffId: coach.id, role: 'coach' })}`
    const login = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: PASSWORD })
    expect(login.status).toBe(200)
    cookie = cookieFrom(login.setCookie)
  })

  describe('authentication', () => {
    it('sets a hardened session cookie on login and never returns the token in the body', async () => {
      const login = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: PASSWORD })
      expect(login.data).toEqual({ status: 'ok' })
      expect(login.setCookie).toMatch(/member-session=/)
      expect(login.setCookie.toLowerCase()).toContain('httponly')
      expect(login.setCookie.toLowerCase()).toContain('samesite=lax')
      expect(login.text).not.toContain(cookieFrom(login.setCookie).split('=')[1])
      expect((await call(cookieFrom(login.setCookie), 'GET', '/api/member-auth/session')).data).toMatchObject({ authenticated: true, email: me.email })
    })

    it('rejects a wrong password and an unknown email identically', async () => {
      const wrong = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: 'definitely-wrong-1' })
      const unknown = await call(null, 'POST', '/api/member-auth/login', { email: 'ghost@test.local', password: PASSWORD })
      expect(wrong.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(unknown.json).toEqual(wrong.json)
      expect(wrong.setCookie).not.toContain('member-session=ey')
    })

    it('logs out, and the portal then refuses the request', async () => {
      const login = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: PASSWORD })
      const session = cookieFrom(login.setCookie)
      expect((await call(session, 'GET', '/api/portal/me')).status).toBe(200)
      const out = await call(session, 'POST', '/api/member-auth/logout', { everywhere: true })
      expect(out.status).toBe(200)
      expect(out.setCookie).toMatch(/member-session=;/)
      // "Everywhere" kills the token itself, not just this browser's copy.
      expect((await call(session, 'GET', '/api/portal/me')).status).toBe(401)
      expect((await call(null, 'GET', '/api/portal/me')).status).toBe(401)
      expect((await call(null, 'GET', '/api/member-auth/session')).data).toEqual({ authenticated: false })
      const fresh = await call(null, 'POST', '/api/member-auth/login', { email: me.email, password: PASSWORD })
      cookie = cookieFrom(fresh.setCookie)
    })

    it('refuses an expired session', async () => {
      const account = await prisma.memberAccount.findUniqueOrThrow({ where: { memberId: me.id } })
      const expired = await signMemberSession({ memberId: me.id, ownerId: gymA, sessionVersion: account.sessionVersion }, -1)
      expect((await call(`${MEMBER_COOKIE}=${expired}`, 'GET', '/api/portal/me')).status).toBe(401)
    })

    it('answers the recovery form the same whether or not the email is a member', async () => {
      const known = await call(null, 'POST', '/api/member-auth/recover', { email: me.email })
      const unknown = await call(null, 'POST', '/api/member-auth/recover', { email: 'ghost@test.local' })
      expect(known.status).toBe(200)
      expect(unknown.json).toEqual(known.json)
      expect(known.text).not.toMatch(/token/i)
    })

    it('completes invitation → set password → signed in, through the API', async () => {
      const invited = await createMember(gymA)
      const sent = await call(staff.owner, 'POST', `/api/members/${invited.id}/invite`)
      expect(sent.status).toBe(200)
      expect(sent.data).toMatchObject({ kind: 'invite', email: invited.email })
      expect(sent.data.account.status).toBe('invited')
      // The link itself is never returned to the staff browser.
      expect(sent.text).not.toMatch(/token/i)
      expect((await call(staff.coach, 'POST', `/api/members/${invited.id}/invite`)).status).toBe(403)
      const { token } = await createInvite(gymA, invited.id)
      expect((await call(null, 'GET', `/api/member-auth/token/${token}`)).data).toMatchObject({ type: 'invite', email: invited.email })
      const weak = await call(null, 'POST', '/api/member-auth/set-password', { token, password: 'short' })
      expect(weak.status).toBe(400)
      const done = await call(null, 'POST', '/api/member-auth/set-password', { token, password: PASSWORD })
      expect(done.status).toBe(200)
      const session = cookieFrom(done.setCookie)
      expect((await call(session, 'GET', '/api/portal/me')).data.member.email).toBe(invited.email)
      expect((await call(null, 'POST', '/api/member-auth/set-password', { token, password: PASSWORD })).status).toBe(410)
      expect((await call(null, 'GET', `/api/member-auth/token/${token}`)).status).toBe(410)
      expect((await call(staff.owner, 'GET', `/api/members/${invited.id}/invite`)).data.status).toBe('active')
      const reset = await call(staff.owner, 'POST', `/api/members/${invited.id}/invite`)
      expect(reset.data.kind).toBe('reset')
    })
  })

  describe('authorization', () => {
    it('shows a member their own account and nothing that identifies another', async () => {
      const mine = await call(cookie, 'GET', '/api/portal/me')
      expect(mine.status).toBe(200)
      expect(mine.data.member.email).toBe(me.email)
      expect(mine.data.account).toMatchObject({ signedIn: true, emailVerified: true })
      expect(mine.text).not.toContain(neighbour.email)
      expect(mine.text).not.toContain(outsider.email)
      expect(mine.text).not.toMatch(/passwordHash|accessToken|connectCustomerId/)
    })

    it('ignores any member id the browser sends: there is no route that takes one', async () => {
      for (const id of [neighbour.id, outsider.id]) {
        // Staff routes do not accept a member session at all.
        expect((await call(cookie, 'GET', `/api/members/${id}`)).status).toBe(401)
        expect((await call(cookie, 'GET', `/api/members/${id}/invoices`)).status).toBe(401)
        expect((await call(cookie, 'GET', `/api/members/${id}/payment-methods`)).status).toBe(401)
        // And the portal has no such address: the id is treated as a (wrong) link token.
        expect((await call(cookie, 'GET', `/api/portal/${id}`)).status).toBe(404)
      }
      const profile = await call(cookie, 'PATCH', '/api/portal/me', { phone: '555-0100', memberId: neighbour.id, id: neighbour.id, ownerId: gymB })
      expect(profile.status).toBe(200)
      expect((await prisma.member.findUniqueOrThrow({ where: { id: me.id } })).phone).toBe('555-0100')
      expect((await prisma.member.findUniqueOrThrow({ where: { id: neighbour.id } })).phone).toBeNull()
    })

    it('keeps members out of every staff area, even with the cookie in the staff slot', async () => {
      const value = cookie.split('=')[1]
      for (const path of ['/api/members', '/api/dashboard', '/api/billing/transactions', '/api/staff', '/api/reports/financial', '/api/settings', '/api/me', '/api/billing/connect']) {
        expect((await call(cookie, 'GET', path)).status, path).toBe(401)
        expect((await call(`auth-token=${value}`, 'GET', path)).status, `${path} (as auth-token)`).toBe(401)
      }
      const page = await call(`auth-token=${value}`, 'GET', '/dashboard')
      expect(page.status).toBe(307)
      expect(page.location).toContain('/login')
    })

    it('does not accept a staff session as a member session', async () => {
      expect((await call(staff.owner, 'GET', '/api/portal/me')).status).toBe(401)
      expect((await call(`${MEMBER_COOKIE}=${staff.owner.split('=')[1]}`, 'GET', '/api/portal/me')).status).toBe(401)
    })

    it("cannot reach another gym's data", async () => {
      const theirs = await call(outsiderCookie, 'GET', '/api/portal/me')
      expect(theirs.data.member.email).toBe(outsider.email)
      expect(theirs.data.gym.name).toBe('Test Gym')
      expect(theirs.text).not.toContain(me.email)
      // Gym A's class cannot be booked from a Gym B session.
      const plan = await createPlan(gymB)
      await prisma.membership.create({ data: { ownerId: gymB, memberId: outsider.id, planId: plan.id, priceCents: 0, status: 'active' } })
      const session = await createSession(gymA, { capacity: 5 })
      const attempt = await call(outsiderCookie, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      expect(attempt.status).toBeGreaterThanOrEqual(400)
      expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(0)
      const schedule = await call(outsiderCookie, 'GET', '/api/portal/me/schedule')
      expect(schedule.text).not.toContain(session.id)
      // Nor can Gym A's invoice be paid or seen.
      const invoice = await prisma.invoice.create({ data: { ownerId: gymA, memberId: me.id, number: `INV-X-${Date.now()}`, totalCents: 5000, subtotalCents: 5000 } })
      expect((await call(outsiderCookie, 'POST', `/api/portal/me/invoices/${invoice.id}/pay`, {})).status).toBe(404)
      expect(theirs.text).not.toContain(invoice.id)
    })

    it('rejects writes that come from another website', async () => {
      const forged = await call(cookie, 'PATCH', '/api/portal/me', { phone: '555-0666' }, { Origin: 'https://evil.example' })
      expect(forged.status).toBe(403)
      expect((await prisma.member.findUniqueOrThrow({ where: { id: me.id } })).phone).not.toBe('555-0666')
      expect((await call(cookie, 'POST', '/api/member-auth/logout', {}, { Origin: 'https://evil.example' })).status).toBe(403)
    })

    it('stops the emailed link opening an account once it has a password', async () => {
      const token = 'd'.repeat(64)
      const linked = await createMember(gymA, { accessToken: token, accessTokenExpiry: new Date(Date.now() + DAY) })
      expect((await call(null, 'GET', `/api/portal/${token}`)).status).toBe(200)
      const invite = await createInvite(gymA, linked.id)
      await setPasswordWithToken(invite.token, PASSWORD)
      const after = await call(null, 'GET', `/api/portal/${token}`)
      expect(after.status).toBe(401)
      expect(after.json.code).toBe('account_required')
    })

    it('sends signed-out visitors to the member sign-in page', async () => {
      const page = await call(null, 'GET', '/member/me')
      expect(page.status).toBe(307)
      expect(page.location).toContain('/member/login')
      expect((await call(null, 'GET', '/member/login')).status).toBe(200)
    })
  })

  describe('billing', () => {
    it('shows only their own invoices and payment methods, and can manage the methods', async () => {
      const mine = await prisma.invoice.create({ data: { ownerId: gymA, memberId: me.id, number: `INV-M-${Date.now()}`, totalCents: 4200, subtotalCents: 4200 } })
      const notMine = await prisma.invoice.create({ data: { ownerId: gymA, memberId: neighbour.id, number: `INV-N-${Date.now()}`, totalCents: 9900, subtotalCents: 9900 } })
      const card = await prisma.paymentMethod.create({ data: { ownerId: gymA, memberId: me.id, providerId: `pm_me_${Date.now()}`, type: 'card', brand: 'visa', last4: '4242', isDefault: true } })
      const second = await prisma.paymentMethod.create({ data: { ownerId: gymA, memberId: me.id, providerId: `pm_me2_${Date.now()}`, type: 'card', brand: 'mastercard', last4: '4444' } })
      const theirCard = await prisma.paymentMethod.create({ data: { ownerId: gymA, memberId: neighbour.id, providerId: `pm_nb_${Date.now()}`, type: 'card', brand: 'amex', last4: '0005', isDefault: true } })

      const portal = await call(cookie, 'GET', '/api/portal/me')
      const numbers = portal.data.billing.invoices.map((i: any) => i.number)
      expect(numbers).toContain(mine.number)
      expect(numbers).not.toContain(notMine.number)
      const methods = await call(cookie, 'GET', '/api/portal/me/payment-methods')
      expect(methods.data.methods.map((m: any) => m.last4).sort()).toEqual(['4242', '4444'])
      expect(methods.text).not.toContain('0005')
      expect(methods.text).not.toContain(card.providerId)

      const makeDefault = await call(cookie, 'PATCH', `/api/portal/me/payment-methods/${second.id}`)
      expect(makeDefault.status).toBe(200)
      expect((await prisma.paymentMethod.findUniqueOrThrow({ where: { id: second.id } })).isDefault).toBe(true)
      expect((await prisma.paymentMethod.findUniqueOrThrow({ where: { id: card.id } })).isDefault).toBe(false)
      // Someone else's card cannot be made default, removed, or used to pay.
      expect((await call(cookie, 'PATCH', `/api/portal/me/payment-methods/${theirCard.id}`)).status).toBe(404)
      expect((await call(cookie, 'DELETE', `/api/portal/me/payment-methods/${theirCard.id}`)).status).toBe(404)
      expect(await prisma.paymentMethod.count({ where: { id: theirCard.id } })).toBe(1)
      expect((await call(cookie, 'POST', `/api/portal/me/invoices/${notMine.id}/pay`, {})).status).toBe(404)
      const removed = await call(cookie, 'DELETE', `/api/portal/me/payment-methods/${card.id}`)
      expect(removed.status).toBe(200)
      expect(await prisma.paymentMethod.count({ where: { id: card.id } })).toBe(0)
    })

    it('lets a member pay their own invoice; without a connected processor it says to pay at the desk', async () => {
      const invoice = await prisma.invoice.create({ data: { ownerId: gymA, memberId: me.id, number: `INV-P-${Date.now()}`, totalCents: 3000, subtotalCents: 3000 } })
      const pay = await call(cookie, 'POST', `/api/portal/me/invoices/${invoice.id}/pay`, {})
      // This test gym has not connected Stripe. The charge itself is covered by scripts/stripe-testmode.ts.
      expect(pay.status).toBe(409)
      expect(pay.json.code).toBe('payments_not_connected')
      expect((await call(null, 'POST', `/api/portal/me/invoices/${invoice.id}/pay`, {})).status).toBe(401)
    })
  })

  describe('bookings', () => {
    it('books, joins the waitlist when full, cancels, and cannot book without a membership', async () => {
      const plan = await createPlan(gymA, { name: 'Member Plan' })
      const session = await createSession(gymA, { capacity: 1 })
      const noPlan = await call(cookie, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      expect(noPlan.status).toBeGreaterThanOrEqual(400)
      expect(await prisma.booking.count({ where: { sessionId: session.id } })).toBe(0)

      expect((await call(staff.owner, 'POST', `/api/members/${me.id}/memberships`, { planId: plan.id, paymentMethod: 'cash' })).status).toBe(200)
      const schedule = await call(cookie, 'GET', '/api/portal/me/schedule')
      expect(schedule.status).toBe(200)
      expect(schedule.text).toContain(session.id)

      // Someone else takes the only spot first.
      await call(staff.owner, 'POST', `/api/members/${neighbour.id}/memberships`, { planId: plan.id, paymentMethod: 'cash' })
      expect((await call(staff.owner, 'POST', '/api/bookings', { sessionId: session.id, memberId: neighbour.id })).status).toBe(200)
      // A full class is refused with the waitlist on offer; joining it is the member's explicit choice.
      const full = await call(cookie, 'POST', '/api/portal/me/bookings', { sessionId: session.id })
      expect(full.status).toBe(422)
      expect(full.json).toMatchObject({ code: 'class_full', details: { waitlistAvailable: true } })
      const waitlisted = await call(cookie, 'POST', '/api/portal/me/bookings', { sessionId: session.id, joinWaitlist: true })
      expect(waitlisted.status).toBe(200)
      expect(waitlisted.data).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
      const mine = await prisma.booking.findFirstOrThrow({ where: { sessionId: session.id, memberId: me.id } })
      expect(mine.status).toBe('waitlisted')

      const roomy = await createSession(gymA, { capacity: 5 })
      const booked = await call(cookie, 'POST', '/api/portal/me/bookings', { sessionId: roomy.id, memberId: neighbour.id })
      expect(booked.status).toBe(200)
      // The booking is for the signed-in member, whatever id the request carried.
      const row = await prisma.booking.findFirstOrThrow({ where: { sessionId: roomy.id } })
      expect(row.memberId).toBe(me.id)
      expect(row.status).toBe('booked')
      const portal = await call(cookie, 'GET', '/api/portal/me')
      expect(portal.data.upcoming.map((u: any) => u.sessionId)).toEqual(expect.arrayContaining([session.id, roomy.id]))

      const theirs = await prisma.booking.findFirstOrThrow({ where: { sessionId: session.id, memberId: neighbour.id } })
      expect((await call(cookie, 'POST', `/api/portal/me/bookings/${theirs.id}`, { action: 'cancel' })).status).toBe(404)
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('booked')
      const cancelled = await call(cookie, 'POST', `/api/portal/me/bookings/${row.id}`, { action: 'cancel' })
      expect(cancelled.status).toBe(200)
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: row.id } })).status).toMatch(/cancel/)
      const calendar = await fetch(`${BASE}/api/portal/me/bookings/${mine.id}/calendar`, { headers: { Cookie: cookie } })
      expect([200, 404]).toContain(calendar.status)
    })
  })
})
