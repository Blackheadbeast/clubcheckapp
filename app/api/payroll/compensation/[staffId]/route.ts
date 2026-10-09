import { handler } from '@/lib/api'
import { compensationSchema, saveCompensation } from '@/lib/services/payroll-config'

export const dynamic = 'force-dynamic'

// PUT /api/payroll/compensation/:staffId - set one person's pay and commission plan
export const PUT = handler({ permission: 'payroll.manage', write: true, body: compensationSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await saveCompensation(ownerId, params.staffId, body, actor)
  await audit('payroll.compensation', 'Changed staff compensation', { entityType: 'staff', entityId: params.staffId })
  return result
})
