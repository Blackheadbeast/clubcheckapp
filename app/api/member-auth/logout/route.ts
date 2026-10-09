import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authRoute } from '@/lib/member-auth-http'
import { MEMBER_COOKIE, clearedCookie, resolveMemberSession, revokeSessions } from '@/lib/member-auth'

import { bearerToken } from '@/lib/portal'

export const dynamic = 'force-dynamic'

// POST /api/member-auth/logout  { everywhere?: true } also ends sessions on other devices
export const POST = authRoute({ body: z.object({ everywhere: z.boolean().optional() }).nullish().transform((v) => v || {}) }, async ({ req, body }) => {
  if (body.everywhere) {
    const member = await resolveMemberSession(bearerToken(req) || req.cookies.get(MEMBER_COOKIE)?.value)
    if (member) await revokeSessions(member.id)
  }
  const response = NextResponse.json({ data: { ok: true } })
  response.cookies.set(clearedCookie())
  return response
})
