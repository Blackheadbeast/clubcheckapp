import { Paginated, handler, paging } from '@/lib/api'
import { listDeliveries } from '@/lib/services/webhooks'

export const dynamic = 'force-dynamic'

// GET /api/developer/deliveries?endpointId=&status= - what was sent where, newest first
export const GET = handler({ permission: 'developer.manage' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = paging(query, 20)
  const status = query.get('status')
  const result = await listDeliveries(ownerId, { endpointId: query.get('endpointId'), status: status && ['pending', 'succeeded', 'failed', 'dead'].includes(status) ? status : null, skip, take })
  return new Paginated(result.items, result.total, page, pageSize)
})
