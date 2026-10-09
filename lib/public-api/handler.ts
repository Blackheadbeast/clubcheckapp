// The wrapper every /api/v1 route goes through. It is deliberately separate from the wrapper the
// app's own routes use: a request here is made by outside software holding an API key, not by a
// signed-in person, so who it is, what it may touch and how its answer is shaped are all decided
// here and nowhere else.
//
// In order: a request ID, the key (hashed and looked up, never logged), rate limits for the key and
// for the gym, the scope the route needs, the demo and subscription write gates, the body, and for
// writes an optional Idempotency-Key. Every answer carries the request ID; every request is logged.

import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, readJson } from '@/lib/api'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { createAuditLog } from '@/lib/audit'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { requestHash } from '@/lib/services/idempotency'
import type { ActorRef } from '@/lib/services/core'
import { kickWebhooks } from '@/lib/services/webhooks'
import { hashKey, looksLikeKey } from './keys'
import { DEFAULT_KEY_LIMIT, DEFAULT_PAGE_SIZE, GYM_LIMIT, MAX_PAGE_SIZE, type Scope } from './scopes'

export const API_VERSION = 'v1'
/** Requests a minute from one address that carry no valid key. */
const UNAUTHENTICATED_LIMIT = 60

/** A page of a collection. */
export class Page<T> {
  constructor(public items: T[], public total: number, public page: number, public pageSize: number) {}
}
/** A newly created resource: answered with 201. */
export class Created<T> {
  constructor(public data: T) {}
}

export interface PublicCtx<B = undefined> {
  req: NextRequest
  requestId: string
  ownerId: string
  key: { id: string; name: string; scopes: string[] }
  /** Who the change is recorded as: the key, by name. */
  actor: ActorRef
  body: B
  query: URLSearchParams
  params: Record<string, string>
  hasScope: (scope: Scope) => boolean
  audit: (action: string, description: string, input?: { entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>
}

interface Options<S extends z.ZodTypeAny | undefined> {
  /** The scope the key must hold. null: any valid key. */
  scope: Scope | null
  /** A mutation: refused for the demo gym and a lapsed subscription. */
  write?: boolean
  body?: S
  /** Honour an Idempotency-Key header: a repeat gets the first answer and nothing is done twice. */
  idempotent?: boolean
}

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> }

export function pageOf(query: URLSearchParams) {
  const number = (name: string, fallback: number) => {
    const raw = query.get(name)
    if (raw === null || raw === '') return fallback
    if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) throw new ApiError(400, `${name} must be a whole number of 1 or more.`, 'invalid_parameter')
    return Number(raw)
  }
  const page = number('page', 1)
  // Asking for more than the maximum gets the maximum, and the response says which size was used.
  const pageSize = Math.min(MAX_PAGE_SIZE, number('pageSize', DEFAULT_PAGE_SIZE))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** An ISO date or date-time query parameter, or a clear refusal. */
export function dateParam(query: URLSearchParams, name: string): Date | undefined {
  const raw = query.get(name)
  if (!raw) return undefined
  const date = new Date(raw)
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(date.getTime())) throw new ApiError(400, `${name} must be an ISO 8601 date or date-time, for example 2026-01-31T00:00:00Z.`, 'invalid_parameter')
  return date
}

/** A query parameter that must be one of a few values. */
export function oneOf<T extends string>(query: URLSearchParams, name: string, allowed: readonly T[]): T | undefined {
  const raw = query.get(name)
  if (!raw) return undefined
  if (!allowed.includes(raw as T)) throw new ApiError(400, `${name} must be one of: ${allowed.join(', ')}.`, 'invalid_parameter')
  return raw as T
}

const newRequestId = () => `req_${randomBytes(12).toString('hex')}`

/** Count this request against the key's minute and the gym's minute, in one statement. */
async function countRequest(keyId: string, ownerId: string, keyLimit: number) {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const reset = (minute + 1) * 60
  const expires = new Date((minute + 2) * 60_000)
  const rows = await prisma.$queryRaw<{ id: string; count: number }[]>`
    INSERT INTO "ApiRateWindow" ("id", "count", "expiresAt") VALUES (${`key:${keyId}:${minute}`}, 1, ${expires}), (${`gym:${ownerId}:${minute}`}, 1, ${expires})
    ON CONFLICT ("id") DO UPDATE SET "count" = "ApiRateWindow"."count" + 1 RETURNING "id", "count"`
  const used = (prefix: string) => Number(rows.find((r) => r.id.startsWith(prefix))?.count || 0)
  const key = used('key:')
  const gym = used('gym:')
  // The tighter of the two is what the caller is told about.
  const keyLeft = keyLimit - key
  const gymLeft = GYM_LIMIT - gym
  const byGym = gymLeft < keyLeft
  return { allowed: key <= keyLimit && gym <= GYM_LIMIT, limit: byGym ? GYM_LIMIT : keyLimit, remaining: Math.max(0, Math.min(keyLeft, gymLeft)), reset, retryAfter: Math.max(1, reset - Math.floor(now / 1000)), scope: byGym ? 'gym' : 'key' }
}

