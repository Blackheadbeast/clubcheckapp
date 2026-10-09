import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { membershipOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'memberships:read' }, async ({ ownerId, params }) => {
  const membership = await prisma.membership.findFirst({ where: { id: params.id, ownerId }, include: { plan: true } })
  if (!membership) throw notFound('Membership')
  return membershipOut(membership)
})
