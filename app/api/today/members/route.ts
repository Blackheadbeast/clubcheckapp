import { handler } from '@/lib/api'
import { lookupMembers } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

// GET /api/today/members?q= - fast member lookup by name, email, phone, member id or scanned code
export const GET = handler({ permission: 'members.view', rateLimit: { key: 'member-lookup', windowMs: 60_000, maxRequests: 240 } }, async ({ ownerId, query, can }) => {
  const q = (query.get('q') || '').trim()
  if (q.length < 2) return []
  // What someone owes is only shown to roles that can see billing.
  return lookupMembers(ownerId, q, { withBalance: can('billing.view') })
})
