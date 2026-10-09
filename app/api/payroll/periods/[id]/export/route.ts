import { handler } from '@/lib/api'
import { csvResponse } from '@/lib/csv'
import { exportPeriod } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// GET /api/payroll/periods/:id/export?format=summary|detail - CSV for the accountant or a payroll provider
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, params, query, actor, audit }) => {
  const format = query.get('format') === 'detail' ? 'detail' : 'summary'
  const file = await exportPeriod(ownerId, params.id, format, actor)
  await audit('payroll.export', `Exported payroll (${format})`, { entityType: 'payroll_period', entityId: params.id })
  return csvResponse(file.filename, file.headers, file.rows)
})
