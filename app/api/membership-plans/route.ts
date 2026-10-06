import { prisma } from '@/lib/prisma'
import { assertAllOwned, badRequest, handler } from '@/lib/api'
import { planSchema } from '@/lib/schemas'
import { LIVE_STATUSES } from '@/lib/services/memberships'
import type { z } from 'zod'

export const dynamic = 'force-dynamic'

/** Keep a plan's fields consistent with its type so billing never sees a contradictory plan. */
function normalize(plan: z.infer<typeof planSchema>) {
  const recurring = plan.type === 'recurring'
  const creditBased = ['class_pack', 'drop_in', 'pt_package'].includes(plan.type)
  if (creditBased && !plan.credits && plan.type !== 'drop_in') throw badRequest('Set how many sessions this pack includes.')
  if (recurring && plan.billingInterval === 'once') throw badRequest('Recurring memberships need a weekly, monthly or yearly interval.')
  return {
    ...plan,
    priceCents: plan.type === 'free' ? 0 : plan.priceCents,
    billingInterval: recurring ? plan.billingInterval : 'once',
    intervalCount: recurring ? plan.intervalCount : 1,
    trialDays: recurring || plan.type === 'trial' ? plan.trialDays : 0,
    contractMonths: recurring ? plan.contractMonths : 0,
    enrollmentFeeCents: recurring ? plan.enrollmentFeeCents : 0,
    classLimit: recurring ? plan.classLimit ?? null : null,
    credits: creditBased ? plan.credits ?? 1 : plan.type === 'trial' ? plan.credits ?? null : null,
    expiresAfterDays: recurring || plan.type === 'free' ? null : plan.expiresAfterDays ?? null,
    autoRenew: recurring ? plan.autoRenew : false,
  }
}

export const GET = handler({ permission: ['members.view', 'memberships.manage'] }, async ({ ownerId, query }) => {
  const plans = await prisma.membershipPlan.findMany({
    where: { ownerId, ...(query.get('active') === '1' && { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  const counts = await prisma.membership.groupBy({ by: ['planId'], where: { ownerId, status: { in: LIVE_STATUSES } }, _count: { _all: true } })
  const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]))
  return plans.map((p) => ({ ...p, activeMembers: byPlan.get(p.id) || 0 }))
})

export const POST = handler({ permission: 'settings.manage', write: true, body: planSchema }, async ({ ownerId, body, audit }) => {
  await assertAllOwned(ownerId, 'location', body.locationIds, 'Location')
  await assertAllOwned(ownerId, 'classType', body.classTypeIds, 'Class')
  const plan = await prisma.membershipPlan.create({ data: { ownerId, ...normalize(body) } })
  await audit('plan.create', `Created membership plan ${plan.name}`, { entityType: 'membershipPlan', entityId: plan.id, after: plan })
  return plan
})