export type Stored = { status: number; body: unknown }
const IN_PROGRESS_WAIT_MS = 12_000
const ABANDONED_MS = 90_000

/**
 * Run a write once per Idempotency-Key. The key is claimed before any work is done; a second
 * request with the same key waits for the first to finish and is given its answer. A request that
 * failed releases the key, so the caller can correct it and try again.
 */
export async function once(ownerId: string, scope: string, key: string, hash: string, run: () => Promise<Stored>): Promise<Stored & { replayed: boolean }> {
  const id = `${ownerId}:${scope}:${key}`
  const deadline = Date.now() + IN_PROGRESS_WAIT_MS
  for (;;) {
    const claimed = await prisma.idempotencyKey.createMany({ data: [{ key: id, ownerId, scope, requestHash: hash }], skipDuplicates: true })
    if (claimed.count === 1) break
    const row = await prisma.idempotencyKey.findUnique({ where: { key: id } })
    if (!row) continue // released between the two statements: claim it
    if (row.requestHash !== hash) throw new ApiError(409, 'This Idempotency-Key was already used for a different request.', 'idempotency_key_reused')
    if (row.response !== null) return { ...(row.response as unknown as Stored), replayed: true }
    // Claimed and never finished (the server died mid-request): let this request take it over.
    if (Date.now() - row.createdAt.getTime() > ABANDONED_MS) {
      await prisma.idempotencyKey.deleteMany({ where: { key: id, response: { equals: Prisma.DbNull } } })
      continue
    }
    if (Date.now() > deadline) throw new ApiError(409, 'A request with this Idempotency-Key is still being processed. Try again shortly.', 'request_in_progress')
    await new Promise((r) => setTimeout(r, 150))
  }
  try {
    const result = await run()
    await prisma.idempotencyKey.update({ where: { key: id }, data: { response: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } })
    return { ...result, replayed: false }
  } catch (error) {
    await prisma.idempotencyKey.deleteMany({ where: { key: id } }).catch(() => {})
    throw error
  }
}

