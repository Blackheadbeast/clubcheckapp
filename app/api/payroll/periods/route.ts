import { handler } from '@/lib/api'
import { createPeriod, listPeriods, periodCreateSchema } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// GET /api/payroll/periods - every pay period with its totals
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, can }) => ({ ...(await listPeriods(ownerId)), can: { manage: can('payroll.manage'), reopen: can('payroll.reopen') } }))

// POST /api/payroll/periods - open a new pay period
export const POST = handler({ permission: 'payroll.manage', write: true, body: periodCreateSchema }, async ({ ownerId, body, actor, audit }) => {
  const period = await createPeriod(ownerId, body, actor)
  await audit('payroll.period_create', `Created pay period ${period.name}`, { entityType: 'payroll_period', entityId: period.id })
  return period
})
