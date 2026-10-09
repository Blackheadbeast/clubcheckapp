// Member portal API plumbing. Every route here acts on exactly one member, and
// that member is always worked out on the server:
//   /api/portal/me/...      the signed-in member: the member-session cookie in a browser,
//                           or `Authorization: Bearer <session>` from a native app
//   /api/portal/<token>/... the long random link sent by the gym, which only
//                           works until the member sets up a sign-in account
// No route takes a member id from the request.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, fail, readJson } from '@/lib/api'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { MEMBER_PORTAL_RATE_LIMIT, checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { MEMBER_COOKIE, resolveMemberSession } from '@/lib/member-auth'
import { sameOrigin } from '@/lib/member-auth-http'

export interface PortalCtx<B> {
  req: NextRequest
  member: Member
  ownerId: string
  body: B
  params: Record<string, string>
  actor: { type: 'member'; id: string; name: string }
  /** How the member proved who they are. */
  via: 'session' | 'link'
}

export function bearerToken(req: NextRequest) {
  const header = req.headers.get('authorization') || ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() || null : null
}

export function portalHandler<S extends z.ZodTypeAny | undefined = undefined>(
  opts: { write?: boolean; body?: S },
  fn: (ctx: PortalCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx: { params: Record<string, string> | Promise<Record<string, string>> }) => {
    try {
      const params = await routeCtx.params
      // Per address this is only a flood guard: a whole gym shares one Wi-Fi address, so the
      // limit that matters is the per-member one applied once we know who is asking.
      const limit = checkRateLimit(`portal:${getClientIP(req)}`, { ...MEMBER_PORTAL_RATE_LIMIT, maxRequests: 1200 })
      if (!limit.allowed) return fail(429, 'Too many requests. Please wait a moment.', 'rate_limited')

      const token = params.token || ''
      let member: Member | null
      const via: 'session' | 'link' = token === 'me' ? 'session' : 'link'
      if (via === 'session') {
        const bearer = bearerToken(req)
        member = await resolveMemberSession(bearer || req.cookies.get(MEMBER_COOKIE)?.value)
        if (!member) return fail(401, 'Please sign in to continue.', 'signed_out')
        // A cookie is sent automatically, so a cookie-authenticated write must come from our own
        // pages. A bearer token is attached deliberately by the app, so it needs no such check.
        if (!bearer && req.method !== 'GET' && !sameOrigin(req)) return fail(403, 'This request did not come from ClubCheck.', 'bad_origin')
      } else {
        member = token.length >= 32 ? await prisma.member.findFirst({ where: { accessToken: token, accessTokenExpiry: { gt: new Date() } } }) : null
        if (!member || member.archivedAt) return fail(404, 'This link is no longer valid. Ask the front desk for a new one.', 'invalid_token')
        // Once a member has a password, the emailed link alone no longer opens their account.
        const hasAccount = await prisma.memberAccount.findUnique({ where: { memberId: member.id }, select: { id: true } })
        if (hasAccount) return fail(401, 'Please sign in to your account.', 'account_required')
      }

      const own = checkRateLimit(`portal-member:${member.id}`, { ...MEMBER_PORTAL_RATE_LIMIT, maxRequests: 120 })
      if (!own.allowed) return fail(429, 'Too many requests. Please wait a moment.', 'rate_limited')

      if (opts.write) {
        if (isDemoOwner(member.ownerId)) return fail(403, DEMO_READ_ONLY_MESSAGE, 'demo_read_only')
        const access = await requireWriteAccess(member.ownerId)
        if (!access.allowed) return fail(503, 'Online booking is unavailable right now. Please contact the gym.', 'unavailable')
      }

      let body: unknown
      if (opts.body) {
        const parsed = opts.body.safeParse(await readJson(req).catch(() => null))
        if (!parsed.success) return fail(400, parsed.error.issues[0].message, 'validation_error')
        body = parsed.data
      }
      const result = await fn({ req, member, ownerId: member.ownerId, body: body as any, params, via, actor: { type: 'member', id: member.id, name: member.name } })
      if (opts.write) (await import('@/lib/services/webhooks')).kickWebhooks(member.ownerId)
      if (result instanceof Response) return result
      return NextResponse.json({ data: result ?? null }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code, error.details)
      console.error(`[portal] ${req.method} ${req.nextUrl.pathname.replace(/[a-f0-9]{32,}/, ':token')} failed:`, error)
      return fail(500, 'Something went wrong. Please try again.', 'internal_error')
    }
  }
}
