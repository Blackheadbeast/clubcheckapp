import { handler } from '@/lib/api'
import { householdOf } from '@/lib/services/households'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/household - the household this member is billed with, or null
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, params, can }) => {
  const household = await householdOf(ownerId, params.id)
  return { household, canManage: can('billing.households') }
})
