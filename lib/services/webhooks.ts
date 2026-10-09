// Outbound webhooks: telling a gym's other software that something happened.
//
// An event is written once, in the same transaction as the change it describes (emitEvent), with
// the exact JSON that will be sent. Each subscribed endpoint gets one delivery row for it. Sending
// happens afterwards and separately (deliverDue): a delivery is claimed, POSTed with a signature,
// and either succeeds or is rescheduled with a growing gap until it is given up on. Every retry,
// automatic or by hand, sends the same event ID and the same bytes, so a receiver can ignore
// anything it has already seen.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto'
import { lookup as dnsLookup, type LookupAddress } from 'dns'
import { lookup } from 'dns/promises'
import http from 'http'
import https from 'https'
import { isIP, type LookupFunction } from 'net'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import type { Db } from './core'

export const WEBHOOK_EVENTS = {
  'member.created': 'A member was added',
  'member.updated': 'A member\'s details or status changed',
  'member.archived': 'A member was archived',
  'membership.created': 'A membership was sold or started',
  'membership.updated': 'A membership changed: plan, price, past due, or set to end (or not to) at its period end',
  'membership.cancelled': 'A membership ended',
  'membership.frozen': 'A membership was frozen',
  'membership.resumed': 'A frozen membership was resumed',
  'booking.created': 'A member was booked into a class, or joined its waitlist',
  'booking.updated': 'A booking changed: off the waitlist, offered a spot, or marked a no-show',
  'booking.cancelled': 'A class booking was cancelled',
  'booking.checked_in': 'A booked member was checked in to the class',
  'appointment.created': 'An appointment was booked',
  'appointment.updated': 'An appointment was moved',
  'appointment.cancelled': 'An appointment was cancelled',
  'appointment.completed': 'An appointment was marked completed',
  'appointment.no_show': 'An appointment was marked as a no-show',
  'payment.succeeded': 'A payment was taken',
  'payment.failed': 'A payment attempt failed',
  'payment.refunded': 'A payment was refunded, fully or partly',
  'invoice.created': 'An invoice was created',
  'invoice.paid': 'An invoice was paid in full',
  'invoice.failed': 'Collecting an invoice failed',
  'workout.completed': 'A member completed a workout',
  'program.assigned': 'A program was assigned to a member',
  'program.completed': 'A member\'s program finished',
  'lead.created': 'A lead was added',
  'lead.updated': 'A lead\'s details or stage changed',
} as const
export type WebhookEventType = keyof typeof WEBHOOK_EVENTS
export const EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[]
/** Sent only by the "send test event" button. */
export const TEST_EVENT = 'webhook.test'

/** Gaps between attempts. After the last one fails, the delivery is dead until someone retries it by hand. */
export const RETRY_AFTER_SEC = [60, 300, 1800, 7200, 21_600, 86_400]
export const MAX_ATTEMPTS = RETRY_AFTER_SEC.length + 1
const TIMEOUT_MS = 10_000
const CLAIM_MS = 60_000
/** An endpoint that has failed this many deliveries outright, with no success in between, is switched off. */
const DISABLE_AFTER_DEAD = 20

// ---------------------------------------------------------------------------
// Secrets and signatures
// ---------------------------------------------------------------------------

// The signing secret has to be recoverable (it signs every delivery), so it is encrypted at rest
// rather than hashed. The key comes from WEBHOOK_ENCRYPTION_KEY (required in production; outside it JWT_SECRET stands in).
function cipherKey() {
  // In production the key must be its own secret: borrowing the session secret would tie every
  // stored webhook secret to it, and rotating one would silently break the other.
  if (process.env.NODE_ENV === 'production' && !process.env.WEBHOOK_ENCRYPTION_KEY) throw new ApiError(503, 'Webhooks are not configured on this server yet.', 'not_configured')
  const base = process.env.WEBHOOK_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!base) throw new Error('WEBHOOK_ENCRYPTION_KEY or JWT_SECRET must be set to use webhooks')
  return createHash('sha256').update(`clubcheck-webhook-secret:${base}`).digest()
}
function seal(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv)
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}
function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
const newSecret = () => `whsec_${randomBytes(32).toString('base64url')}`

/** The signature a receiver recomputes: HMAC-SHA256 of "<timestamp>.<raw body>", hex, under the endpoint's secret. */
export function signPayload(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

// ---------------------------------------------------------------------------
// Where a webhook may be sent
// ---------------------------------------------------------------------------

const LOCAL_OK = () => process.env.NODE_ENV !== 'production' || process.env.WEBHOOK_ALLOW_PRIVATE === '1'
function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v.startsWith('::ffff:')) return privateAddress(v.slice(7))
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

