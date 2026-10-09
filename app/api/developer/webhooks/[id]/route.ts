import { z } from 'zod'
import { handler } from '@/lib/api'
import { deleteEndpoint, endpointUpdateSchema, rollSecret, sendTestEvent, updateEndpoint } from '@/lib/services/webhooks'

export const dynamic = 'force-dynamic'

// PATCH /api/developer/webhooks/:id - change the URL, description or events, or switch it on or off
export const PATCH = handler({ permission: 'developer.manage', write: true, body: endpointUpdateSchema }, async ({ ownerId, params, body, audit }) => {
  const endpoint = await updateEndpoint(ownerId, params.id, body)
  await audit('webhook.update', `Updated webhook endpoint ${endpoint.url}`, { entityType: 'webhook_endpoint', entityId: endpoint.id, metadata: { isActive: endpoint.isActive, events: endpoint.events } })
  return endpoint
})

// POST /api/developer/webhooks/:id - { action: "test" } sends a test event now; { action: "roll_secret" } replaces the signing secret
export const POST = handler({ permission: 'developer.manage', write: true, body: z.object({ action: z.enum(['test', 'roll_secret']) }), rateLimit: { key: 'webhook-action', windowMs: 60_000, maxRequests: 30 } }, async ({ ownerId, params, body, audit }) => {
  if (body.action === 'test') return { delivery: await sendTestEvent(ownerId, params.id) }
  const rolled = await rollSecret(ownerId, params.id)
  await audit('webhook.roll_secret', `Replaced the signing secret for ${rolled.url}`, { entityType: 'webhook_endpoint', entityId: rolled.id })
  return rolled
})

export const DELETE = handler({ permission: 'developer.manage', write: true }, async ({ ownerId, params, audit }) => {
  const result = await deleteEndpoint(ownerId, params.id)
  await audit('webhook.delete', 'Removed a webhook endpoint', { entityType: 'webhook_endpoint', entityId: params.id })
  return result
})
