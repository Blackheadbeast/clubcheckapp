import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { intervalLabel } from '@/lib/services/memberships'

export const dynamic = 'force-dynamic'

// GET - recurring plans the gym offers publicly, for a member choosing a different membership
export const GET = portalHandler({}, async ({ ownerId }) => {
  const plans = await prisma.membershipPlan.findMany({
    where: { ownerId, isActive: true, isPublic: true, type: 'recurring' },
    orderBy: { priceCents: 'asc' },
    select: { id: true, name: true, description: true, priceCents: true, type: true, billingInterval: true, intervalCount: true, classLimit: true, classLimitPeriod: true },
  })
  return plans.map((p) => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents, interval: intervalLabel(p), classLimit: p.classLimit, classLimitPeriod: p.classLimitPeriod }))
})
