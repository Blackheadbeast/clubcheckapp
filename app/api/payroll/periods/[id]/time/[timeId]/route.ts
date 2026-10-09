import { handler } from '@/lib/api'
import { voidTime } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// DELETE /api/payroll/periods/:id/time/:timeId - take back hours entered by mistake (adds a cancelling line; nothing is erased)
export const DELETE = handler({ permission: 'payroll.manage', write: true }, async ({ ownerId, params, actor }) => voidTime(ownerId, params.id, params.timeId, actor))
