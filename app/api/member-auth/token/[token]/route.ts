import { authRoute } from '@/lib/member-auth-http'
import { describeToken } from '@/lib/member-auth'

export const dynamic = 'force-dynamic'

// GET /api/member-auth/token/:token - is this link still good, and who is it for?
export const GET = authRoute({ limit: { key: 'member-token', windowMs: 10 * 60_000, maxRequests: 60 } }, async ({ params }) => describeToken(params.token))
