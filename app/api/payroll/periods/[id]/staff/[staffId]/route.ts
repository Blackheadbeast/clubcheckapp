import { handler } from '@/lib/api'
import { staffLines } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// GET /api/payroll/periods/:id/staff/:staffId - every ledger line for one person in one period
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, params }) => staffLines(ownerId, params.id, params.staffId))