/** A URL staff may register: https, a real host, no credentials. Plain http to this machine is allowed outside production, for development. */
export function checkWebhookUrl(raw: string) {
  let url: URL
  try { url = new URL(raw) } catch { throw new ApiError(400, 'Enter a full URL, for example https://example.com/webhooks/clubcheck.', 'invalid_url') }
  if (url.username || url.password) throw new ApiError(400, 'The URL cannot contain a username or password.', 'invalid_url')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol === 'http:' && !(local && LOCAL_OK())) throw new ApiError(400, 'Webhook URLs must use https.', 'invalid_url')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ApiError(400, 'Webhook URLs must use https.', 'invalid_url')
  if (!LOCAL_OK() && (local || (isIP(url.hostname.replace(/^\[|\]$/g, '')) && privateAddress(url.hostname.replace(/^\[|\]$/g, ''))))) throw new ApiError(400, 'That address is not reachable from the internet.', 'invalid_url')
  url.hash = ''
  return url.toString()
}

/** Just before sending: the name must not resolve to this server's own network. */
async function assertPublicHost(url: URL) {
  if (LOCAL_OK()) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new Error('The address resolves to a private network')
}

/**
 * Name resolution for the connection itself. The address the socket is about to connect to is the
 * one that is checked, so a host cannot pass the check with one DNS answer and be connected to
 * with another (DNS rebinding).
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, found) => {
    if (error) return callback(error, '', 0)
    const addresses = found as LookupAddress[]
    if (!LOCAL_OK() && (addresses.length === 0 || addresses.some((a) => privateAddress(a.address)))) {
      return callback(Object.assign(new Error('The address resolves to a private network'), { code: 'EPRIVATE' }), '', 0)
    }
    if (options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}

/** One POST, no redirects followed, a bounded wait and a bounded read of the answer. */
function send(url: URL, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }, lookup: guardedLookup, agent: false }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        // Only the start of the answer is kept; a receiver cannot make us hold an endless one.
        if (size < 4096) chunks.push(chunk)
        size += chunk.length
        if (size > 65_536) res.destroy()
      })
      const done = () => { clearTimeout(timer); resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }) }
      res.on('end', done)
      res.on('close', done)
      res.on('error', done)
    })
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('Timed out'), { name: 'TimeoutError' })), timeoutMs)
    request.on('error', (error) => { clearTimeout(timer); reject(error) })
    request.end(body)
  })
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const eventList = z.array(z.string()).min(1, 'Choose at least one event').max(EVENT_TYPES.length + 1)
  .refine((list) => list.every((e) => e === '*' || e in WEBHOOK_EVENTS), 'Unknown event type')
  .transform((list) => (list.includes('*') ? ['*'] : Array.from(new Set(list))))
export const endpointSchema = z.object({
  url: z.string().trim().min(1, 'Enter the URL').max(500),
  description: z.string().trim().max(300).nullish().transform((v) => v || null),
  events: eventList,
})
export const endpointUpdateSchema = z.object({
  url: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  events: eventList.optional(),
  isActive: z.boolean().optional(),
})

type EndpointRow = { id: string; url: string; description: string | null; isActive: boolean; secretHint: string; events: string[]; createdByName: string | null; createdAt: Date; updatedAt: Date; disabledAt: Date | null; disabledReason: string | null }
/** What staff see. The secret is never part of it: only its last four characters. */
export const endpointView = (e: EndpointRow) => ({ id: e.id, url: e.url, description: e.description, isActive: e.isActive, secretHint: e.secretHint, events: e.events, createdByName: e.createdByName, createdAt: e.createdAt, updatedAt: e.updatedAt, disabledAt: e.disabledAt, disabledReason: e.disabledReason })

const MAX_ENDPOINTS = 10

export async function createEndpoint(ownerId: string, input: z.infer<typeof endpointSchema>, createdByName?: string | null) {
  const url = checkWebhookUrl(input.url)
  if ((await prisma.webhookEndpoint.count({ where: { ownerId } })) >= MAX_ENDPOINTS) throw new ApiError(409, `A gym can have up to ${MAX_ENDPOINTS} webhook endpoints. Remove one first.`, 'too_many_endpoints')
  const secret = newSecret()
  const row = await prisma.webhookEndpoint.create({ data: { ownerId, url, description: input.description, events: input.events, secretCipher: seal(secret), secretHint: secret.slice(-4), createdByName: createdByName || null } })
  // The only time the secret leaves the server.
  return { ...endpointView(row), secret }
}

