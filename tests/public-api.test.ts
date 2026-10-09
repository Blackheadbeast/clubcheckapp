// The public API (/api/v1), API keys, and outbound webhooks, over real HTTP against a running dev
// server (npm run dev) with a local webhook receiver. Skipped when nothing is listening.

import { createServer, type Server } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { createApiKey, hashKey, looksLikeKey } from '@/lib/public-api/keys'
import { SCOPE_KEYS } from '@/lib/public-api/scopes'
import { EVENT_TYPES, MAX_ATTEMPTS, RETRY_AFTER_SEC, checkWebhookUrl, deliverDue, signPayload } from '@/lib/services/webhooks'
import { sellMembership } from '@/lib/services/memberships'
import { recordPayment } from '@/lib/services/payments'
import { ensureSystemExercises } from '@/lib/services/exercises'
import { createWorkout, workoutSchema } from '@/lib/services/workouts'
import { createProgram, programSchema } from '@/lib/services/programs'
import { weekday } from '@/lib/workouts/schedule'
import { createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const TZ = 'America/New_York'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

type Res = { status: number; json: any; data: any; error: any; text: string; headers: Headers }
async function call(auth: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, error: json?.error, text, headers: res.headers }
}
const until = async <T>(fn: () => T | Promise<T>, ms = 10_000): Promise<NonNullable<T>> => {
  const end = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value) return value as NonNullable<T>
    if (Date.now() > end) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 100))
  }
}

// A stand-in for a gym's other software: records what it is sent and answers as told.
interface Hit { path: string; headers: Record<string, string>; body: string }
const hits: Hit[] = []
const answer: Record<string, number> = {}
let receiver: Server
let hook = ''
const got = (path: string, type?: string) => hits.filter((h) => h.path === path && (!type || h.headers['clubcheck-event-type'] === type))

