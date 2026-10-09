import { handler } from '@/lib/api'
import { createPlan, listPlans, planSchema } from '@/lib/services/payroll-config'

export const dynamic = 'force-dynamic'

// GET /api/payroll/commission-plans
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, can }) => ({ ...(await listPlans(ownerId)), can: { manage: can('payroll.manage') } }))

// POST /api/payroll/commission-plans
export const POST = handler({ permission: 'payroll.manage', write: true, body: planSchema }, async ({ ownerId, body, actor, audit }) => {
  const plan = await createPlan(ownerId, body, actor)
  await audit('payroll.plan_create', `Created commission plan ${body.name}`, { entityType: 'commission_plan', entityId: plan.id })
  return plan
})
