import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authRoute, wantsToken } from '@/lib/member-auth-http'
import { SESSION_DAYS, loginMember, sessionCookie } from '@/lib/member-auth'

export const dynamic = 'force-dynamic'

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
  gymId: z.string().uuid().nullish(),
})

// POST /api/member-auth/login
export const POST = authRoute({ body: schema, limit: { key: 'member-login', windowMs: 10 * 60_000, maxRequests: 20 } }, async ({ req, body }) => {
  const result = await loginMember(body.email, body.password, body.gymId)
  if (result.status === 'choose_gym') return { status: 'choose_gym', gyms: result.gyms }
  if (wantsToken(req)) return { status: 'ok', token: result.sessionToken!, expiresInDays: SESSION_DAYS }
  const response = NextResponse.json({ data: { status: 'ok' } }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(sessionCookie(result.sessionToken!))
  return response
})
