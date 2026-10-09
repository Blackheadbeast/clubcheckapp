import { handler } from '@/lib/api'
import { addTime, timeSchema } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// POST /api/payroll/periods/:id/time - hours worked by someone paid hourly
export const POST = handler({ permission: 'payroll.manage', write: true, body: timeSchema }, async ({ ownerId, params, body, actor }) => addTime(ownerId, params.id, body, actor))
