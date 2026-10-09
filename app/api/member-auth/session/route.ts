import { prisma } from '@/lib/prisma'
import { authRoute } from '@/lib/member-auth-http'
import { MEMBER_COOKIE, resolveMemberSession } from '@/lib/member-auth'

import { bearerToken } from '@/lib/portal'

export const dynamic = 'force-dynamic'

// GET /api/member-auth/session - who is signed in (never an error: signed out is an answer)
export const GET = authRoute({}, async ({ req }) => {
  const member = await resolveMemberSession(bearerToken(req) || req.cookies.get(MEMBER_COOKIE)?.value)
  if (!member) return { authenticated: false }
  const profile = await prisma.gymProfile.findUnique({ where: { ownerId: member.ownerId }, select: { name: true } })
  return { authenticated: true, name: member.name, email: member.email, gymName: profile?.name || null }
})
