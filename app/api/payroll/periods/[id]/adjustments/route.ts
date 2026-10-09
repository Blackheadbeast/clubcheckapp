import { handler } from '@/lib/api'
import { addAdjustment, adjustmentSchema } from '@/lib/services/payroll'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

// POST /api/payroll/periods/:id/adjustments - a bonus, deduction or correction. Send an Idempotency-Key so a retry is not a second adjustment.
export const POST = handler({ permission: 'payroll.manage', write: true, body: adjustmentSchema }, async ({ ownerId, params, body, actor, req, audit }) => {
  const key = req.headers.get('idempotency-key')?.trim().slice(0, 200) || null
  const line = await addAdjustment(ownerId, params.id, body, actor, key)
  if (!line.replayed) await audit('payroll.adjustment', `Payroll ${body.type.replace('_', ' ')} of ${formatMoney(line.amountCents)}: ${body.reason}`, { entityType: 'payroll_entry', entityId: line.id, metadata: { staffId: body.staffId, periodId: params.id, amountCents: line.amountCents } })
  return line
})
