import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { loginMember } from '@/lib/member-auth'
import { bookingRoute, tokenFor } from '@/lib/public-booking/http'
import { viewerOut } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// POST { email, password } - sign in as a member of this gym. The same accounts, passwords and
// lock-outs as the member app; the answer is a token that only the booking endpoints accept.
export const POST = bookingRoute({ limit: 'login', body: z.object({ email: z.string().trim().max(200), password: z.string().min(1).max(200) }) }, async ({ site, body }) => {
  const result = await loginMember(body.email, body.password, site.ownerId)
  if (result.status !== 'ok' || !result.member || result.member.ownerId !== site.ownerId) throw new ApiError(401, 'That email or password is not right.', 'invalid_credentials')
  const viewer = { member: result.member, hasAccount: true }
  return { viewer: viewerOut(viewer), token: await tokenFor(viewer) }
})

// GET - who this page is signed in as, with a fresh token
export const GET = bookingRoute({ limit: 'read', viewer: 'optional' }, async ({ viewer }) => {
  if (!viewer) return { viewer: null, token: null }
  // Keep the member row honest if it changed since the token was issued.
  const member = await prisma.member.findUniqueOrThrow({ where: { id: viewer.member.id } })
  return { viewer: viewerOut({ ...viewer, member }), token: await tokenFor(viewer) }
})
