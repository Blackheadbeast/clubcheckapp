import { prisma } from '@/lib/prisma'
import { ApiError, assertAllOwned, handler, notFound } from '@/lib/api'
import { planSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

// Editing a plan changes what new sales and future renewals of *new* memberships cost.
// Existing memberships keep the price they were sold at (Membership.priceCents).
export const PATCH = handler({ permission: 'settings.manage', write: true, body: planSchema.partial() }, async ({ ownerId, params, body, audit }) => {
  const before = await prisma.membershipPlan.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Membership plan')
  if (body.type && body.type !== before.type) {
    const sold = await prisma.membership.count({ where: { planId: before.id } })
    if (sold > 0) throw new ApiError(409, 'This plan has been sold, so its type can no longer change. Create a new plan instead.', 'plan_in_use')
  }
  await assertAllOwned(ownerId, 'location', body.locationIds, 'Location')
  await assertAllOwned(ownerId, 'classType', body.classTypeIds, 'Class')
  const plan = await prisma.membershipPlan.update({ where: { id: before.id }, data: body })
  await audit('plan.update', `Updated membership plan ${plan.name}`, { entityType: 'membershipPlan', entityId: plan.id, before, after: plan })
  return plan
})

export const DELETE = handler({ permission: 'settings.manage', write: true }, async ({ ownerId, params, audit }) => {
  const plan = await prisma.membershipPlan.findFirst({ where: { id: params.id, ownerId } })
  if (!plan) throw notFound('Membership plan')
  const sold = await prisma.membership.count({ where: { planId: plan.id } })
  if (sold > 0) {
    // Keep history intact: retire the plan instead of deleting it.
    await prisma.membershipPlan.update({ where: { id: plan.id }, data: { isActive: false } })
    await audit('plan.archive', `Retired membership plan ${plan.name}`, { entityType: 'membershipPlan', entityId: plan.id })
    return { deleted: false, archived: true }
  }
  await prisma.membershipPlan.delete({ where: { id: plan.id } })
  await audit('plan.delete', `Deleted membership plan ${plan.name}`, { entityType: 'membershipPlan', entityId: plan.id, before: plan })
  return { deleted: true, archived: false }
})
