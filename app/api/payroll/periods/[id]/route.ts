import { handler } from '@/lib/api'
import { periodAction, periodActionSchema, periodDetail } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// GET /api/payroll/periods/:id?locationId= - one period: what each person earned
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, params, query, can }) => ({
  ...(await periodDetail(ownerId, params.id, { locationId: query.get('locationId') })),
  can: { manage: can('payroll.manage'), reopen: can('payroll.reopen') },
}))

// POST /api/payroll/periods/:id { action: "sync" | "submit" | "send_back" | "approve" | "finalize" | "reopen" }
export const POST = handler({ permission: 'payroll.manage', write: true, body: periodActionSchema }, async ({ ownerId, params, body, actor, can, audit }) => {
  const result = await periodAction(ownerId, params.id, body, actor, { reopen: can('payroll.reopen') })
  if (body.action !== 'sync' && result.changed) await audit(`payroll.period_${body.action}`, `Pay period ${body.action.replace('_', ' ')}`, { entityType: 'payroll_period', entityId: params.id, ...(body.action === 'reopen' && { metadata: { reason: body.reason } }) })
  return result
})