describe.skipIf(!up)('public API', () => {
  let gymA: string
  let gymB: string
  let ownerA: string
  let ownerB: string
  const staff: Record<string, string> = {}
  let keyA: string // every scope, gym A
  let keyB: string // every scope, gym B
  let keyAId: string
  const today = zonedParts(new Date(), TZ).date
  const at = (days: number, time: string) => zonedToUtc(addDaysToDate(today, days), time, TZ).toISOString()

  async function makeKey(owner: string, scopes: string[], extra: Record<string, unknown> = {}) {
    const r = await call(owner, 'POST', '/api/developer/keys', { name: `Key ${randomUUID().slice(0, 6)}`, scopes, ...extra })
    expect(r.status, r.text).toBe(200)
    // Tests make far more calls a minute than the default allows one key.
    await prisma.apiKey.update({ where: { id: r.data.id }, data: { rateLimit: 5000 } })
    return { id: r.data.id as string, bearer: `Bearer ${r.data.key}`, raw: r.data.key as string, view: r.data }
  }
  const v1 = (key: string | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => call(key, method, `/api/v1${path}`, body, headers)

  beforeAll(async () => {
    gymA = await createGym({ timezone: TZ })
    gymB = await createGym({ timezone: TZ })
    ownerA = `auth-token=${await createToken({ ownerId: gymA, emailVerified: true })}`
    ownerB = `auth-token=${await createToken({ ownerId: gymB, emailVerified: true })}`
    for (const role of ['manager', 'front_desk', 'coach', 'sales', 'accountant'] as const) {
      const row = await prisma.staff.create({ data: { ownerId: gymA, name: `Test ${role}`, email: `${role}-${randomUUID()}@test.local`, password: 'x', role } })
      staff[role] = `auth-token=${await createToken({ ownerId: gymA, staffId: row.id, role })}`
    }
    const a = await makeKey(ownerA, SCOPE_KEYS)
    keyA = a.bearer; keyAId = a.id
    keyB = (await makeKey(ownerB, SCOPE_KEYS)).bearer

    receiver = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const path = req.url || '/'
        hits.push({ path, headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])), body: Buffer.concat(chunks).toString('utf8') })
        res.statusCode = answer[path] || 200
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve))
    hook = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => receiver?.close(resolve))
    for (const ownerId of [gymA, gymB]) {
      await prisma.webhookEvent.deleteMany({ where: { ownerId } })
      await prisma.webhookEndpoint.deleteMany({ where: { ownerId } })
      await prisma.apiRequestLog.deleteMany({ where: { ownerId } })
      await prisma.apiKey.deleteMany({ where: { ownerId } })
      await prisma.idempotencyKey.deleteMany({ where: { ownerId } })
      await prisma.personalRecord.deleteMany({ where: { ownerId } })
      await prisma.workoutSession.deleteMany({ where: { ownerId } })
      await prisma.programAssignment.deleteMany({ where: { ownerId } })
      await prisma.program.deleteMany({ where: { ownerId } })
      await prisma.workout.deleteMany({ where: { ownerId } })
      await destroyGym(ownerId)
    }
  })

  // -------------------------------------------------------------------------
  describe('API keys', () => {
    it('shows a key once, stores only its hash, and never returns it again', async () => {
      const made = await makeKey(ownerA, ['members:read'], { description: 'CRM sync', expiresInDays: 30 })
      expect(looksLikeKey(made.raw)).toBe(true)
      expect(made.view.prefix).toBe(made.raw.slice(0, 16))
      expect(made.view.scopes).toEqual(['members:read'])
      expect(new Date(made.view.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: made.id } })
      expect(row.keyHash).toBe(hashKey(made.raw))
      expect(JSON.stringify(row)).not.toContain(made.raw)
      expect(row.ownerId).toBe(gymA)
      const list = await call(ownerA, 'GET', '/api/developer/keys')
      expect(list.status).toBe(200)
      expect(list.text).not.toContain(made.raw)
      expect(list.text).not.toContain(row.keyHash)
      const listed = list.data.keys.find((k: any) => k.id === made.id)
      expect(listed).toMatchObject({ prefix: made.view.prefix, status: 'active', scopes: ['members:read'], description: 'CRM sync' })
      expect(listed.key).toBeUndefined()
      // Nothing in the audit trail or the request log holds it either.
      await v1(made.bearer, 'GET', '/members')
      const secretPart = made.raw.slice(17)
      expect(JSON.stringify(await prisma.auditLog.findMany({ where: { ownerId: gymA } }))).not.toContain(secretPart)
      expect(JSON.stringify(await prisma.apiRequestLog.findMany({ where: { ownerId: gymA } }))).not.toContain(secretPart)
    })

    it('is managed by owners, admins and managers only, and never by members', async () => {
      const body = { name: 'Nope', scopes: ['members:read'] }
      for (const role of ['front_desk', 'coach', 'sales', 'accountant']) {
        expect((await call(staff[role], 'POST', '/api/developer/keys', body)).status, role).toBe(403)
        expect((await call(staff[role], 'GET', '/api/developer/keys')).status, role).toBe(403)
        expect((await call(staff[role], 'GET', '/api/developer/webhooks')).status, role).toBe(403)
        expect((await call(staff[role], 'GET', '/api/developer/deliveries')).status, role).toBe(403)
      }
      expect((await call(staff.manager, 'POST', '/api/developer/keys', body)).status).toBe(200)
      expect((await call(null, 'POST', '/api/developer/keys', body)).status).toBe(401)
      const member = await createMember(gymA)
      const { token } = await createInvite(gymA, member.id)
      await setPasswordWithToken(token, 'correct-horse-42')
      const bearer = await memberBearer(member.id)
      expect((await call(bearer, 'POST', '/api/developer/keys', body)).status).toBe(401)
      expect((await call(bearer, 'GET', '/api/developer/keys')).status).toBe(401)
      // A member's own session is not an API key either.
      expect((await v1(bearer, 'GET', '/members')).status).toBe(401)
    })

    it('needs a name and at least one known scope, and cannot grant more than its maker may do', async () => {
      expect((await call(ownerA, 'POST', '/api/developer/keys', { name: 'x', scopes: [] })).status).toBe(400)
      expect((await call(ownerA, 'POST', '/api/developer/keys', { name: 'x', scopes: ['everything:write'] })).status).toBe(400)
      expect((await call(ownerA, 'POST', '/api/developer/keys', { name: '', scopes: ['members:read'] })).status).toBe(400)
      await expect(createApiKey(gymA, { name: 'Desk', description: null, scopes: ['programs:write'], expiresInDays: null }, { type: 'staff', id: randomUUID(), name: 'Desk', role: 'front_desk' })).rejects.toMatchObject({ status: 403, code: 'scope_not_allowed' })
      const allowed = await createApiKey(gymA, { name: 'Desk', description: null, scopes: ['members:read', 'bookings:write'], expiresInDays: null }, { type: 'staff', id: randomUUID(), name: 'Desk', role: 'front_desk' })
      expect(allowed.scopes).toEqual(['members:read', 'bookings:write'])
    })
  })

  // -------------------------------------------------------------------------
  describe('authentication', () => {
    it('accepts a valid key and gives every response a request ID', async () => {
      const r = await v1(keyA, 'GET', '')
      expect(r.status).toBe(200)
      expect(r.data.key.scopes.length).toBe(SCOPE_KEYS.length)
      expect(r.data.apiVersion).toBe('v1')
      const id = r.headers.get('x-request-id')!
      expect(id).toMatch(/^req_[0-9a-f]{24}$/)
      expect(r.headers.get('x-api-version')).toBe('v1')
      const logged = await prisma.apiRequestLog.findUnique({ where: { id } })
      expect(logged).toMatchObject({ ownerId: gymA, apiKeyId: keyAId, method: 'GET', path: '/api/v1', status: 200 })
      // The staff request log finds it by that ID.
      const found = await call(ownerA, 'GET', `/api/developer/requests?requestId=${id}`)
      expect(found.data).toHaveLength(1)
      expect(found.data[0]).toMatchObject({ requestId: id, status: 200 })
      expect((await call(ownerB, 'GET', `/api/developer/requests?requestId=${id}`)).data).toHaveLength(0)
      expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: keyAId } })).lastUsedAt).not.toBeNull()
    })

    it('refuses a missing, malformed, unknown, revoked or expired key with 401', async () => {
      const cases: [string | null, string][] = [
        [null, 'missing_api_key'],
        ['Bearer nonsense', 'invalid_api_key'],
        ['Bearer cc_live_00000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'invalid_api_key'],
        [`Bearer ${await createToken({ ownerId: gymA, emailVerified: true })}`, 'invalid_api_key'],
      ]
      for (const [auth, code] of cases) {
        const r = await v1(auth, 'GET', '/members')
        expect(r.status, code).toBe(401)
        expect(r.error.code).toBe(code)
        expect(r.error.requestId).toBe(r.headers.get('x-request-id'))
        expect(r.error.message).toBeTruthy()
      }
      // A signed-in owner's cookie is not a way in.
      expect((await call(ownerA, 'GET', '/api/v1/members')).status).toBe(401)

      const doomed = await makeKey(ownerA, ['members:read'])
      expect((await v1(doomed.bearer, 'GET', '/members')).status).toBe(200)
      const revoked = await call(ownerA, 'DELETE', `/api/developer/keys/${doomed.id}`)
      expect(revoked.data.status).toBe('revoked')
      const after = await v1(doomed.bearer, 'GET', '/members')
      expect(after.status).toBe(401)
      expect(after.error.code).toBe('api_key_revoked')
      // Another gym cannot revoke it (or see it).
      const other = await makeKey(ownerA, ['members:read'])
      expect((await call(ownerB, 'DELETE', `/api/developer/keys/${other.id}`)).status).toBe(404)
      expect((await v1(other.bearer, 'GET', '/members')).status).toBe(200)

      const short = await makeKey(ownerA, ['members:read'], { expiresInDays: 1 })
      await prisma.apiKey.update({ where: { id: short.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
      const expired = await v1(short.bearer, 'GET', '/members')
      expect(expired.status).toBe(401)
      expect(expired.error.code).toBe('api_key_expired')
      expect((await call(ownerA, 'GET', '/api/developer/keys')).data.keys.find((k: any) => k.id === short.id).status).toBe('expired')
    })

    it('slows down an address that keeps sending no valid key, and logs none of it', async () => {
      const from = { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 250) + 1}` }
      const before = await prisma.apiRequestLog.count({ where: { ownerId: null } })
      const statuses: number[] = []
      for (let i = 0; i < 66; i++) statuses.push((await v1('Bearer cc_live_00000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'GET', '/members', undefined, from)).status)
      expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true)
      expect(statuses.slice(60).every((s) => s === 429)).toBe(true)
      const refused = await v1(null, 'GET', '/members', undefined, from)
      expect(refused.status).toBe(429)
      expect(refused.error).toMatchObject({ code: 'rate_limited' })
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
      // A real key from the same address is not caught up in it.
      expect((await v1(keyA, 'GET', '/members?pageSize=1', undefined, from)).status).toBe(200)
      expect(await prisma.apiRequestLog.count({ where: { ownerId: null } })).toBe(before)
    })

    it('answers unknown endpoints and bad input in its own error shape, without internals', async () => {
      const missing = await v1(keyA, 'GET', '/nothing/here')
      expect(missing.status).toBe(404)
      expect(missing.error).toMatchObject({ code: 'not_found' })
      expect(missing.error.requestId).toBeTruthy()
      const bad = await v1(keyA, 'POST', '/leads', { name: '' })
      expect(bad.status).toBe(400)
      expect(bad.error.code).toBe('validation_error')
      expect(bad.error.details[0]).toHaveProperty('field')
      const notJson = await fetch(`${BASE}/api/v1/leads`, { method: 'POST', headers: { Authorization: keyA, 'Content-Type': 'application/json' }, body: '{nope' })
      expect(notJson.status).toBe(400)
      expect((await notJson.json()).error.code).toBe('invalid_json')
      const gone = await v1(keyA, 'GET', `/members/${randomUUID()}`)
      expect(gone.status).toBe(404)
      for (const r of [missing, bad, gone]) expect(r.text).not.toMatch(/prisma|stack|at \w+ \(|node_modules|SELECT|"Member"/i)
    })
  })

  // -------------------------------------------------------------------------
  describe('scopes', () => {
    it('lets a key do exactly what its scopes say', async () => {
      const reader = (await makeKey(ownerA, ['members:read'])).bearer
      expect((await v1(reader, 'GET', '/members')).status).toBe(200)
      const denied = await v1(reader, 'POST', '/members', { name: 'No', email: `no-${randomUUID()}@test.local` })
      expect(denied.status).toBe(403)
      expect(denied.error.code).toBe('insufficient_scope')
      expect(denied.error.message).toContain('members:write')
      for (const path of ['/invoices', '/payments', '/leads', '/memberships', '/bookings', '/appointments', '/attendance', '/workouts', '/programs', '/classes', '/workout-sessions', '/membership-plans', '/appointment-types']) {
        expect((await v1(reader, 'GET', path)).status, path).toBe(403)
      }
      // Writing leads does not include reading them.
      const writer = (await makeKey(ownerA, ['leads:write'])).bearer
      const made = await v1(writer, 'POST', '/leads', { name: 'Scoped Lead', email: `lead-${randomUUID()}@test.local` })
      expect(made.status).toBe(201)
      expect((await v1(writer, 'GET', '/leads')).status).toBe(403)
      expect((await v1(writer, 'GET', `/leads/${made.data.id}`)).status).toBe(403)
      expect((await v1(writer, 'PATCH', `/leads/${made.data.id}`, { status: 'contacted' })).status).toBe(200)
      // Any valid key may ask who it is.
      expect((await v1(writer, 'GET', '')).data.key.scopes).toEqual(['leads:write'])
    })
  })

  // -------------------------------------------------------------------------
  describe('pagination and filters', () => {
    it('pages every list, caps the page size and refuses nonsense', async () => {
      const tag = `page-${randomUUID().slice(0, 8)}`
      for (let i = 0; i < 7; i++) expect((await v1(keyA, 'POST', '/leads', { name: `Lead ${i}`, email: `${tag}-${i}@test.local`, source: tag })).status).toBe(201)
      const first = await v1(keyA, 'GET', `/leads?source=${tag}&pageSize=3`)
      expect(first.json.data).toHaveLength(3)
      expect(first.json.pagination).toEqual({ page: 1, pageSize: 3, total: 7, totalPages: 3 })
      const last = await v1(keyA, 'GET', `/leads?source=${tag}&pageSize=3&page=3`)
      expect(last.json.data).toHaveLength(1)
      const beyond = await v1(keyA, 'GET', `/leads?source=${tag}&pageSize=3&page=9`)
      expect(beyond.status).toBe(200)
      expect(beyond.json.data).toEqual([])
      expect(beyond.json.pagination.total).toBe(7)
      const seen = new Set<string>()
      for (const page of [1, 2, 3]) for (const row of (await v1(keyA, 'GET', `/leads?source=${tag}&pageSize=3&page=${page}`)).json.data) seen.add(row.id)
      expect(seen.size).toBe(7)
      // No way to ask for everything at once.
      const huge = await v1(keyA, 'GET', `/leads?source=${tag}&pageSize=100000`)
      expect(huge.json.pagination.pageSize).toBe(100)
      expect((await v1(keyA, 'GET', '/leads')).json.pagination.pageSize).toBe(50)
      for (const q of ['pageSize=0', 'page=0', 'page=abc', 'pageSize=-5', 'page=1.5']) {
        const r = await v1(keyA, 'GET', `/leads?${q}`)
        expect(r.status, q).toBe(400)
        expect(r.error.code).toBe('invalid_parameter')
      }
      for (const path of ['/members', '/memberships', '/membership-plans', '/classes', '/bookings', '/appointments', '/appointment-types', '/attendance', '/payments', '/invoices', '/workouts', '/workout-sessions', '/programs', '/leads']) {
        const r = await v1(keyA, 'GET', `${path}?pageSize=2`)
        expect(r.status, path).toBe(200)
        expect(r.json.pagination, path).toMatchObject({ page: 1, pageSize: 2 })
        expect(r.json.data.length, path).toBeLessThanOrEqual(2)
      }
    })

    it('filters by change time, status and search, and validates what it is given', async () => {
      const old = await createMember(gymA, { name: 'Olive Old' })
      await prisma.$executeRaw`UPDATE "Member" SET "updatedAt" = ${new Date(Date.now() - 10 * 86_400_000)} WHERE "id" = ${old.id}`
      const since = new Date(Date.now() - 60_000).toISOString()
      const fresh = await v1(keyA, 'POST', '/members', { name: 'Freya Fresh', email: `fresh-${randomUUID()}@test.local` })
      const changed = await v1(keyA, 'GET', `/members?updatedSince=${encodeURIComponent(since)}&pageSize=100`)
      const ids = changed.json.data.map((m: any) => m.id)
      expect(ids).toContain(fresh.data.id)
      expect(ids).not.toContain(old.id)
      // Touching the old member brings it into the next sync.
      await v1(keyA, 'PATCH', `/members/${old.id}`, { phone: '555-0100' })
      expect((await v1(keyA, 'GET', `/members?updatedSince=${encodeURIComponent(since)}&pageSize=100`)).json.data.map((m: any) => m.id)).toContain(old.id)
      expect((await v1(keyA, 'GET', `/members?email=${encodeURIComponent(fresh.data.email)}`)).json.data).toHaveLength(1)
      expect((await v1(keyA, 'GET', '/members?search=Freya')).json.data.map((m: any) => m.id)).toContain(fresh.data.id)
      expect((await v1(keyA, 'GET', '/members?status=frozen')).json.data).toEqual([])
      const lead = await v1(keyA, 'POST', '/leads', { name: 'Lena Lost', email: `lost-${randomUUID()}@test.local` })
      await v1(keyA, 'PATCH', `/leads/${lead.data.id}`, { status: 'lost', lostReason: 'Moved away' })
      const lost = await v1(keyA, 'GET', '/leads?status=lost')
      expect(lost.json.data.map((l: any) => l.id)).toContain(lead.data.id)
      expect(lost.json.data.every((l: any) => l.status === 'lost')).toBe(true)
      for (const q of ['/members?updatedSince=yesterday', '/members?status=sleeping', '/leads?createdSince=12/31/2026', '/payments?type=gift', '/classes?from=2026-01-01&to=2025-01-01', '/classes?from=2026-01-01&to=2026-06-01']) {
        expect((await v1(keyA, 'GET', q)).status, q).toBe(400)
      }
    })
  })

  // -------------------------------------------------------------------------
  describe('rate limits', () => {
    it('limits each key, says so in headers, and leaves the gym\'s other keys alone', async () => {
      const slow = await makeKey(ownerA, ['members:read'])
      await prisma.apiKey.update({ where: { id: slow.id }, data: { rateLimit: 3 } })
      const results: Res[] = []
      for (let i = 0; i < 9; i++) results.push(await v1(slow.bearer, 'GET', '/members?pageSize=1'))
      const ok = results.filter((r) => r.status === 200)
      const limited = results.filter((r) => r.status === 429)
      expect(ok.length).toBeGreaterThanOrEqual(3)
      expect(limited.length).toBeGreaterThanOrEqual(3)
      expect(ok[0].headers.get('x-ratelimit-limit')).toBe('3')
      expect(Number(ok[0].headers.get('x-ratelimit-remaining'))).toBeLessThanOrEqual(2)
      expect(Number(ok[0].headers.get('x-ratelimit-reset'))).toBeGreaterThan(Date.now() / 1000 - 1)
      const refused = limited[0]
      expect(refused.error.code).toBe('rate_limited')
      expect(refused.error.requestId).toBeTruthy()
      expect(refused.headers.get('x-ratelimit-remaining')).toBe('0')
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
      expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60)
      // The same gym's other key, and another gym, are untouched.
      expect((await v1(keyA, 'GET', '/members?pageSize=1')).status).toBe(200)
      expect((await v1(keyB, 'GET', '/members?pageSize=1')).status).toBe(200)
    })
  })

  // -------------------------------------------------------------------------
  describe('idempotency', () => {
    it('returns the first answer for a repeated key and does the work once', async () => {
      const key = randomUUID()
      const body = { name: 'Ida Once', email: `ida-${randomUUID()}@test.local`, source: 'Website' }
      const first = await v1(keyA, 'POST', '/leads', body, { 'Idempotency-Key': key })
      const again = await v1(keyA, 'POST', '/leads', body, { 'Idempotency-Key': key })
      expect(first.status).toBe(201)
      expect(again.status).toBe(201)
      expect(again.data).toEqual(first.data)
      expect(first.headers.get('idempotent-replayed')).toBeNull()
      expect(again.headers.get('idempotent-replayed')).toBe('true')
      expect(await prisma.prospect.count({ where: { ownerId: gymA, email: body.email } })).toBe(1)
      // The same key with different contents is a mistake, not a retry.
      const clash = await v1(keyA, 'POST', '/leads', { ...body, name: 'Someone Else' }, { 'Idempotency-Key': key })
      expect(clash.status).toBe(409)
      expect(clash.error.code).toBe('idempotency_key_reused')
      // Another gym using the same key string is unaffected.
      const elsewhere = await v1(keyB, 'POST', '/leads', body, { 'Idempotency-Key': key })
      expect(elsewhere.status).toBe(201)
      expect(elsewhere.data.id).not.toBe(first.data.id)
      // Without a key, the same request twice is two leads: that is what the header is for.
      const loose = { name: 'No Key', email: `nokey-${randomUUID()}@test.local` }
      await v1(keyA, 'POST', '/leads', loose)
      await v1(keyA, 'POST', '/leads', loose)
      expect(await prisma.prospect.count({ where: { ownerId: gymA, email: loose.email } })).toBe(2)
    })

    it('does the work once when the same request arrives eight times at once', async () => {
      const key = randomUUID()
      const body = { name: 'Connie Current', email: `connie-${randomUUID()}@test.local` }
      const all = await Promise.all(Array.from({ length: 8 }, () => v1(keyA, 'POST', '/members', body, { 'Idempotency-Key': key })))
      expect(all.map((r) => r.status)).toEqual(Array(8).fill(201))
      expect(new Set(all.map((r) => r.data.id)).size).toBe(1)
      expect(all.filter((r) => r.headers.get('idempotent-replayed') === 'true')).toHaveLength(7)
      expect(await prisma.member.count({ where: { ownerId: gymA, email: body.email } })).toBe(1)
    })

    it('lets a failed request be corrected and retried under the same key', async () => {
      const key = randomUUID()
      const taken = await createMember(gymA)
      const refused = await v1(keyA, 'POST', '/members', { name: 'Dup', email: taken.email }, { 'Idempotency-Key': key })
      expect(refused.status).toBe(409)
      expect(refused.error.code).toBe('duplicate_email')
      const fixed = await v1(keyA, 'POST', '/members', { name: 'Dup', email: taken.email }, { 'Idempotency-Key': key })
      expect(fixed.status).toBe(409)
      await prisma.member.update({ where: { id: taken.id }, data: { archivedAt: new Date() } })
      expect((await v1(keyA, 'POST', '/members', { name: 'Dup', email: taken.email }, { 'Idempotency-Key': key })).status).toBe(201)
    })
  })

  // -------------------------------------------------------------------------
  describe('resources', () => {
    let plan: Awaited<ReturnType<typeof createPlan>>
    let bigger: Awaited<ReturnType<typeof createPlan>>
    let memberId: string
    let membershipId: string

    it('members: create, read, update, archive, restore, with nothing sensitive in the answer', async () => {
      const email = `ava-${randomUUID()}@test.local`
      const created = await v1(keyA, 'POST', '/members', { name: 'Ava Api', email: email.toUpperCase(), phone: '555-0101', medicalNotes: 'Asthma', emergencyContactName: 'Sam', city: 'Austin' })
      expect(created.status).toBe(201)
      memberId = created.data.id
      expect(created.data).toMatchObject({ object: 'member', name: 'Ava Api', email, status: 'active', address: { city: 'Austin' } })
      for (const secret of ['medicalNotes', 'qrCode', 'accessToken', 'waiverSignature', 'stripeCustomerId', 'connectCustomerId', 'emergencyContactName', 'ownerId']) expect(created.data, secret).not.toHaveProperty(secret)
      expect(created.text).not.toContain('Asthma')
      expect((await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).medicalNotes).toBe('Asthma')
      expect((await v1(keyA, 'GET', `/members/${memberId}`)).data.id).toBe(memberId)
      // The same rule as the directory: one live member per email address.
      const dup = await v1(keyA, 'POST', '/members', { name: 'Other', email })
      expect(dup.status).toBe(409)
      expect(dup.error.code).toBe('duplicate_email')
      const patched = await v1(keyA, 'PATCH', `/members/${memberId}`, { name: 'Ava Updated', city: 'Dallas' })
      expect(patched.data).toMatchObject({ name: 'Ava Updated', address: { city: 'Dallas' } })
      expect(new Date(patched.data.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.data.updatedAt).getTime())
      const archived = await v1(keyA, 'DELETE', `/members/${memberId}`)
      expect(archived.data.archivedAt).not.toBeNull()
      expect((await v1(keyA, 'GET', `/members?email=${encodeURIComponent(email)}`)).json.data).toHaveLength(0)
      expect((await v1(keyA, 'GET', `/members?email=${encodeURIComponent(email)}&archived=true`)).json.data).toHaveLength(1)
      expect((await v1(keyA, 'PATCH', `/members/${memberId}`, { archived: false })).data.archivedAt).toBeNull()
      const audit = await prisma.auditLog.findMany({ where: { ownerId: gymA, entityId: memberId } })
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['member.create', 'member.update', 'member.archive', 'member.restore']))
      expect(audit.every((a) => a.actorType === 'api_key')).toBe(true)
    })

    it('memberships: sell, freeze, resume, cancel, and change plan by the gym\'s own rules', async () => {
      plan = await createPlan(gymA, { name: 'Api Unlimited', priceCents: 10000, isPublic: true })
      bigger = await createPlan(gymA, { name: 'Api Premium', priceCents: 16000, isPublic: true })
      const plans = await v1(keyA, 'GET', '/membership-plans')
      expect(plans.json.data.map((p: any) => p.id)).toEqual(expect.arrayContaining([plan.id, bigger.id]))
      const key = randomUUID()
      const sold = await v1(keyA, 'POST', '/memberships', { memberId, planId: plan.id, paymentMethod: 'cash' }, { 'Idempotency-Key': key })
      expect(sold.status, sold.text).toBe(201)
      membershipId = sold.data.id
      expect(sold.data).toMatchObject({ object: 'membership', memberId, planId: plan.id, planName: 'Api Unlimited', status: 'active', priceCents: 10000 })
      expect(sold.data.invoice).toMatchObject({ object: 'invoice', status: 'open', totalCents: 10000, balanceCents: 10000 })
      // Cash is taken in person: the API cannot say it was received.
      expect(sold.data.charge).toBeNull()
      expect((await v1(keyA, 'POST', '/memberships', { memberId, planId: plan.id, paymentMethod: 'cash' }, { 'Idempotency-Key': key })).data.id).toBe(membershipId)
      expect(await prisma.membership.count({ where: { memberId } })).toBe(1)
      expect((await v1(keyA, 'GET', `/memberships/${membershipId}`)).data.id).toBe(membershipId)
      expect((await v1(keyA, 'GET', `/memberships?memberId=${memberId}&status=active`)).json.data).toHaveLength(1)

      const frozen = await v1(keyA, 'POST', `/memberships/${membershipId}/freeze`, { reason: 'Travelling' })
      expect(frozen.data.status).toBe('frozen')
      expect((await v1(keyA, 'GET', `/members/${memberId}`)).data.status).toBe('frozen')
      // A frozen membership cannot be frozen again: the service's rule, surfaced as it is.
      expect((await v1(keyA, 'POST', `/memberships/${membershipId}/freeze`, {})).status).toBe(400)
      expect((await v1(keyA, 'POST', `/memberships/${membershipId}/unfreeze`, {})).data.status).toBe('active')
      const ending = await v1(keyA, 'POST', `/memberships/${membershipId}/cancel`, { when: 'period_end', reason: 'Moving' })
      expect(ending.data.status).toBe('active')
      expect(ending.data.cancelAt).not.toBeNull()
      expect((await v1(keyA, 'POST', `/memberships/${membershipId}/resume`, {})).data.cancelAt).toBeNull()
      expect((await v1(keyA, 'POST', `/memberships/${membershipId}/cancel`, {})).status).toBe(400)
      expect((await v1(keyA, 'POST', `/memberships/${membershipId}/explode`, {})).status).toBe(404)

      const preview = await v1(keyA, 'POST', `/memberships/${membershipId}/change-plan`, { planId: bigger.id, effective: 'next_period', preview: true })
      expect(preview.status, preview.text).toBe(200)
      expect(preview.data).toMatchObject({ object: 'plan_change_preview', from: { id: plan.id }, to: { id: bigger.id } })
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).pendingPlanId).toBeNull()
      const scheduled = await v1(keyA, 'POST', `/memberships/${membershipId}/change-plan`, { planId: bigger.id, effective: 'next_period' })
      expect(scheduled.status, scheduled.text).toBe(200)
      expect(scheduled.data.pendingPlanId).toBe(bigger.id)
      expect(scheduled.data.planChange.status).toBe('scheduled')
    })

    it('invoices and payments: read only, with the money that was actually recorded', async () => {
      const invoices = await v1(keyA, 'GET', `/invoices?memberId=${memberId}`)
      expect(invoices.json.data).toHaveLength(1)
      const invoice = invoices.json.data[0]
      expect(invoice).toMatchObject({ status: 'open', totalCents: 10000, currency: 'usd' })
      expect(invoice.items[0]).toMatchObject({ amountCents: 10000 })
      const payment = await tx((db) => recordPayment(db, { ownerId: gymA, invoiceId: invoice.id, method: 'cash' }))
      await prisma.transaction.update({ where: { id: payment.id }, data: { providerReference: 'pi_test_gymA_123' } })
      expect((await v1(keyA, 'GET', `/invoices/${invoice.id}`)).data).toMatchObject({ status: 'paid', amountPaidCents: 10000, balanceCents: 0 })
      expect((await v1(keyA, 'GET', `/invoices?number=${invoice.number}`)).json.data).toHaveLength(1)
      const payments = await v1(keyA, 'GET', `/payments?invoiceId=${invoice.id}`)
      expect(payments.json.data).toHaveLength(1)
      expect(payments.json.data[0]).toMatchObject({ object: 'payment', type: 'payment', status: 'succeeded', amountCents: 10000, method: 'cash', memberId, processorReference: 'pi_test_gymA_123' })
      expect((await v1(keyA, 'GET', `/payments/${payment.id}`)).data.id).toBe(payment.id)
      expect((await v1(keyA, 'GET', '/payments?processorReference=pi_test_gymA_123')).json.data).toHaveLength(1)
      // There is nothing to write to.
      for (const [method, path] of [['POST', '/payments'], ['POST', '/invoices'], ['DELETE', `/payments/${payment.id}`], ['PATCH', `/invoices/${invoice.id}`]] as const) {
        const r = await v1(keyA, method, path, {})
        expect([404, 405], `${method} ${path}`).toContain(r.status)
      }
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('paid')
    })

    it('classes and bookings: read the schedule, book, waitlist, cancel', async () => {
      const session = await createSession(gymA, { capacity: 1, waitlistCapacity: 2, startsAt: new Date(Date.now() + 3 * 86_400_000) })
      const classes = await v1(keyA, 'GET', `/classes?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 5 * 86_400_000).toISOString())}&pageSize=100`)
      const listed = classes.json.data.find((c: any) => c.id === session.id)
      expect(listed).toMatchObject({ object: 'class', name: 'CrossFit', capacity: 1, bookedCount: 0, spotsLeft: 1, status: 'scheduled' })
      const key = randomUUID()
      const booked = await v1(keyA, 'POST', '/bookings', { classId: session.id, memberId }, { 'Idempotency-Key': key })
      expect(booked.status, booked.text).toBe(201)
      expect(booked.data).toMatchObject({ object: 'booking', classId: session.id, memberId, status: 'booked' })
      expect((await v1(keyA, 'POST', '/bookings', { classId: session.id, memberId }, { 'Idempotency-Key': key })).data.id).toBe(booked.data.id)
      // Booking twice without the key is refused by the booking rules, not duplicated.
      const twice = await v1(keyA, 'POST', '/bookings', { classId: session.id, memberId })
      expect(twice.status).toBeGreaterThanOrEqual(400)
      expect(await prisma.booking.count({ where: { sessionId: session.id, memberId } })).toBe(1)
      expect((await v1(keyA, 'GET', `/classes/${session.id}`)).data).toMatchObject({ bookedCount: 1, spotsLeft: 0 })

      // The class is full: a second member is refused, or waitlisted if they ask to be.
      const second = await createMember(gymA)
      await tx((db) => sellMembership(db, { ownerId: gymA, memberId: second.id, planId: plan.id, paymentMethod: 'cash' }))
      const full = await v1(keyA, 'POST', '/bookings', { classId: session.id, memberId: second.id })
      expect(full.status).toBeGreaterThanOrEqual(400)
      expect(full.error.code).toBeTruthy()
      const waiting = await v1(keyA, 'POST', '/bookings', { classId: session.id, memberId: second.id, joinWaitlist: true })
      expect(waiting.status, waiting.text).toBe(201)
      expect(waiting.data).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
      // Someone with no membership cannot be booked through the API any more than at the desk.
      const stranger = await createMember(gymA, { status: 'inactive' })
      const other = await createSession(gymA, { startsAt: new Date(Date.now() + 4 * 86_400_000) })
      expect((await v1(keyA, 'POST', '/bookings', { classId: other.id, memberId: stranger.id })).status).toBeGreaterThanOrEqual(400)
      expect(await prisma.booking.count({ where: { sessionId: other.id } })).toBe(0)

      expect((await v1(keyA, 'GET', `/bookings?classId=${session.id}`)).json.data).toHaveLength(2)
      expect((await v1(keyA, 'GET', `/bookings?memberId=${memberId}&status=booked`)).json.data.map((b: any) => b.id)).toContain(booked.data.id)
      expect((await v1(keyA, 'GET', `/bookings/${booked.data.id}`)).data.status).toBe('booked')
      const cancelled = await v1(keyA, 'DELETE', `/bookings/${booked.data.id}`)
      expect(cancelled.data).toMatchObject({ status: 'cancelled', late: false })
      // The waitlisted member is moved up by the same rule as always.
      expect((await v1(keyA, 'GET', `/bookings/${waiting.data.id}`)).data.status).toMatch(/booked|offered/)
    })

    it('attendance: lists and reads check-ins', async () => {
      const checkin = await prisma.checkin.create({ data: { ownerId: gymA, memberId, type: 'open_gym', source: 'manual', timestamp: new Date(Date.now() - 3_600_000) } })
      const list = await v1(keyA, 'GET', `/attendance?memberId=${memberId}`)
      expect(list.json.data).toHaveLength(1)
      expect(list.json.data[0]).toMatchObject({ object: 'attendance', id: checkin.id, memberId, type: 'open_gym' })
      expect((await v1(keyA, 'GET', `/attendance/${checkin.id}`)).data.id).toBe(checkin.id)
      expect((await v1(keyA, 'GET', `/attendance?memberId=${memberId}&from=${encodeURIComponent(new Date().toISOString())}`)).json.data).toHaveLength(0)
    })

    it('appointments: find a free time, book, move, cancel', async () => {
      const coach = await prisma.staff.create({ data: { ownerId: gymA, name: 'Coach Api', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
      await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ ownerId: gymA, staffId: coach.id, weekday: d, startMinute: 540, endMinute: 1020, kind: 'work' })) })
      const type = await call(ownerA, 'POST', '/api/appointments/types', { name: 'Api PT', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 60, cancelWindowHours: 12, staffIds: [coach.id] })
      expect(type.status, type.text).toBe(200)
      const typeId = type.data.id
      const types = await v1(keyA, 'GET', '/appointment-types')
      expect(types.json.data.find((t: any) => t.id === typeId)).toMatchObject({ name: 'Api PT', durationMin: 60, staff: [{ id: coach.id, name: 'Coach Api' }] })
      const date = addDaysToDate(today, 3)
      const slots = await v1(keyA, 'GET', `/appointments/slots?typeId=${typeId}&date=${date}`)
      expect(slots.status, slots.text).toBe(200)
      expect(slots.data.length).toBeGreaterThan(0)
      expect(slots.data[0].staff[0].id).toBe(coach.id)
      expect((await v1(keyA, 'GET', '/appointments/slots?date=tomorrow')).status).toBe(400)

      const key = randomUUID()
      const body = { typeId, memberId, startsAt: at(3, '10:00') }
      const booked = await v1(keyA, 'POST', '/appointments', body, { 'Idempotency-Key': key })
      expect(booked.status, booked.text).toBe(201)
      expect(booked.data).toMatchObject({ object: 'appointment', memberId, typeId, status: 'booked', staff: { id: coach.id }, startsAt: at(3, '10:00') })
      expect(booked.data).not.toHaveProperty('staffNotes')
      expect((await v1(keyA, 'POST', '/appointments', body, { 'Idempotency-Key': key })).data.id).toBe(booked.data.id)
      // The coach is now busy then: the rule that stops a clash is the service's, and it holds here.
      const other = await createMember(gymA)
      const clash = await v1(keyA, 'POST', '/appointments', { typeId, memberId: other.id, startsAt: at(3, '10:30') })
      expect(clash.status).toBeGreaterThanOrEqual(400)
      expect(await prisma.appointment.count({ where: { ownerId: gymA, typeId, status: 'booked' } })).toBe(1)
      // Outside working hours cannot be forced from the API.
      expect((await v1(keyA, 'POST', '/appointments', { typeId, memberId: other.id, startsAt: at(3, '03:00') })).status).toBeGreaterThanOrEqual(400)

      const moved = await v1(keyA, 'PATCH', `/appointments/${booked.data.id}`, { startsAt: at(3, '14:00') })
      expect(moved.status, moved.text).toBe(200)
      expect(moved.data).toMatchObject({ startsAt: at(3, '14:00'), rescheduleCount: 1, previousStartsAt: at(3, '10:00') })
      expect((await v1(keyA, 'GET', `/appointments?memberId=${memberId}&status=booked`)).json.data).toHaveLength(1)
      expect((await v1(keyA, 'GET', `/appointments/${booked.data.id}`)).data.startsAt).toBe(at(3, '14:00'))
      const cancelled = await v1(keyA, 'DELETE', `/appointments/${booked.data.id}?reason=Changed%20plans`)
      expect(cancelled.data).toMatchObject({ status: 'cancelled', cancelReason: 'Changed plans', late: false })
    })

    it('workouts and programs: read them, assign them, read what members finished', async () => {
      await ensureSystemExercises()
      const squat = await prisma.exercise.findFirstOrThrow({ where: { ownerId: null, name: 'Back Squat' } })
      const { workout } = await tx((db) => createWorkout(db, gymA, workoutSchema.parse({ name: 'Api Strength', type: 'strength', content: { blocks: [{ type: 'straight', items: [{ exerciseId: squat.id, sets: 3, reps: '5', weight: 135, weightUnit: 'lb' }] }] } })))
      const list = await v1(keyA, 'GET', '/workouts?search=Api')
      expect(list.json.data.find((w: any) => w.id === workout.id)).toMatchObject({ object: 'workout', name: 'Api Strength', type: 'strength', version: 1 })
      expect(list.json.data[0]).not.toHaveProperty('blocks')
      const one = await v1(keyA, 'GET', `/workouts/${workout.id}`)
      expect(one.data.blocks[0].items[0]).toMatchObject({ exerciseName: 'Back Squat', sets: 3, reps: '5', weight: 135 })

      // "Today" is the gym's today: an assignment starting on it is active straight away.
      const todayUtc = today
      const assigned = await v1(keyA, 'POST', `/workouts/${workout.id}/assign`, { memberIds: [memberId], date: addDaysToDate(todayUtc, 1) })
      expect(assigned.status, assigned.text).toBe(201)
      expect(assigned.data.assigned).toHaveLength(1)
      expect(assigned.data.assigned[0]).toMatchObject({ object: 'workout_session', memberId, workoutId: workout.id, status: 'not_started' })
      expect(assigned.data.assigned[0]).not.toHaveProperty('coachNotes')
      expect((await v1(keyA, 'POST', `/workouts/${workout.id}/assign`, { memberIds: [memberId], date: addDaysToDate(todayUtc, 1) })).data).toMatchObject({ assigned: [], alreadyAssigned: 1 })

      const program = await tx((db) => createProgram(db, gymA, programSchema.parse({ name: 'Api Program', weeks: 2, days: [{ week: 1, day: weekday(todayUtc), workoutId: workout.id }, { week: 2, day: weekday(todayUtc), workoutId: workout.id }] })))
      expect((await v1(keyA, 'GET', '/programs')).json.data.map((p: any) => p.id)).toContain(program.id)
      const detail = await v1(keyA, 'GET', `/programs/${program.id}`)
      expect(detail.data).toMatchObject({ object: 'program', name: 'Api Program', weeks: 2 })
      expect(detail.data.days).toHaveLength(2)
      const key = randomUUID()
      const on = await v1(keyA, 'POST', `/programs/${program.id}/assignments`, { memberIds: [memberId], startDate: todayUtc }, { 'Idempotency-Key': key })
      expect(on.status, on.text).toBe(201)
      expect(on.data.assigned[0]).toMatchObject({ object: 'program_assignment', programId: program.id, memberId, status: 'active', startDate: todayUtc })
      expect((await v1(keyA, 'POST', `/programs/${program.id}/assignments`, { memberIds: [memberId], startDate: todayUtc }, { 'Idempotency-Key': key })).data).toEqual(on.data)
      // Without the key the service still refuses to put them on it twice.
      expect((await v1(keyA, 'POST', `/programs/${program.id}/assignments`, { memberIds: [memberId], startDate: todayUtc })).data).toMatchObject({ assigned: [], alreadyOn: [memberId] })
      expect(await prisma.programAssignment.count({ where: { programId: program.id, memberId } })).toBe(1)
      expect((await v1(keyA, 'GET', `/programs/${program.id}/assignments?status=active`)).json.data).toHaveLength(1)
      const sessions = await v1(keyA, 'GET', `/workout-sessions?memberId=${memberId}`)
      expect(sessions.json.data).toHaveLength(1)
      await prisma.workoutSession.update({ where: { id: sessions.json.data[0].id }, data: { coachNotes: 'Private: knee', status: 'completed', completedAt: new Date() } })
      const done = await v1(keyA, 'GET', `/workout-sessions?memberId=${memberId}&status=completed`)
      expect(done.json.data).toHaveLength(1)
      expect(done.text).not.toContain('Private: knee')
    })

    it('leads: create from a website form, read, update, and move along the pipeline', async () => {
      const email = `web-${randomUUID()}@test.local`
      const created = await v1(keyA, 'POST', '/leads', { name: 'Wes Website', email, phone: '555-0199', source: 'Website form', interest: 'Personal training', notes: 'Asked about mornings' })
      expect(created.status).toBe(201)
      expect(created.data).toMatchObject({ object: 'lead', name: 'Wes Website', email, status: 'new', source: 'Website form', interest: 'Personal training' })
      // It is the same lead the sales team sees, with the same timeline entry.
      const inApp = await call(ownerA, 'GET', `/api/leads/${created.data.id}`)
      expect(inApp.data).toMatchObject({ name: 'Wes Website', status: 'new' })
      expect(inApp.data.activities.map((a: any) => a.type)).toContain('lead_created')
      expect(inApp.data.activities[0].actorName).toMatch(/^API key: /)
      expect((await v1(keyA, 'GET', `/leads/${created.data.id}`)).data.id).toBe(created.data.id)
      expect((await v1(keyA, 'GET', `/leads?email=${encodeURIComponent(email)}`)).json.data).toHaveLength(1)
      const moved = await v1(keyA, 'PATCH', `/leads/${created.data.id}`, { status: 'contacted', estimatedValueCents: 120000 })
      expect(moved.data).toMatchObject({ status: 'contacted', estimatedValueCents: 120000 })
      expect(moved.data.contactedAt).not.toBeNull()
      expect((await v1(keyA, 'PATCH', `/leads/${created.data.id}`, { status: 'converted' })).status).toBe(400)
      expect((await v1(keyA, 'PATCH', `/leads/${created.data.id}`, { assignedStaffId: randomUUID() })).status).toBe(404)
    })
  })

  // -------------------------------------------------------------------------
  describe('tenant isolation', () => {
    it('gives a key nothing from another gym: by ID, by search, by processor reference, or by writing', async () => {
      // Gym A's things, found through gym A's key.
      const member = (await v1(keyA, 'GET', '/members?search=Ava')).json.data[0]
      const membership = (await v1(keyA, 'GET', `/memberships?memberId=${member.id}`)).json.data[0]
      const invoice = (await v1(keyA, 'GET', `/invoices?memberId=${member.id}`)).json.data[0]
      const payment = (await v1(keyA, 'GET', `/payments?memberId=${member.id}`)).json.data[0]
      const booking = (await v1(keyA, 'GET', `/bookings?memberId=${member.id}`)).json.data[0]
      const appointment = (await v1(keyA, 'GET', `/appointments?memberId=${member.id}`)).json.data[0]
      const attendance = (await v1(keyA, 'GET', `/attendance?memberId=${member.id}`)).json.data[0]
      const workout = (await v1(keyA, 'GET', '/workouts?search=Api')).json.data[0]
      const program = (await v1(keyA, 'GET', '/programs?search=Api')).json.data[0]
      const lead = (await v1(keyA, 'GET', '/leads?search=Wes')).json.data[0]
      const klass = await createSession(gymA, { startsAt: new Date(Date.now() + 6 * 86_400_000) })
      for (const [name, thing] of Object.entries({ member, membership, invoice, payment, booking, appointment, attendance, workout, program, lead })) expect(thing, name).toBeTruthy()

      // Direct ID access: 404, the same as an ID that does not exist.
      const direct = [`/members/${member.id}`, `/memberships/${membership.id}`, `/invoices/${invoice.id}`, `/payments/${payment.id}`, `/bookings/${booking.id}`, `/appointments/${appointment.id}`, `/attendance/${attendance.id}`, `/workouts/${workout.id}`, `/programs/${program.id}`, `/programs/${program.id}/assignments`, `/leads/${lead.id}`, `/classes/${klass.id}`]
      for (const path of direct) {
        const r = await v1(keyB, 'GET', path)
        expect(r.status, path).toBe(404)
        expect(r.error.code, path).toBe('not_found')
        expect(r.text, path).not.toContain(member.email)
      }
      // Search and filters: gym A's rows never appear, whatever is asked for.
      const searches = [`/members?email=${encodeURIComponent(member.email)}`, `/members?search=Ava`, `/members?archived=all&pageSize=100`, `/memberships?memberId=${member.id}`, `/invoices?memberId=${member.id}`, `/invoices?number=${invoice.number}`, `/payments?memberId=${member.id}`, `/payments?invoiceId=${invoice.id}`,
        '/payments?processorReference=pi_test_gymA_123', `/bookings?memberId=${member.id}`, `/bookings?classId=${booking.classId}`, `/appointments?memberId=${member.id}`, `/attendance?memberId=${member.id}`, '/workouts?search=Api', '/programs?search=Api', `/workout-sessions?memberId=${member.id}`, `/leads?email=${encodeURIComponent(lead.email)}`, '/leads?search=Wes', `/classes?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86_400_000).toISOString())}`]
      for (const path of searches) {
        const r = await v1(keyB, 'GET', path)
        expect(r.status, path).toBe(200)
        expect(r.json.data, path).toEqual([])
        expect(r.json.pagination.total, path).toBe(0)
      }
      // Writing: nothing of gym A's can be changed, and gym A's IDs cannot be used inside gym B.
      const before = JSON.stringify(await Promise.all([prisma.member.findUnique({ where: { id: member.id } }), prisma.membership.findUnique({ where: { id: membership.id } }), prisma.prospect.findUnique({ where: { id: lead.id } }), prisma.booking.count({ where: { ownerId: gymA } }), prisma.appointment.count({ where: { ownerId: gymA } }), prisma.programAssignment.count({ where: { ownerId: gymA } }), prisma.workoutSession.count({ where: { ownerId: gymA } })]))
      const theirs = await createMember(gymB)
      const theirPlan = await createPlan(gymB)
      const locationA = await prisma.location.create({ data: { ownerId: gymA, name: 'A Only' } })
      const writes: [string, string, unknown][] = [
        ['PATCH', `/members/${member.id}`, { name: 'Hijacked' }],
        ['DELETE', `/members/${member.id}`, undefined],
        ['POST', '/memberships', { memberId: member.id, planId: theirPlan.id }],
        ['POST', '/memberships', { memberId: theirs.id, planId: membership.planId }],
        ['POST', '/memberships', { memberId: theirs.id, planId: theirPlan.id, locationId: locationA.id }],
        ['POST', `/memberships/${membership.id}/cancel`, { when: 'now' }],
        ['POST', `/memberships/${membership.id}/freeze`, {}],
        ['POST', `/memberships/${membership.id}/change-plan`, { planId: theirPlan.id }],
        ['POST', '/bookings', { classId: klass.id, memberId: member.id }],
        ['POST', '/bookings', { classId: klass.id, memberId: theirs.id }],
        ['DELETE', `/bookings/${booking.id}`, undefined],
        ['POST', '/appointments', { typeId: appointment.typeId, memberId: theirs.id, startsAt: at(4, '11:00') }],
        ['PATCH', `/appointments/${appointment.id}`, { startsAt: at(4, '11:00') }],
        ['DELETE', `/appointments/${appointment.id}`, undefined],
        ['POST', `/workouts/${workout.id}/assign`, { memberIds: [theirs.id], date: '2027-01-04' }],
        ['POST', `/programs/${program.id}/assignments`, { memberIds: [theirs.id], startDate: '2027-01-04' }],
        ['PATCH', `/leads/${lead.id}`, { status: 'lost' }],
      ]
      for (const [method, path, body] of writes) {
        const r = await v1(keyB, method, path, body)
        expect(r.status, `${method} ${path}`).toBe(404)
      }
      // A lead or member created in gym B naming gym A's location or staff is refused too.
      const staffA = await prisma.staff.findFirstOrThrow({ where: { ownerId: gymA } })
      expect((await v1(keyB, 'POST', '/leads', { name: 'X', email: `x-${randomUUID()}@test.local`, assignedStaffId: staffA.id })).status).toBe(404)
      expect((await v1(keyB, 'POST', '/members', { name: 'X', email: `x-${randomUUID()}@test.local`, assignedStaffId: staffA.id })).status).toBe(404)
      const after = JSON.stringify(await Promise.all([prisma.member.findUnique({ where: { id: member.id } }), prisma.membership.findUnique({ where: { id: membership.id } }), prisma.prospect.findUnique({ where: { id: lead.id } }), prisma.booking.count({ where: { ownerId: gymA } }), prisma.appointment.count({ where: { ownerId: gymA } }), prisma.programAssignment.count({ where: { ownerId: gymA } }), prisma.workoutSession.count({ where: { ownerId: gymA } })]))
      expect(after).toBe(before)
      expect(await prisma.booking.count({ where: { ownerId: gymB } })).toBe(0)
      // The same email may exist in both gyms; each key sees its own.
      const twin = await v1(keyB, 'POST', '/members', { name: 'Twin', email: member.email })
      expect(twin.status).toBe(201)
      expect(twin.data.id).not.toBe(member.id)
      expect((await v1(keyA, 'GET', `/members?email=${encodeURIComponent(member.email)}`)).json.data.map((m: any) => m.id)).toEqual([member.id])
    })
  })

  // -------------------------------------------------------------------------
  describe('webhooks', () => {
    let endpointId: string
    let secret: string
    const verify = (hit: Hit, withSecret = secret) => {
      const expected = `v1=${createHmac('sha256', withSecret).update(`${hit.headers['clubcheck-timestamp']}.${hit.body}`).digest('hex')}`
      return hit.headers['clubcheck-signature'] === expected
    }

    it('creates an endpoint, shows its secret once, and validates the URL and events', async () => {
      const created = await call(ownerA, 'POST', '/api/developer/webhooks', { url: `${hook}/a`, description: 'Test receiver', events: ['lead.created', 'lead.updated', 'member.updated'] })
      expect(created.status, created.text).toBe(200)
      endpointId = created.data.id
      secret = created.data.secret
      expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
      expect(created.data).toMatchObject({ url: `${hook}/a`, isActive: true, events: ['lead.created', 'lead.updated', 'member.updated'], secretHint: secret.slice(-4) })
      const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } })
      expect(row.secretCipher).not.toContain(secret)
      expect(JSON.stringify(row)).not.toContain(secret)
      const list = await call(ownerA, 'GET', '/api/developer/webhooks')
      expect(list.text).not.toContain(secret)
      expect(list.text).not.toContain(row.secretCipher)
      expect(list.data.endpoints.find((e: any) => e.id === endpointId)).toMatchObject({ secretHint: secret.slice(-4) })
      expect(list.data.events.map((e: any) => e.type)).toEqual(EVENT_TYPES)
      expect((await call(ownerA, 'PATCH', `/api/developer/webhooks/${endpointId}`, { description: 'Renamed' })).text).not.toContain(secret)
      expect(JSON.stringify(await prisma.auditLog.findMany({ where: { ownerId: gymA, entityType: 'webhook_endpoint' } }))).not.toContain(secret)

      for (const bad of [{ url: 'not a url', events: ['lead.created'] }, { url: 'ftp://example.com/x', events: ['lead.created'] }, { url: 'http://example.com/hook', events: ['lead.created'] }, { url: 'https://user:pass@example.com/hook', events: ['lead.created'] }, { url: `${hook}/a`, events: [] }, { url: `${hook}/a`, events: ['lead.exploded'] }]) {
        expect((await call(ownerA, 'POST', '/api/developer/webhooks', bad)).status, JSON.stringify(bad)).toBe(400)
      }
      // Another gym cannot see, change, test or remove it.
      expect((await call(ownerB, 'GET', '/api/developer/webhooks')).data.endpoints).toEqual([])
      for (const [method, body] of [['PATCH', { isActive: false }], ['POST', { action: 'test' }], ['POST', { action: 'roll_secret' }], ['DELETE', undefined]] as const) {
        expect((await call(ownerB, method, `/api/developer/webhooks/${endpointId}`, body)).status, method).toBe(404)
      }
    })

    it('in production, refuses addresses that are not on the public internet', () => {
      const env = process.env.NODE_ENV
      ;(process.env as Record<string, string>).NODE_ENV = 'production'
      try {
        for (const url of ['http://localhost:3000/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.10/x', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/x', 'http://example.com/x']) {
          expect(() => checkWebhookUrl(url), url).toThrow()
        }
        expect(checkWebhookUrl('https://example.com/hooks/clubcheck#frag')).toBe('https://example.com/hooks/clubcheck')
      } finally {
        ;(process.env as Record<string, string>).NODE_ENV = env!
      }
    })

    it('delivers a signed event once for one operation, to subscribed endpoints only', async () => {
      const email = `hook-${randomUUID()}@test.local`
      const key = randomUUID()
      const created = await v1(keyA, 'POST', '/leads', { name: 'Hattie Hook', email, source: 'Webhook test' }, { 'Idempotency-Key': key })
      expect(created.status).toBe(201)
      const hit = await until(() => got('/a', 'lead.created').find((h) => h.body.includes(email)))
      const payload = JSON.parse(hit.body)
      expect(payload).toMatchObject({ type: 'lead.created', apiVersion: 'v1', data: { object: { object: 'lead', id: created.data.id, email, status: 'new' } } })
      expect(payload.id).toMatch(/^evt_[0-9a-f]{24}$/)
      expect(hit.headers['clubcheck-event-id']).toBe(payload.id)
      expect(hit.headers['content-type']).toBe('application/json')
      expect(hit.headers['user-agent']).toMatch(/^ClubCheck-Webhooks/)
      expect(Math.abs(Number(hit.headers['clubcheck-timestamp']) - Date.now() / 1000)).toBeLessThan(120)
      // The signature a receiver would compute, and what tampering or the wrong secret does to it.
      expect(verify(hit)).toBe(true)
      expect(verify({ ...hit, body: hit.body.replace('Hattie', 'Mallory') })).toBe(false)
      expect(verify(hit, 'whsec_wrong')).toBe(false)
      expect(hit.headers['clubcheck-signature']).toBe(`v1=${signPayload(secret, Number(hit.headers['clubcheck-timestamp']), hit.body)}`)
      // The payload is the same shape the API returns for the lead.
      expect(payload.data.object).toEqual((await v1(keyA, 'GET', `/leads/${created.data.id}`)).data)

      // A replayed request does nothing, so there is nothing more to announce.
      await v1(keyA, 'POST', '/leads', { name: 'Hattie Hook', email, source: 'Webhook test' }, { 'Idempotency-Key': key })
      await new Promise((r) => setTimeout(r, 700))
      expect(got('/a', 'lead.created').filter((h) => h.body.includes(email))).toHaveLength(1)
      expect(await prisma.webhookEvent.count({ where: { ownerId: gymA, type: 'lead.created', dedupeKey: `lead.created:${created.data.id}` } })).toBe(1)
      const delivery = await until(async () => (await call(ownerA, 'GET', `/api/developer/deliveries?endpointId=${endpointId}&status=succeeded`)).data.find((d: any) => d.event.id === payload.id))
      expect(delivery).toMatchObject({ status: 'succeeded', attempts: 1, lastStatusCode: 200 })
      const detail = await call(ownerA, 'GET', `/api/developer/deliveries/${delivery.id}`)
      expect(detail.data.event.payload).toEqual(payload)
      expect(detail.data.tries).toHaveLength(1)
      expect(detail.text).not.toContain(secret)

      // Not subscribed to member.created: creating a member sends nothing; updating one does, from the staff app too.
      const member = await v1(keyA, 'POST', '/members', { name: 'Quiet Create', email: `quiet-${randomUUID()}@test.local` })
      const patched = await call(ownerA, 'PATCH', `/api/members/${member.data.id}`, { phone: '555-0142' })
      expect(patched.status).toBe(200)
      const updated = await until(() => got('/a', 'member.updated').find((h) => h.body.includes(member.data.id)))
      expect(JSON.parse(updated.body).data.object).toMatchObject({ id: member.data.id, phone: '555-0142' })
      expect(got('/a', 'member.created').filter((h) => h.body.includes(member.data.id))).toHaveLength(0)
      expect(await prisma.webhookEvent.count({ where: { ownerId: gymA, type: 'member.created' } })).toBe(0)
    })

    it('keeps each gym\'s events to its own endpoints', async () => {
      const theirs = await call(ownerB, 'POST', '/api/developer/webhooks', { url: `${hook}/b`, events: ['*'] })
      expect(theirs.status).toBe(200)
      const email = `only-a-${randomUUID()}@test.local`
      await v1(keyA, 'POST', '/leads', { name: 'Only A', email })
      await until(() => got('/a', 'lead.created').find((h) => h.body.includes(email)))
      const emailB = `only-b-${randomUUID()}@test.local`
      await v1(keyB, 'POST', '/leads', { name: 'Only B', email: emailB })
      const toB = await until(() => got('/b', 'lead.created').find((h) => h.body.includes(emailB)))
      expect(verify(toB, theirs.data.secret)).toBe(true)
      expect(verify(toB)).toBe(false)
      await new Promise((r) => setTimeout(r, 500))
      expect(got('/b').filter((h) => h.body.includes(email))).toHaveLength(0)
      expect(got('/a').filter((h) => h.body.includes(emailB))).toHaveLength(0)
      // Gym B cannot see or retry gym A's deliveries.
      const mine = (await call(ownerA, 'GET', '/api/developer/deliveries')).data
      expect(mine.length).toBeGreaterThan(0)
      expect((await call(ownerB, 'GET', `/api/developer/deliveries/${mine[0].id}`)).status).toBe(404)
      expect((await call(ownerB, 'POST', `/api/developer/deliveries/${mine[0].id}`)).status).toBe(404)
      expect((await call(ownerB, 'GET', `/api/developer/deliveries?endpointId=${endpointId}`)).data).toEqual([])
    })

    it('retries a failed delivery with growing gaps, the same event ID and the same bytes, then gives up', async () => {
      answer['/a'] = 500
      const email = `retry-${randomUUID()}@test.local`
      const created = await v1(keyA, 'POST', '/leads', { name: 'Rita Retry', email })
      const first = await until(() => got('/a', 'lead.created').find((h) => h.body.includes(email)))
      const eventId = first.headers['clubcheck-event-id']
      const failed = await until(async () => (await call(ownerA, 'GET', `/api/developer/deliveries?endpointId=${endpointId}&status=failed`)).data.find((d: any) => d.event.id === eventId))
      expect(failed).toMatchObject({ status: 'failed', attempts: 1, lastStatusCode: 500, lastError: 'The endpoint answered 500' })
      const gap = (new Date(failed.nextAttemptAt).getTime() - new Date(failed.lastAttemptAt).getTime()) / 1000
      expect(Math.round(gap)).toBe(RETRY_AFTER_SEC[0])
      // Not due yet: nothing is sent early.
      await deliverDue({ ownerId: gymA })
      expect(got('/a').filter((h) => h.headers['clubcheck-event-id'] === eventId)).toHaveLength(1)

      // When it comes due it is sent again, and the gap grows.
      await prisma.webhookDelivery.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
      // Two workers at once send it once.
      await Promise.all([deliverDue({ ownerId: gymA }), deliverDue({ ownerId: gymA }), deliverDue({ ownerId: gymA })])
      const sends = got('/a').filter((h) => h.headers['clubcheck-event-id'] === eventId)
      expect(sends).toHaveLength(2)
      expect(sends[1].body).toBe(sends[0].body)
      expect(sends[1].headers['clubcheck-delivery-id']).toBe(sends[0].headers['clubcheck-delivery-id'])
      expect(verify(sends[1])).toBe(true)
      const second = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })
      expect(second).toMatchObject({ status: 'failed', attempts: 2 })
      expect(Math.round((second.nextAttemptAt!.getTime() - second.lastAttemptAt!.getTime()) / 1000)).toBe(RETRY_AFTER_SEC[1])

      // The last automatic attempt failing leaves it dead: no more retries by themselves.
      await prisma.webhookDelivery.update({ where: { id: failed.id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) } })
      await deliverDue({ ownerId: gymA })
      const dead = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })
      expect(dead).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS, nextAttemptAt: null })
      await deliverDue({ ownerId: gymA })
      expect(got('/a').filter((h) => h.headers['clubcheck-event-id'] === eventId)).toHaveLength(3)
      expect((await call(ownerA, 'GET', `/api/developer/deliveries?status=dead`)).data.map((d: any) => d.id)).toContain(failed.id)

      // A person retries it by hand: still failing, it stays dead; once the receiver is well, it goes through.
      const still = await call(ownerA, 'POST', `/api/developer/deliveries/${failed.id}`)
      expect(still.status).toBe(200)
      expect(still.data).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS + 1 })
      answer['/a'] = 200
      for (const role of ['front_desk', 'coach']) expect((await call(staff[role], 'POST', `/api/developer/deliveries/${failed.id}`)).status).toBe(403)
      const retried = await call(ownerA, 'POST', `/api/developer/deliveries/${failed.id}`)
      expect(retried.data).toMatchObject({ status: 'succeeded', lastStatusCode: 200 })
      expect(retried.data.tries.at(-1)).toMatchObject({ manual: true, statusCode: 200 })
      const all = got('/a').filter((h) => h.headers['clubcheck-event-id'] === eventId)
      expect(all).toHaveLength(5)
      expect(new Set(all.map((h) => h.body)).size).toBe(1)
      expect(JSON.parse(all[4].body).data.object.id).toBe(created.data.id)
      // Nothing about the retries created another event or another lead.
      expect(await prisma.webhookEvent.count({ where: { ownerId: gymA, dedupeKey: `lead.created:${created.data.id}` } })).toBe(1)
      expect(await prisma.prospect.count({ where: { ownerId: gymA, email } })).toBe(1)
      expect((await call(ownerA, 'POST', `/api/developer/deliveries/${failed.id}`)).status).toBe(409)
    })

    it('records a receiver that cannot be reached, and one that redirects, as failures', async () => {
      const dead = await call(ownerA, 'POST', '/api/developer/webhooks', { url: 'http://127.0.0.1:9/unreachable', events: ['lead.created'] })
      const test = await call(ownerA, 'POST', `/api/developer/webhooks/${dead.data.id}`, { action: 'test' })
      expect(test.status).toBe(200)
      expect(test.data.delivery).toMatchObject({ status: 'dead', lastStatusCode: null })
      expect(test.data.delivery.lastError).toMatch(/Could not connect|No answer/)
      await call(ownerA, 'DELETE', `/api/developer/webhooks/${dead.data.id}`)
      answer['/redirect'] = 302
      const redirecting = await call(ownerA, 'POST', '/api/developer/webhooks', { url: `${hook}/redirect`, events: ['lead.created'] })
      expect((await call(ownerA, 'POST', `/api/developer/webhooks/${redirecting.data.id}`, { action: 'test' })).data.delivery).toMatchObject({ status: 'dead', lastStatusCode: 302 })
      await call(ownerA, 'DELETE', `/api/developer/webhooks/${redirecting.data.id}`)
      expect((await call(ownerA, 'GET', '/api/developer/webhooks')).data.endpoints.map((e: any) => e.id)).not.toContain(redirecting.data.id)
    })

    it('sends a test event, respects switching off, and rolls the secret', async () => {
      const before = got('/a', 'webhook.test').length
      const test = await call(ownerA, 'POST', `/api/developer/webhooks/${endpointId}`, { action: 'test' })
      expect(test.data.delivery).toMatchObject({ status: 'succeeded', lastStatusCode: 200 })
      const hit = got('/a', 'webhook.test')[before]
      expect(verify(hit)).toBe(true)
      expect(JSON.parse(hit.body).type).toBe('webhook.test')

      await call(ownerA, 'PATCH', `/api/developer/webhooks/${endpointId}`, { isActive: false })
      const email = `off-${randomUUID()}@test.local`
      await v1(keyA, 'POST', '/leads', { name: 'While Off', email })
      await new Promise((r) => setTimeout(r, 700))
      expect(got('/a').filter((h) => h.body.includes(email))).toHaveLength(0)
      await call(ownerA, 'PATCH', `/api/developer/webhooks/${endpointId}`, { isActive: true })

      const rolled = await call(ownerA, 'POST', `/api/developer/webhooks/${endpointId}`, { action: 'roll_secret' })
      expect(rolled.data.secret).toMatch(/^whsec_/)
      expect(rolled.data.secret).not.toBe(secret)
      const emailAfter = `rolled-${randomUUID()}@test.local`
      await v1(keyA, 'POST', '/leads', { name: 'After Roll', email: emailAfter })
      const after = await until(() => got('/a', 'lead.created').find((h) => h.body.includes(emailAfter)))
      expect(verify(after, rolled.data.secret)).toBe(true)
      expect(verify(after, secret)).toBe(false)
      secret = rolled.data.secret
    })

    it('announces each kind of change once, from the service that makes it', async () => {
      await call(ownerA, 'PATCH', `/api/developer/webhooks/${endpointId}`, { events: ['*'] })
      const mark = hits.length
      const types = () => hits.slice(mark).filter((h) => h.path === '/a').map((h) => h.headers['clubcheck-event-type'])
      const plan = await createPlan(gymA, { name: 'Hook Plan', priceCents: 5000 })
      const member = await v1(keyA, 'POST', '/members', { name: 'Eve Events', email: `eve-${randomUUID()}@test.local` })
      const sold = await v1(keyA, 'POST', '/memberships', { memberId: member.data.id, planId: plan.id, paymentMethod: 'cash' })
      expect(sold.status, sold.text).toBe(201)
      await until(() => ['member.created', 'membership.created', 'invoice.created'].every((t) => types().includes(t)))
      await v1(keyA, 'POST', `/memberships/${sold.data.id}/freeze`, {})
      await v1(keyA, 'POST', `/memberships/${sold.data.id}/unfreeze`, {})
      const session = await createSession(gymA, { startsAt: new Date(Date.now() + 7 * 86_400_000) })
      const booking = await v1(keyA, 'POST', '/bookings', { classId: session.id, memberId: member.data.id })
      expect(booking.status, booking.text).toBe(201)
      await v1(keyA, 'DELETE', `/bookings/${booking.data.id}`)
      await v1(keyA, 'DELETE', `/members/${member.data.id}`)
      await until(() => ['membership.frozen', 'membership.resumed', 'booking.created', 'booking.cancelled', 'member.archived'].every((t) => types().includes(t)))
      // A payment recorded here, in another process, is sent by the background job.
      await tx((db) => recordPayment(db, { ownerId: gymA, invoiceId: sold.data.invoice.id, method: 'cash' }))
      await deliverDue({ ownerId: gymA })
      await until(() => ['payment.succeeded', 'invoice.paid'].every((t) => types().includes(t)))
      await new Promise((r) => setTimeout(r, 500))
      const seen = types()
      for (const once of ['member.created', 'membership.created', 'invoice.created', 'invoice.paid', 'payment.succeeded', 'membership.frozen', 'membership.resumed', 'booking.created', 'booking.cancelled', 'member.archived']) {
        expect(seen.filter((t) => t === once), once).toHaveLength(1)
      }
      // Every event ID is unique, and every one verifies.
      const ids = hits.slice(mark).filter((h) => h.path === '/a').map((h) => h.headers['clubcheck-event-id'])
      expect(new Set(ids).size).toBe(ids.length)
      expect(hits.slice(mark).filter((h) => h.path === '/a').every((h) => verify(h))).toBe(true)
      const paid = hits.slice(mark).find((h) => h.headers['clubcheck-event-type'] === 'invoice.paid')!
      expect(JSON.parse(paid.body).data.object).toMatchObject({ object: 'invoice', id: sold.data.invoice.id, status: 'paid', balanceCents: 0 })
    })
  })
})

// ---------------------------------------------------------------------------
// The documentation is part of the contract: these fail when code and docs drift apart.
// ---------------------------------------------------------------------------
describe('public API documentation', () => {
  const read = (path: string) => require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', path), 'utf8') as string
  const routes = () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const root = path.resolve(__dirname, '..', 'app/api/v1')
    const found: { path: string; method: string; scope: string | null }[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name === 'route.ts' && !full.includes('[...path]')) {
          const source = fs.readFileSync(full, 'utf8')
          const url = (path.relative(root, dir).split(path.sep).join('/').replace(/\[(\w+)\]/g, '{$1}') || '').replace(/^/, '/').replace(/\/$/, '') || '/'
          for (const m of source.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = publicHandler\(\{ scope: (?:'([a-z:]+)'|null)/g)) found.push({ path: url, method: m[1].toLowerCase(), scope: m[2] || null })
        }
      }
    }
    walk(root)
    return found
  }

  it('openapi.yaml lists exactly the endpoints that exist, each with the scope the code enforces', () => {
    const spec = read('docs/openapi.yaml')
    const section = spec.slice(spec.indexOf('\npaths:\n'), spec.indexOf('\nwebhooks:\n'))
    const documented: { path: string; method: string; scope: string | null }[] = []
    let current = ''
    let method = ''
    for (const line of section.split('\n')) {
      const p = line.match(/^  ['"]?(\/[^'":]*)['"]?:$/)
      if (p) { current = p[1]; continue }
      const m = line.match(/^    (get|post|patch|put|delete):$/)
      if (m) { method = m[1]; continue }
      const s = line.match(/^      x-scope: (.+)$/)
      if (s) documented.push({ path: current, method, scope: s[1] === 'null' ? null : s[1].replace(/['"]/g, '') })
    }
    const key = (r: { path: string; method: string; scope: string | null }) => `${r.method.toUpperCase()} ${r.path} [${r.scope}]`
    expect(documented.map(key).sort()).toEqual(routes().map(key).sort())
    expect(documented.length).toBeGreaterThan(40)
  })

  it('the guide names every scope, every event and every endpoint', () => {
    const guide = read('docs/PUBLIC-API.md')
    for (const scope of SCOPE_KEYS) expect(guide, scope).toContain(`\`${scope}\``)
    for (const event of EVENT_TYPES) expect(guide, event).toContain(`\`${event}\``)
    const spec = read('docs/openapi.yaml')
    for (const event of EVENT_TYPES) expect(spec, event).toContain(event)
    for (const scope of SCOPE_KEYS) expect(spec, scope).toContain(scope)
    for (const r of routes()) {
      if (r.path === '/') continue
      const shown = r.path.replace('/{action}', '/')
      expect(guide.includes(`\`${r.path}\``) || guide.includes(shown), `${r.method} ${r.path}`).toBe(true)
    }
    // The retry schedule in the guide is the one in the code.
    expect(MAX_ATTEMPTS).toBe(7)
    expect(RETRY_AFTER_SEC).toEqual([60, 300, 1800, 7200, 21_600, 86_400])
  })

  it('signs payloads the way the guide tells receivers to verify them', () => {
    const body = '{"id":"evt_1","type":"lead.created"}'
    expect(signPayload('whsec_test', 1791400000, body)).toBe(createHmac('sha256', 'whsec_test').update(`1791400000.${body}`).digest('hex'))
    expect(signPayload('whsec_test', 1791400000, body)).not.toBe(signPayload('whsec_test', 1791400001, body))
    expect(signPayload('whsec_test', 1791400000, body)).not.toBe(signPayload('whsec_other', 1791400000, body))
  })
})