async function ownEndpoint(ownerId: string, id: string) {
  const row = await prisma.webhookEndpoint.findFirst({ where: { id, ownerId } })
  if (!row) throw notFound('Webhook endpoint')
  return row
}

export async function updateEndpoint(ownerId: string, id: string, input: z.infer<typeof endpointUpdateSchema>) {
  const row = await ownEndpoint(ownerId, id)
  const data: Prisma.WebhookEndpointUpdateInput = {}
  if (input.url !== undefined) data.url = checkWebhookUrl(input.url)
  if (input.description !== undefined) data.description = input.description || null
  if (input.events !== undefined) data.events = input.events
  if (input.isActive !== undefined) {
    data.isActive = input.isActive
    // Switching it back on by hand clears the automatic switch-off.
    if (input.isActive) { data.disabledAt = null; data.disabledReason = null }
  }
  return endpointView(await prisma.webhookEndpoint.update({ where: { id: row.id }, data }))
}

/** A new secret for an endpoint. The old one stops working at once. */
export async function rollSecret(ownerId: string, id: string) {
  const row = await ownEndpoint(ownerId, id)
  const secret = newSecret()
  const updated = await prisma.webhookEndpoint.update({ where: { id: row.id }, data: { secretCipher: seal(secret), secretHint: secret.slice(-4) } })
  return { ...endpointView(updated), secret }
}

export async function deleteEndpoint(ownerId: string, id: string) {
  const row = await ownEndpoint(ownerId, id)
  await prisma.webhookEndpoint.delete({ where: { id: row.id } })
  return { deleted: true }
}

export async function listEndpoints(ownerId: string) {
  const rows = await prisma.webhookEndpoint.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } })
  const since = new Date(Date.now() - 7 * 86_400_000)
  const counts = rows.length ? await prisma.webhookDelivery.groupBy({ by: ['endpointId', 'status'], where: { ownerId, endpointId: { in: rows.map((r) => r.id) }, createdAt: { gte: since } }, _count: { _all: true } }) : []
  return rows.map((r) => ({
    ...endpointView(r),
    lastWeek: Object.fromEntries(['succeeded', 'pending', 'failed', 'dead'].map((s) => [s, counts.find((c) => c.endpointId === r.id && c.status === s)?._count._all || 0])) as Record<'succeeded' | 'pending' | 'failed' | 'dead', number>,
  }))
}

// ---------------------------------------------------------------------------
// Recording events
// ---------------------------------------------------------------------------

/** Gyms that had an event recorded in this process and not yet sent: who to send for once the transaction is through. */
const waiting = new Set<string>()

/**
 * Record that something happened, inside the transaction that made it happen.
 *
 * `key` identifies the underlying operation (usually the row's id, plus whatever makes this
 * occurrence distinct). Recording the same type and key twice for a gym is ignored, so however
 * many code paths notice an operation, one event exists for it. `data` is only called when some
 * endpoint wants the event, so a gym with no webhooks pays one indexed lookup and nothing more.
 */
export async function emitEvent(db: Db, ownerId: string, type: WebhookEventType, key: string, data: () => Promise<unknown> | unknown) {
  const endpoints = await db.webhookEndpoint.findMany({ where: { ownerId, isActive: true, OR: [{ events: { has: type } }, { events: { has: '*' } }] }, select: { id: true } })
  if (endpoints.length === 0) return null
  const id = `evt_${randomBytes(12).toString('hex')}`
  const createdAt = new Date()
  const payload = { id, type, apiVersion: 'v1', createdAt: createdAt.toISOString(), data: { object: JSON.parse(JSON.stringify(await data())) } }
  const made = await db.webhookEvent.createMany({ data: [{ id, ownerId, type, dedupeKey: `${type}:${key}`.slice(0, 300), payload: payload as Prisma.InputJsonValue, createdAt }], skipDuplicates: true })
  if (made.count === 0) return null
  await db.webhookDelivery.createMany({ data: endpoints.map((e) => ({ ownerId, endpointId: e.id, eventId: id, nextAttemptAt: createdAt })), skipDuplicates: true })
  waiting.add(ownerId)
  return id
}

/** Send what this process has just recorded for a gym, without making anyone wait for it. Safe to call when there is nothing. */
export function kickWebhooks(ownerId: string) {
  if (!waiting.delete(ownerId)) return
  void deliverDue({ ownerId, limit: 20 }).catch((error) => console.error('[webhooks] delivery after a request failed:', error))
}

// ---------------------------------------------------------------------------
// Delivering
// ---------------------------------------------------------------------------