export function publicHandler<S extends z.ZodTypeAny | undefined = undefined>(
  opts: Options<S>,
  fn: (ctx: PublicCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx: RouteContext = {}) => {
    const requestId = newRequestId()
    const started = Date.now()
    const headers: Record<string, string> = { 'X-Request-Id': requestId, 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' }
    let ownerId: string | null = null
    let keyId: string | null = null

    const send = async (status: number, body: unknown, errorCode?: string) => {
      // Only requests made with a real key are logged: the log belongs to a gym, and anonymous
      // traffic must not be able to fill the table. Best effort: a logging failure must not turn
      // an answered request into an error.
      if (ownerId) await prisma.apiRequestLog.create({ data: { id: requestId, ownerId, apiKeyId: keyId, method: req.method, path: req.nextUrl.pathname.slice(0, 300), status, errorCode: errorCode || null, durationMs: Date.now() - started } }).catch(() => {})
      return NextResponse.json(body, { status, headers })
    }
    const refuse = (status: number, code: string, message: string, details?: unknown) =>
      send(status, { error: { code, message, requestId, ...(details !== undefined && { details }) } }, code)

    try {
      const given = req.headers.get('authorization') || ''
      const token = given.startsWith('Bearer ') ? given.slice(7).trim() : ''
      // Requests with no usable key are slowed down per address, so guessing is pointless as well as hopeless.
      const stranger = () => {
        const tries = checkRateLimit(`v1-unauthenticated:${getClientIP(req)}`, { windowMs: 60_000, maxRequests: UNAUTHENTICATED_LIMIT })
        if (tries.allowed) return null
        headers['Retry-After'] = String(Math.max(1, Math.ceil((tries.resetAt - Date.now()) / 1000)))
        return refuse(429, 'rate_limited', 'Too many requests without a valid API key. Try again shortly.')
      }
      if (!token) return (await stranger()) || (await refuse(401, 'missing_api_key', 'Send your API key as: Authorization: Bearer <key>.'))
      // Member and staff sessions are JWTs, not API keys, and are never accepted here.
      if (!looksLikeKey(token)) return (await stranger()) || (await refuse(401, 'invalid_api_key', 'That API key is not valid.'))
      const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(token) } })
      if (!key) return (await stranger()) || (await refuse(401, 'invalid_api_key', 'That API key is not valid.'))
      ownerId = key.ownerId
      keyId = key.id
      if (key.revokedAt) return await refuse(401, 'api_key_revoked', 'That API key has been revoked.')
      if (key.expiresAt && key.expiresAt <= new Date()) return await refuse(401, 'api_key_expired', 'That API key has expired.')

      const rate = await countRequest(key.id, key.ownerId, key.rateLimit || DEFAULT_KEY_LIMIT)
      headers['X-RateLimit-Limit'] = String(rate.limit)
      headers['X-RateLimit-Remaining'] = String(rate.remaining)
      headers['X-RateLimit-Reset'] = String(rate.reset)
      if (!rate.allowed) {
        headers['Retry-After'] = String(rate.retryAfter)
        return await refuse(429, 'rate_limited', rate.scope === 'gym' ? 'This gym has reached its API request limit for the minute.' : 'This API key has reached its request limit for the minute.')
      }

      if (opts.scope && !key.scopes.includes(opts.scope)) return await refuse(403, 'insufficient_scope', `This API key does not have the ${opts.scope} scope.`)

      if (opts.write) {
        if (isDemoOwner(key.ownerId)) return await refuse(403, 'demo_read_only', DEMO_READ_ONLY_MESSAGE)
        const access = await requireWriteAccess(key.ownerId)
        if (!access.allowed) return await refuse(403, 'subscription_read_only', access.error)
      }

      let body: unknown = undefined
      if (opts.body) {
        let raw: unknown
        try {
          raw = await readJson(req)
        } catch {
          return await refuse(400, 'invalid_json', 'The request body must be valid JSON.')
        }
        const parsed = opts.body.safeParse(raw)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const path = issue.path.join('.')
          return await refuse(400, 'validation_error', path ? `${path}: ${issue.message}` : issue.message, parsed.error.issues.slice(0, 20).map((i) => ({ field: i.path.join('.'), message: i.message })))
        }
        body = parsed.data
      }

      // Used at most once a minute per key, so reads are not all turned into writes.
      if (!key.lastUsedAt || started - key.lastUsedAt.getTime() > 60_000) await prisma.apiKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: new Date(started) } }).catch(() => {})

      const actor: ActorRef = { type: 'system', id: key.id, name: `API key: ${key.name}` }
      const ctx: PublicCtx<any> = {
        req, requestId, ownerId: key.ownerId, key: { id: key.id, name: key.name, scopes: key.scopes }, actor, body,
        query: req.nextUrl.searchParams,
        params: (await routeCtx.params) || {},
        hasScope: (scope) => key.scopes.includes(scope),
        audit: (action, description, input = {}) =>
          createAuditLog({ action, description, ownerId: key.ownerId, actorType: 'api_key' as never, actorId: key.id, ipAddress: getClientIP(req), userAgent: req.headers.get('user-agent') || undefined, ...input, metadata: { ...input.metadata, requestId, apiKey: key.prefix } }),
      }

      const run = async (): Promise<Stored> => {
        const result = await fn(ctx)
        if (opts.write) kickWebhooks(key.ownerId)
        if (result instanceof Page) return { status: 200, body: { data: result.items, pagination: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)) } } }
        if (result instanceof Created) return { status: 201, body: { data: result.data } }
        return { status: 200, body: { data: result ?? null } }
      }

      const idempotencyKey = opts.idempotent ? req.headers.get('idempotency-key')?.trim() : null
      if (idempotencyKey) {
        if (idempotencyKey.length > 200) return await refuse(400, 'invalid_idempotency_key', 'Idempotency-Key can be at most 200 characters.')
        const done = await once(key.ownerId, `v1:${req.method} ${req.nextUrl.pathname}`, idempotencyKey, requestHash({ body, query: req.nextUrl.search }), run)
        if (done.replayed) headers['Idempotent-Replayed'] = 'true'
        return await send(done.status, done.body)
      }
      const done = await run()
      return await send(done.status, done.body)
    } catch (error) {
      if (error instanceof ApiError) {
        // Service rules speak in the same codes the app uses; a status with no code gets a plain one.
        const code = error.code || (error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : error.status === 403 ? 'forbidden' : 'bad_request')
        return refuse(error.status, code, error.message)
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return refuse(404, 'not_found', 'Not found.')
        if (error.code === 'P2002') return refuse(409, 'conflict', 'A record with those details already exists.')
        if (error.code === 'P2003') return refuse(409, 'in_use', 'That record is still in use.')
      }
      // The detail goes to the server log under the request ID, never to the caller.
      console.error(`[public-api] ${requestId} ${req.method} ${req.nextUrl.pathname} failed:`, error)
      return refuse(500, 'internal_error', 'Something went wrong on our side. Quote the request ID if you contact support.')
    }
  }
}

/** Any other method on a v1 path, and any v1 path that does not exist. */
export function notFoundResponse(req: NextRequest) {
  const requestId = newRequestId()
  return NextResponse.json({ error: { code: 'not_found', message: `No such endpoint: ${req.method} ${req.nextUrl.pathname}`, requestId } }, { status: 404, headers: { 'X-Request-Id': requestId, 'X-API-Version': API_VERSION } })
}
