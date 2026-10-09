// The wrapper every public booking endpoint goes through.
//
// These endpoints are open to the internet, so each one: finds the gym from the public address
// (and answers "not available" identically for an unknown or switched-off page), is rate limited
// per caller, works out who the caller is only from a token this layer issued or the member's own
// same-site session, and answers errors in plain words with nothing internal in them.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, readJson } from '@/lib/api'
import { isDemoOwner } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { MEMBER_COOKIE, resolveMemberSession } from '@/lib/member-auth'
import { appOrigin, sameOrigin } from '@/lib/member-auth-http'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { once, type Stored } from '@/lib/public-api/handler'
import { requestHash } from '@/lib/services/idempotency'
import { kickWebhooks } from '@/lib/services/webhooks'
import { resolveSite, type SiteCtx, type Viewer } from '@/lib/services/public-booking'
import { readBookingSession, signBookingSession } from './tokens'

/** Requests a minute from one address, by how costly or abusable the endpoint is. */
export const LIMITS = {
  read: { windowMs: 60_000, maxRequests: 120 },
  availability: { windowMs: 60_000, maxRequests: 60 },
  book: { windowMs: 60_000, maxRequests: 12 },
  identify: { windowMs: 10 * 60_000, maxRequests: 8 },
  login: { windowMs: 10 * 60_000, maxRequests: 10 },
} as const

export interface BookingCtx<B = undefined> {
  req: NextRequest
  site: SiteCtx
  viewer: Viewer | null
  body: B
  query: URLSearchParams
  params: Record<string, string>
  origin: string
}

interface Options<S extends z.ZodTypeAny | undefined> {
  limit: keyof typeof LIMITS
  /** required: 401 unless the caller is a known member or guest. */
  viewer?: 'optional' | 'required'
  /** A change: refused when the gym's account cannot be written to. */
  write?: boolean
  body?: S
  /** Honour an Idempotency-Key header, so a double tap or a retry books and charges once. */
  idempotent?: boolean
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers } })
const fail = (status: number, error: string, code: string, details?: unknown, headers?: Record<string, string>) => json(status, { error, code, ...(details !== undefined && { details }) }, headers)

/** Who is calling: a booking token from this layer, or the member's own session on this site. Anything else is nobody. */
export async function resolveViewer(req: NextRequest, site: SiteCtx): Promise<Viewer | null> {
  const header = req.headers.get('authorization') || ''
  if (header.startsWith('Bearer ')) {
    const session = await readBookingSession(header.slice(7).trim())
    // A token for another gym's page is not a token for this one.
    if (!session || session.ownerId !== site.ownerId) return null
    const member = await prisma.member.findFirst({ where: { id: session.memberId, ownerId: site.ownerId, archivedAt: null }, include: { account: { select: { sessionVersion: true } } } })
    if (!member) return null
    const { account, ...row } = member
    // A guest token dies the moment that person has an account; an account token dies when the password changes.
    if (session.sessionVersion === null) return account ? null : { member: row, hasAccount: false }
    return account && account.sessionVersion === session.sessionVersion ? { member: row, hasAccount: true } : null
  }
  // The member-app cookie, only for requests from this site itself (never from inside someone else's page).
  const cookie = req.cookies.get(MEMBER_COOKIE)?.value
  if (cookie && sameOrigin(req) && req.headers.get('sec-fetch-site') !== 'cross-site') {
    const member = await resolveMemberSession(cookie)
    if (member && member.ownerId === site.ownerId) return { member, hasAccount: true }
  }
  return null
}

/** A fresh booking token for a viewer, to hold in the page. */
export async function tokenFor(viewer: Viewer) {
  const account = viewer.hasAccount ? await prisma.memberAccount.findUnique({ where: { memberId: viewer.member.id }, select: { sessionVersion: true } }) : null
  return signBookingSession({ ownerId: viewer.member.ownerId, memberId: viewer.member.id, sessionVersion: account ? account.sessionVersion : null })
}

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> }

export function bookingRoute<S extends z.ZodTypeAny | undefined = undefined>(
  opts: Options<S>,
  fn: (ctx: BookingCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx: RouteContext = {}) => {
    try {
      const params = (await routeCtx.params) || {}
      const limit = LIMITS[opts.limit]
      const ip = getClientIP(req)
      const allowed = checkRateLimit(`book:${opts.limit}:${ip}`, limit)
      if (!allowed.allowed) return fail(429, 'Too many requests. Please wait a moment and try again.', 'rate_limited', undefined, { 'Retry-After': String(Math.max(1, Math.ceil((allowed.resetAt - Date.now()) / 1000))) })

      const site = await resolveSite(params.slug || '')
      if (opts.write) {
        // The demo gym and a lapsed subscription cannot take bookings; the customer is told only that booking is off.
        const access = isDemoOwner(site.ownerId) ? { allowed: false as const } : await requireWriteAccess(site.ownerId)
        if (!access.allowed) return fail(409, 'Online booking is not available right now. Please contact us to book.', 'unavailable')
      }
      const viewer = opts.viewer ? await resolveViewer(req, site) : null
      if (opts.viewer === 'required' && !viewer) return fail(401, 'Please sign in or enter your details to continue.', 'sign_in_required')

      let body: unknown = undefined
      if (opts.body) {
        const parsed = opts.body.safeParse(await readJson(req).catch(() => null))
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          return fail(400, issue.message, 'validation_error', { field: issue.path.join('.') })
        }
        body = parsed.data
      }
      const ctx: BookingCtx<any> = { req, site, viewer, body, query: req.nextUrl.searchParams, params, origin: appOrigin(req) }
      const run = async (): Promise<Stored> => {
        const result = await fn(ctx)
        if (opts.write) kickWebhooks(site.ownerId)
        return { status: 200, body: { data: result ?? null } }
      }
      const key = opts.idempotent ? req.headers.get('idempotency-key')?.trim() : null
      if (key && key.length <= 200 && viewer) {
        // Scoped to the person as well as the gym, so nobody can read another customer's stored answer.
        const done = await once(site.ownerId, `book:${req.nextUrl.pathname}:${viewer.member.id}`, key, requestHash({ body }), run)
        return json(done.status, done.body, done.replayed ? { 'Idempotent-Replayed': 'true' } : {})
      }
      const result = await fn(ctx)
      if (opts.write) kickWebhooks(site.ownerId)
      if (result instanceof Response) return result
      return json(200, { data: result ?? null })
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code || 'error', ['class_full', 'documents_required', 'fields_incomplete'].includes(error.code || '') ? error.details : undefined)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return fail(409, 'That was just taken. Please choose again.', 'conflict')
      console.error(`[online-booking] ${req.method} ${req.nextUrl.pathname} failed:`, error)
      return fail(500, 'Something went wrong on our side. Please try again.', 'internal_error')
    }
  }
}
