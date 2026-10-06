// Member portal API plumbing. Members are identified by the long random access
// token in their portal link (no staff session), so every route here resolves
// the member from that token and can only ever act on that one member.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, fail } from '@/lib/api'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { MEMBER_PORTAL_RATE_LIMIT, checkRateLimit, getClientIP } from '@/lib/rate-limit'

export interface PortalCtx<B> {
  req: NextRequest
  member: Member
  ownerId: string
  body: B
  params: Record<string, string>
  actor: { type: 'member'; id: string; name: string }
}

export function portalHandler<S extends z.ZodTypeAny | undefined = undefined>(
  opts: { write?: boolean; body?: S },
  fn: (ctx: PortalCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx: { params: Record<string, string> | Promise<Record<string, string>> }) => {
    try {
      const params = await routeCtx.params
      const limit = checkRateLimit(`portal:${getClientIP(req)}`, { ...MEMBER_PORTAL_RATE_LIMIT, maxRequests: 60 })
      if (!limit.allowed) return fail(429, 'Too many requests. Please wait a moment.', 'rate_limited')

      const token = params.token || ''
      const member = token.length >= 32 ? await prisma.member.findFirst({ where: { accessToken: token, accessTokenExpiry: { gt: new Date() } } }) : null
      if (!member || member.archivedAt) return fail(404, 'This link is no longer valid. Ask the front desk for a new one.', 'invalid_token')

      if (opts.write) {
        if (isDemoOwner(member.ownerId)) return fail(403, DEMO_READ_ONLY_MESSAGE, 'demo_read_only')
        const access = await requireWriteAccess(member.ownerId)
        if (!access.allowed) return fail(503, 'Online booking is unavailable right now. Please contact the gym.', 'unavailable')
      }

      let body: unknown
      if (opts.body) {
        const parsed = opts.body.safeParse(await req.json().catch(() => null))
        if (!parsed.success) return fail(400, parsed.error.issues[0].message, 'validation_error')
        body = parsed.data
      }
      const result = await fn({ req, member, ownerId: member.ownerId, body: body as any, params, actor: { type: 'member', id: member.id, name: member.name } })
      if (result instanceof Response) return result
      return NextResponse.json({ data: result ?? null }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code, error.details)
      console.error(`[portal] ${req.method} ${req.nextUrl.pathname.replace(/[a-f0-9]{32,}/, ':token')} failed:`, error)
      return fail(500, 'Something went wrong. Please try again.', 'internal_error')
    }
  }
}