async function post(url: string, secret: string, event: { id: string; type: string; payload: unknown }, deliveryId: string) {
  const body = JSON.stringify(event.payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const started = Date.now()
  try {
    await assertPublicHost(new URL(url))
    // Sent over a connection whose address is checked as it is made. A redirect is not followed:
    // it could point somewhere the URL check never saw.
    const res = await send(new URL(url), {
      'Content-Type': 'application/json',
      'User-Agent': 'ClubCheck-Webhooks/1.0',
      'ClubCheck-Event-Id': event.id,
      'ClubCheck-Event-Type': event.type,
      'ClubCheck-Delivery-Id': deliveryId,
      'ClubCheck-Timestamp': String(timestamp),
      'ClubCheck-Signature': `v1=${signPayload(secret, timestamp, body)}`,
    }, body, TIMEOUT_MS)
    const text = res.text.slice(0, 500)
    const ok = res.status >= 200 && res.status < 300
    return { ok, statusCode: res.status, error: ok ? null : `The endpoint answered ${res.status}`, response: text || null, durationMs: Date.now() - started }
  } catch (error) {
    const name = (error as Error)?.name
    const message = name === 'TimeoutError' || name === 'AbortError' ? `No answer within ${TIMEOUT_MS / 1000} seconds` : `Could not connect: ${((error as Error)?.cause as Error | undefined)?.message || (error as Error)?.message || 'unknown error'}`
    return { ok: false, statusCode: null, error: message.slice(0, 300), response: null, durationMs: Date.now() - started }
  }
}

/** Make one attempt at a delivery this worker has already claimed, and record how it went. */
async function attempt(deliveryId: string, manual: boolean) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true, event: true } })
  if (!delivery) return null
  const result = await post(delivery.endpoint.url, unseal(delivery.endpoint.secretCipher), delivery.event, delivery.id)
  const attempts = delivery.attempts + 1
  const now = new Date()
  // A retry by hand does not use up, or restart, the automatic schedule's patience: a dead delivery that fails again stays dead.
  const gaveUp = !result.ok && (attempts >= MAX_ATTEMPTS || (manual && delivery.status === 'dead'))
  const updated = await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts, lastAttemptAt: now, lastStatusCode: result.statusCode, lastError: result.error, lockedUntil: null,
      ...(result.ok ? { status: 'succeeded', deliveredAt: now, nextAttemptAt: null } : gaveUp ? { status: 'dead', nextAttemptAt: null } : { status: 'failed', nextAttemptAt: new Date(now.getTime() + RETRY_AFTER_SEC[Math.min(attempts, RETRY_AFTER_SEC.length) - 1] * 1000) }),
      tries: { create: { attempt: attempts, statusCode: result.statusCode, error: result.error, response: result.response, durationMs: result.durationMs, manual } },
    },
  })
  if (gaveUp && delivery.event.type !== TEST_EVENT) await maybeDisable(delivery.endpointId)
  return { delivery: updated, result }
}

async function maybeDisable(endpointId: string) {
  const lastGood = await prisma.webhookDelivery.findFirst({ where: { endpointId, status: 'succeeded' }, orderBy: { deliveredAt: 'desc' }, select: { deliveredAt: true } })
  const dead = await prisma.webhookDelivery.count({ where: { endpointId, status: 'dead', ...(lastGood?.deliveredAt && { lastAttemptAt: { gt: lastGood.deliveredAt } }) } })
  if (dead < DISABLE_AFTER_DEAD) return
  await prisma.webhookEndpoint.updateMany({ where: { id: endpointId, isActive: true }, data: { isActive: false, disabledAt: new Date(), disabledReason: `Switched off after ${dead} events could not be delivered.` } })
}

/**
 * Send everything that is due, for one gym or all of them. Any number of callers may run this at
 * once: a delivery is claimed with a conditional update before it is sent, so it is sent by one.
 */
export async function deliverDue(opts: { ownerId?: string; limit?: number; now?: Date } = {}) {
  const now = opts.now || new Date()
  const due = await prisma.webhookDelivery.findMany({
    where: { ...(opts.ownerId && { ownerId: opts.ownerId }), status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }], endpoint: { isActive: true } },
    orderBy: { nextAttemptAt: 'asc' }, take: opts.limit || 50, select: { id: true },
  })
  let sent = 0
  let failed = 0
  await Promise.all(due.map(async ({ id }) => {
    const claim = await prisma.webhookDelivery.updateMany({ where: { id, status: { in: ['pending', 'failed'] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(Date.now() + CLAIM_MS) } })
    if (claim.count === 0) return
    const done = await attempt(id, false)
    if (done?.result.ok) sent++
    else failed++
  }))
  return { due: due.length, sent, failed }
}

