import { z } from 'zod'
import { authRoute } from '@/lib/member-auth-http'
import { confirmEmail } from '@/lib/member-auth'

export const dynamic = 'force-dynamic'

// POST /api/member-auth/verify-email - confirm a new address from the emailed link
export const POST = authRoute({ body: z.object({ token: z.string().min(20).max(200) }), limit: { key: 'member-verify', windowMs: 10 * 60_000, maxRequests: 30 } }, async ({ body }) => {
  const result = await confirmEmail(body.token)
  return { email: result.email }
})
