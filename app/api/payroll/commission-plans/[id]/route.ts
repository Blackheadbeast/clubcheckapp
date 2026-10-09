import { handler } from '@/lib/api'
import { planSchema, updatePlan } from '@/lib/services/payroll-config'

export const dynamic = 'force-dynamic'

// PUT /api/payroll/commission-plans/:id - replace a plan's name and rules, or archive it. Applies to what is earned from now on.
export const PUT = handler({ permission: 'payroll.manage', write: true, body: planSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const plan = await updatePlan(ownerId, params.id, body, actor)
  await audit('payroll.plan_update', `Changed commission plan ${body.name}`, { entityType: 'commission_plan', entityId: plan.id })
  return plan
})
