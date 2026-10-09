import { handler } from '@/lib/api'
import { deliveryDetail, retryDelivery } from '@/lib/services/webhooks'

export const dynamic = 'force-dynamic'

// GET /api/developer/deliveries/:id - the payload and every attempt
export const GET = handler({ permission: 'developer.manage' }, async ({ ownerId, params }) => deliveryDetail(ownerId, params.id))

// POST /api/developer/deliveries/:id - send it again now: the same event, the same payload
export const POST = handler({ permission: 'developer.manage', write: true, rateLimit: { key: 'webhook-retry', windowMs: 60_000, maxRequests: 60 } }, async ({ ownerId, params, audit }) => {
  const delivery = await retryDelivery(ownerId, params.id)
  await audit('webhook.retry', `Retried webhook delivery (${delivery.event.type})`, { entityType: 'webhook_delivery', entityId: delivery.id, metadata: { status: delivery.status } })
  return delivery
})
