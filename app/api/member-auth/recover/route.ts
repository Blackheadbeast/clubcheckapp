import { z } from 'zod'
import { appOrigin, authRoute, sendAccountEmail } from '@/lib/member-auth-http'
import { startRecovery } from '@/lib/member-auth'
import { withinLimit } from '@/lib/login-attempts'

export const dynamic = 'force-dynamic'

// POST /api/member-auth/recover - "forgot password" and "set up my account" in one.
// Always answers the same way, so it cannot be used to find out who is a member.
export const POST = authRoute({ body: z.object({ email: z.string().trim().email('Enter a valid email address').max(200) }), limit: { key: 'member-recover', windowMs: 15 * 60_000, maxRequests: 8 } }, async ({ req, body }) => {
  // At most three of these emails to one address in a quarter of an hour, whoever asks and from
  // wherever. More than that is someone filling an inbox, and each new link cancels the last one.
  // The answer is the same either way.
  if (!(await withinLimit('recover', body.email, 3))) return { ok: true }
  const links = await startRecovery(body.email)
  const origin = appOrigin(req)
  for (const link of links) await sendAccountEmail(link.member, link.member.email, link.type, link.token, origin)
  return { ok: true }
})
