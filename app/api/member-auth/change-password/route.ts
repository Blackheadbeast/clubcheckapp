import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fail } from '@/lib/api'
import { authRoute } from '@/lib/member-auth-http'
import { MEMBER_COOKIE, changePassword, resolveMemberSession, sessionCookie } from '@/lib/member-auth'

import { bearerToken } from '@/lib/portal'

export const dynamic = 'force-dynamic'

const schema = z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword: z.string().min(1, 'Choose a new password').max(200) })

// POST /api/member-auth/change-password - signs out other devices, keeps this one
export const POST = authRoute({ body: schema, limit: { key: 'member-change-password', windowMs: 10 * 60_000, maxRequests: 10 } }, async ({ req, body }) => {
  const member = await resolveMemberSession(bearerToken(req) || req.cookies.get(MEMBER_COOKIE)?.value)
  if (!member) return fail(401, 'Please sign in again.', 'signed_out')
  const token = await changePassword(member, body.currentPassword, body.newPassword)
  if (bearerToken(req)) return { ok: true, token }
  const response = NextResponse.json({ data: { ok: true } })
  response.cookies.set(sessionCookie(token))
  return response
})
