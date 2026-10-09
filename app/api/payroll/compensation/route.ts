import { handler } from '@/lib/api'
import { listCompensation } from '@/lib/services/payroll-config'

export const dynamic = 'force-dynamic'

// GET /api/payroll/compensation - how each staff member is paid
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, can }) => ({ ...(await listCompensation(ownerId)), can: { manage: can('payroll.manage') } }))