/** Send a failed or dead delivery again, now, at a person's request. The same event, the same payload. */
export async function retryDelivery(ownerId: string, deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, ownerId }, select: { id: true, status: true } })
  if (!delivery) throw notFound('Delivery')
  if (delivery.status === 'succeeded') throw new ApiError(409, 'That delivery already succeeded.', 'already_delivered')
  const now = new Date()
  const claim = await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: { not: 'succeeded' }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(Date.now() + CLAIM_MS) } })
  if (claim.count === 0) throw new ApiError(409, 'That delivery is being sent right now. Refresh in a moment.', 'delivery_in_progress')
  const done = await attempt(delivery.id, true)
  return deliveryDetail(ownerId, done!.delivery.id)
}

/** Send a harmless test event to one endpoint and say how it went. */
export async function sendTestEvent(ownerId: string, endpointId: string) {
  const endpoint = await ownEndpoint(ownerId, endpointId)
  const id = `evt_${randomBytes(12).toString('hex')}`
  const createdAt = new Date()
  const payload = { id, type: TEST_EVENT, apiVersion: 'v1', createdAt: createdAt.toISOString(), data: { object: { message: 'This is a test event from ClubCheck. Nothing happened in your gym.' } } }
  const delivery = await prisma.$transaction(async (db) => {
    await db.webhookEvent.create({ data: { id, ownerId, type: TEST_EVENT, dedupeKey: `${TEST_EVENT}:${id}`, payload: payload as Prisma.InputJsonValue, createdAt } })
    // Not scheduled: a test is sent once, here, and never retried by the background job.
    return db.webhookDelivery.create({ data: { ownerId, endpointId: endpoint.id, eventId: id, nextAttemptAt: null, lockedUntil: new Date(Date.now() + CLAIM_MS) } })
  })
  const done = await attempt(delivery.id, true)
  if (!done!.result.ok) await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'dead', nextAttemptAt: null } })
  return deliveryDetail(ownerId, delivery.id)
}

// ---------------------------------------------------------------------------
// Looking at deliveries
// ---------------------------------------------------------------------------

export async function listDeliveries(ownerId: string, filters: { endpointId?: string | null; status?: string | null; skip: number; take: number }) {
  const where: Prisma.WebhookDeliveryWhereInput = { ownerId, ...(filters.endpointId && { endpointId: filters.endpointId }), ...(filters.status && { status: filters.status }) }
  const [rows, total] = await Promise.all([
    prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip: filters.skip, take: filters.take, include: { event: { select: { id: true, type: true, createdAt: true } }, endpoint: { select: { id: true, url: true } } } }),
    prisma.webhookDelivery.count({ where }),
  ])
  return { total, items: rows.map((d) => ({ id: d.id, status: d.status, attempts: d.attempts, lastStatusCode: d.lastStatusCode, lastError: d.lastError, lastAttemptAt: d.lastAttemptAt, nextAttemptAt: d.nextAttemptAt, deliveredAt: d.deliveredAt, createdAt: d.createdAt, event: d.event, endpoint: d.endpoint })) }
}

export async function deliveryDetail(ownerId: string, id: string) {
  const d = await prisma.webhookDelivery.findFirst({ where: { id, ownerId }, include: { event: true, endpoint: { select: { id: true, url: true } }, tries: { orderBy: { createdAt: 'asc' } } } })
  if (!d) throw notFound('Delivery')
  return {
    id: d.id, status: d.status, attempts: d.attempts, lastStatusCode: d.lastStatusCode, lastError: d.lastError, lastAttemptAt: d.lastAttemptAt, nextAttemptAt: d.nextAttemptAt, deliveredAt: d.deliveredAt, createdAt: d.createdAt,
    endpoint: d.endpoint, event: { id: d.event.id, type: d.event.type, createdAt: d.event.createdAt, payload: d.event.payload },
    tries: d.tries.map((t) => ({ attempt: t.attempt, statusCode: t.statusCode, error: t.error, response: t.response, durationMs: t.durationMs, manual: t.manual, at: t.createdAt })),
  }
}

/** Housekeeping for the daily job: old request logs, rate windows, idempotency keys and delivered events. */
export async function pruneDeveloperData(now = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
  await prisma.apiRateWindow.deleteMany({ where: { expiresAt: { lt: now } } })
  await prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: days(30) } } })
  await prisma.idempotencyKey.deleteMany({ where: { scope: { startsWith: 'v1:' }, createdAt: { lt: days(2) } } })
  await prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: days(30) } } })
}
