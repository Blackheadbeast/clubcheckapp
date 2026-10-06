import { handler } from '@/lib/api'
import { findMembers } from '@/lib/services/checkin'
import { normalizeMemberStatus } from '@/lib/format'

export const dynamic = 'force-dynamic'

// GET /api/checkin/lookup?q= - as-you-type member search for the front desk
export const GET = handler({ permission: ['attendance.manage', 'members.view', 'pos.sell'] }, async ({ ownerId, query }) => {
  const members = await findMembers(ownerId, query.get('q') || '', 8)
  return members.map((m) => ({ ...m, status: normalizeMemberStatus(m.status) }))
})
