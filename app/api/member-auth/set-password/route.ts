import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authRoute, wantsToken } from '@/lib/member-auth-http'
import { SESSION_DAYS, sessionCookie, setPasswordWithToken } from '@/lib/member-auth'

export const dynamic = 'force-dynamic'

const schema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1, 'Choose a password').max(200) })

// POST /api/member-auth/set-password - finish an invitation or a password reset, and sign in
export const POST = authRoute({ body: schema, limit: { key: 'member-set-password', windowMs: 10 * 60_000, maxRequests: 20 } }, async ({ req, body }) => {
  const result = await setPasswordWithToken(body.token, body.password)
  if (wantsToken(req)) return { status: 'ok', activated: result.activated, token: result.sessionToken, expiresInDays: SESSION_DAYS }
  const response = NextResponse.json({ data: { status: 'ok', activated: result.activated } }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(sessionCookie(result.sessionToken))
  return response
})
