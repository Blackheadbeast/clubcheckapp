// Production hardening: things that must fail safely whoever asks and however often.
// The HTTP half needs a running dev server (npm run dev) and is skipped without one.

import { randomUUID } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { cronAuthorized, sameSecret } from '@/lib/cron'
import { checkWebhookUrl, guardedLookup } from '@/lib/services/webhooks'
import { setStorageForTests, type FileStorage } from '@/lib/storage'
import { createTemplate, publishTemplate, assignDocument, signDocument, signSchema, signedPdf, templateCreateSchema } from '@/lib/services/documents'
import { createGym, createMember, destroyGym, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}
const ip = () => `198.20.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
const gyms: string[] = []
afterAll(async () => { for (const g of gyms) { await prisma.documentTemplate.deleteMany({ where: { ownerId: g } }); await destroyGym(g) } })

describe('hardening: secrets and scheduled jobs', () => {
  const request = (headers: Record<string, string>, url = 'http://x/api/cron/platform') => ({ headers: new Headers(headers), nextUrl: new URL(url) }) as never

  it('compares secrets safely and never treats a missing secret as a match', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    for (const [a, b] of [['abc', 'abd'], ['abc', 'abcd'], ['', ''], [null, null], [undefined, 'abc'], ['abc', undefined], ['', 'abc']] as const) expect(sameSecret(a, b), JSON.stringify([a, b])).toBe(false)
  })

  it('authorizes a scheduled job only by header, and only when a secret is configured', () => {
    const before = process.env.CRON_SECRET
    try {
      process.env.CRON_SECRET = 'cron-test-secret'
      expect(cronAuthorized(request({ authorization: 'Bearer cron-test-secret' }))).toBe(true)
      expect(cronAuthorized(request({ 'x-cron-secret': 'cron-test-secret' }))).toBe(true)
      expect(cronAuthorized(request({ authorization: 'Bearer wrong' }))).toBe(false)
      expect(cronAuthorized(request({}))).toBe(false)
      // A secret in the address would be written to access logs: it is not accepted there.
      expect(cronAuthorized(request({}, 'http://x/api/cron/platform?secret=cron-test-secret'))).toBe(false)
      delete process.env.CRON_SECRET
      expect(cronAuthorized(request({ authorization: 'Bearer ' }))).toBe(false)
      expect(cronAuthorized(request({ authorization: 'Bearer undefined' }))).toBe(false)
      expect(cronAuthorized(request({}))).toBe(false)
    } finally {
      process.env.CRON_SECRET = before
    }
  })
})

describe('hardening: outbound webhooks cannot be pointed at the server\'s own network', () => {
  const asProduction = async <T>(fn: () => T | Promise<T>) => {
    const env = process.env as Record<string, string | undefined>
    const before = env.NODE_ENV
    env.NODE_ENV = 'production'
    try { return await fn() } finally { env.NODE_ENV = before }
  }
  const resolve = (host: string) => new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((done) => guardedLookup(host, {}, (error, address) => done({ error, address })))

  it('refuses private and loopback addresses when a URL is registered', async () => {
    await asProduction(() => {
      for (const url of ['http://example.com/hook', 'https://localhost/hook', 'https://127.0.0.1/hook', 'https://10.0.0.5/hook', 'https://192.168.1.10/hook', 'https://172.16.0.1/hook', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/hook', 'https://[fd00::1]/hook', 'https://user:pass@example.com/hook', 'ftp://example.com/hook', 'not a url']) {
        expect(() => checkWebhookUrl(url), url).toThrow()
      }
      expect(checkWebhookUrl('https://example.com/hooks/clubcheck#frag')).toBe('https://example.com/hooks/clubcheck')
    })
  })

  it('checks the address at the moment of connecting, so a name that resolves inward is refused then too', async () => {
    // "localhost" stands in for a public-looking name whose DNS answer has been switched to an inside address.
    const blocked = await asProduction(() => resolve('localhost'))
    expect(blocked.error).toMatchObject({ message: 'The address resolves to a private network', code: 'EPRIVATE' })
    // Outside production the same lookup is allowed, which is what lets the test suite deliver to a local receiver.
    const local = await resolve('localhost')
    expect(local.error).toBeNull()
  })
})

describe('hardening: signed documents do not depend on a writable disk', () => {
  it('serves the signed PDF when storage can neither read nor write, by drawing it from the record', async () => {
    const g = await createGym(); gyms.push(g)
    const staff = { type: 'staff' as const, id: randomUUID(), name: 'Sam Staff' }
    const t = await createTemplate(g, templateCreateSchema.parse({ name: 'Waiver', title: 'Waiver', body: 'I, {{member.full_name}}, agree.' }), staff)
    await publishTemplate(g, t.id)
    const m = await createMember(g, { name: 'Rhea Readonly' })
    const d = (await tx((db) => assignDocument(db, { ownerId: g, templateId: t.id, memberId: m.id }))).document
    await signDocument({ document: d, actor: { type: 'member', id: m.id, name: m.name }, evidence: { ip: '203.0.113.1', userAgent: 'Vitest', via: 'Member app' }, ...signSchema.parse({ consent: true, read: true, signerName: 'Rhea Readonly', signature: { method: 'typed', text: 'Rhea Readonly' }, fields: {} }) })
    // A serverless host: the filesystem is read-only and nothing persists between requests.
    const broken: FileStorage = { name: 'read-only', put: async () => { throw new Error('EROFS: read-only file system') }, get: async () => { throw new Error('EROFS: read-only file system') }, delete: async () => { throw new Error('EROFS') } }
    setStorageForTests(broken)
    try {
      const signed = await prisma.memberDocument.findUniqueOrThrow({ where: { id: d.id } })
      const first = await signedPdf(signed, staff, { via: 'Staff' })
      const second = await signedPdf(signed, staff, { via: 'Staff' })
      expect(first.pdf.subarray(0, 8).toString()).toBe('%PDF-1.4')
      expect(first.pdf.equals(second.pdf)).toBe(true)
      expect((await prisma.memberDocument.findUniqueOrThrow({ where: { id: d.id } })).pdfKey).toBeNull()
    } finally {
      setStorageForTests(null)
    }
  })
})

/**
 * fetch, for a development server. `next dev` restarts itself when its memory grows, which the
 * sweeps below (every route, compiled on first use) reliably cause. A connection that is refused
 * or dropped is the server being away, not an answer from the app: wait for it and ask again.
 */
async function ask(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
    } catch (error) {
      if (attempt >= 5) throw error
      for (let waited = 0; waited < 90; waited++) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(5000) }).then(() => true, () => false)) break
      }
    }
  }
}

describe.skipIf(!up)('hardening over HTTP', () => {
  /** Every API route in the app, as a path with a made-up id in each dynamic segment. */
  function routes(dir = 'app/api', out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) routes(full, out)
      else if (name === 'route.ts') out.push('/' + dir.replace(/^app\//, '').split('/').map((s) => (s.startsWith('[...') ? 'x/y' : s.startsWith('[') ? (/(token|slug)/i.test(s) ? `nope-${randomUUID().slice(0, 12)}` : randomUUID()) : s)).join('/'))
    }
    return out
  }
  // Open by design: signing in, things a member or the public reaches by their own token or address, and health.
  const PUBLIC = [/^\/api\/auth\//, /^\/api\/member-auth\//, /^\/api\/sales\/(login|logout|demo\/launch)$/, /^\/api\/public\//, /^\/api\/member-portal\/manifest$/, /^\/api\/system-status$/, /^\/api\/waiver\//, /^\/api\/portal\/[^/]+\/unsubscribe/]
  const REFUSED = [400, 401, 403, 404, 405]

  it('gives a signed-out visitor nothing from any private route, and never an internal error from any route', async () => {
    const all = routes()
    expect(all.length).toBeGreaterThan(250)
    const problems: string[] = []
    for (const path of all) {
      const open = PUBLIC.some((p) => p.test(path))
      for (const method of ['GET', 'POST'] as const) {
        const res = await ask(BASE + path, { method, redirect: 'manual', headers: { 'X-Forwarded-For': ip(), ...(method === 'POST' && { 'Content-Type': 'application/json' }) }, body: method === 'POST' ? '{}' : undefined })
        const text = await res.text()
        if (res.status >= 500 && res.status !== 503) problems.push(`${method} ${path} → ${res.status}`)
        // 503 is only ever "this integration is not configured", said before any work is done.
        if (res.status === 503 && !/not configured/i.test(text)) problems.push(`${method} ${path} → 503 ${text.slice(0, 80)}`)
        if (!open && !REFUSED.includes(res.status) && res.status !== 503) problems.push(`${method} ${path} → ${res.status} (expected a refusal)`)
        if (/at .+\(.+:\d+:\d+\)|node_modules|prisma\.\w+\.\w+\(|PrismaClient|ECONNREFUSED|password_hash|\bstack\b"/i.test(text)) problems.push(`${method} ${path} leaks internals: ${text.slice(0, 120)}`)
      }
    }
    expect(problems).toEqual([])
  }, 600_000)

  it('answers every route for a signed-in owner and a signed-in coach of a brand-new gym without an internal error', async () => {
    const { createToken } = await import('@/lib/auth')
    const g = await createGym(); gyms.push(g)
    const coach = await prisma.staff.create({ data: { ownerId: g, name: 'New Coach', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach' } })
    const sessions = { owner: `auth-token=${await createToken({ ownerId: g, emailVerified: true })}`, coach: `auth-token=${await createToken({ ownerId: g, staffId: coach.id, role: 'coach' })}` }
    const problems: string[] = []
    // Not read here: jobs and receivers that do real work when called, and signing out.
    const skip = [/^\/api\/cron\//, /^\/api\/webhooks\//, /^\/api\/stripe\//, /logout/, /^\/api\/auth\/google/, /^\/api\/admin\/demo/]
    for (const path of routes().filter((r) => !skip.some((x) => x.test(r)))) {
      for (const [who, cookie] of Object.entries(sessions)) {
        const res = await ask(BASE + path, { redirect: 'manual', headers: { Cookie: cookie, 'X-Forwarded-For': ip() } })
        const text = await res.text()
        if (res.status >= 500 && !(res.status === 503 && /not configured/i.test(text))) problems.push(`${who} GET ${path} → ${res.status} ${text.slice(0, 100)}`)
        if (/at .+\(.+:\d+:\d+\)|node_modules|PrismaClient/i.test(text)) problems.push(`${who} GET ${path} leaks internals`)
      }
    }
    expect(problems).toEqual([])
  }, 600_000)

  it('refuses scheduled-job routes without the secret, including the secret in the address', async () => {
    for (const path of ['/api/cron/platform', '/api/cron/messages', '/api/cron/billing-reminders']) {
      for (const [headers, query] of [[{}, ''], [{ authorization: 'Bearer wrong' }, ''], [{ 'x-cron-secret': 'wrong' }, ''], [{}, `?secret=${process.env.CRON_SECRET || 'local-cron-secret'}`], [{}, '?secret=local-cron-secret']] as const) {
        const res = await ask(BASE + path + query, { headers: { ...headers, 'X-Forwarded-For': ip() } })
        expect(res.status, `${path}${query} ${JSON.stringify(headers)}`).toBe(401)
      }
    }
  })

  it('accepts a platform Stripe event only with a valid signature, and handles each event once', async () => {
    const url = `${BASE}/api/stripe/webhook`
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    const id = `evt_test_${randomUUID().replace(/-/g, '')}`
    // An event type the handler does nothing with: this is about the envelope, not any account.
    const payload = JSON.stringify({ id, object: 'event', type: 'customer.created', api_version: '2025-02-24.acacia', created: Math.floor(Date.now() / 1000), data: { object: { id: 'cus_test', object: 'customer' } } })
    expect((await ask(url, { method: 'POST', body: payload })).status).toBe(400)
    expect((await ask(url, { method: 'POST', body: payload, headers: { 'stripe-signature': 't=1,v1=deadbeef' } })).status).toBe(400)
    if (!secret) return
    const sign = (body: string, at = Math.floor(Date.now() / 1000)) => Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp: at })
    // Signed for a different body, and signed too long ago to be anything but a replay.
    expect((await ask(url, { method: 'POST', body: payload.replace('cus_test', 'cus_other'), headers: { 'stripe-signature': sign(payload) } })).status).toBe(400)
    expect((await ask(url, { method: 'POST', body: payload, headers: { 'stripe-signature': sign(payload, Math.floor(Date.now() / 1000) - 3600) } })).status).toBe(400)
    expect(await prisma.paymentEvent.count({ where: { id } })).toBe(0)
    // Delivered five times at once and once more afterwards: handled once.
    const sent = await Promise.all(Array.from({ length: 5 }, () => ask(url, { method: 'POST', body: payload, headers: { 'stripe-signature': sign(payload) } }).then(async (r) => ({ status: r.status, json: await r.json() }))))
    expect(sent.every((r) => r.status === 200)).toBe(true)
    expect(sent.filter((r) => !r.json.duplicate)).toHaveLength(1)
    const again = await ask(url, { method: 'POST', body: payload, headers: { 'stripe-signature': sign(payload) } })
    expect(await again.json()).toEqual({ received: true, duplicate: true })
    expect(await prisma.paymentEvent.findUnique({ where: { id } })).toMatchObject({ type: 'customer.created', account: 'platform' })
    await prisma.paymentEvent.delete({ where: { id } })
  })

  it('sends the security headers, lets only the booking page be framed, keeps sessions out of scripts\' reach, and stops password guessing', async () => {
    const page = await ask(`${BASE}/login`)
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('strict-transport-security')).toContain('max-age=31536000')
    expect(page.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    for (const path of ['/dashboard', '/payroll', '/member/login', '/sign/abc', '/api/system-status', '/bookkeeping', '/booking', '/books/x']) {
      const res = await ask(BASE + path, { redirect: 'manual' })
      expect(res.headers.get('x-frame-options'), path).toBe('DENY')
      expect(res.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
    }
    const book = await ask(`${BASE}/book/any-gym`)
    expect(book.headers.get('x-frame-options')).toBeNull()
    expect(book.headers.get('content-security-policy')).toContain('frame-ancestors *')
    // Signing in sets a cookie scripts cannot read and other sites cannot send on a form post.
    const login = await ask(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() }, body: JSON.stringify({ email: 'owner@ironharbor.test', password: 'clubcheck-demo' }) })
    const cookie = login.headers.get('set-cookie') || ''
    if (login.status === 200) {
      expect(cookie).toMatch(/auth-token=/)
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=lax|SameSite=strict/i)
    }
    // Wrong passwords say the same thing whether or not the account exists.
    const bcrypt = (await import('bcryptjs')).default
    const g = await createGym(); gyms.push(g)
    const email = `owner-${g}@test.local`
    await prisma.owner.update({ where: { id: g }, data: { password: await bcrypt.hash('right-password-1', 4), gymCode: `T${g.slice(0, 7).toUpperCase()}` } })
    const attempt = (address: string, password: string) => ask(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() }, body: JSON.stringify({ email: address, password }) }).then(async (r) => ({ status: r.status, body: await r.text() }))
    const stranger = `nobody-${randomUUID()}@test.local`
    const wrong = [await attempt(email, 'wrong-password'), await attempt(stranger, 'wrong-password')]
    expect(wrong[0].status).toBe(401)
    expect(wrong[1]).toEqual(wrong[0])
    // Guessing stops after ten wrong passwords for an address, from however many different places they come,
    // and for an address that does not exist just the same. The right password is then refused too, until the window passes.
    for (let i = 0; i < 9; i++) { expect((await attempt(email, `guess-${i}`)).status).toBe(401); await attempt(stranger, `guess-${i}`) }
    expect((await attempt(email, 'right-password-1')).status).toBe(429)
    expect((await attempt(stranger, 'anything')).status).toBe(429)
    // Staff: the same limit, and nothing said about an account until the password is right.
    const staff = await prisma.staff.create({ data: { ownerId: g, name: 'Gone Person', email: `gone-${randomUUID()}@test.local`, password: await bcrypt.hash('staff-password-1', 4), role: 'coach', active: false } })
    const staffAttempt = (address: string, password: string) => ask(`${BASE}/api/auth/staff-login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() }, body: JSON.stringify({ gymCode: g, email: address, password }) }).then(async (r) => ({ status: r.status, body: await r.text() }))
    const a = await staffAttempt(staff.email, 'wrong'); const b = await staffAttempt(`nobody-${randomUUID()}@test.local`, 'wrong')
    expect(a).toEqual(b)
    expect(a.body).not.toMatch(/deactivated/)
    expect((await staffAttempt(staff.email, 'staff-password-1')).body).toMatch(/deactivated/)
    for (let i = 0; i < 9; i++) await staffAttempt(staff.email, `guess-${i}`)
    expect((await staffAttempt(staff.email, 'staff-password-1')).status).toBe(429)
  })
})
