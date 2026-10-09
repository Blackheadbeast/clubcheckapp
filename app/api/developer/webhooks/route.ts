import { handler } from '@/lib/api'
import { MAX_ATTEMPTS, RETRY_AFTER_SEC, WEBHOOK_EVENTS, createEndpoint, endpointSchema, listEndpoints } from '@/lib/services/webhooks'

export const dynamic = 'force-dynamic'

// GET /api/developer/webhooks - endpoints (never their secrets) and the event catalogue
export const GET = handler({ permission: 'developer.manage' }, async ({ ownerId }) => ({
  endpoints: await listEndpoints(ownerId),
  events: Object.entries(WEBHOOK_EVENTS).map(([type, description]) => ({ type, description })),
  retries: { attempts: MAX_ATTEMPTS, afterSeconds: RETRY_AFTER_SEC },
}))

// POST /api/developer/webhooks - add an endpoint. The response is the only time its signing secret is shown.
export const POST = handler({ permission: 'developer.manage', write: true, body: endpointSchema }, async ({ ownerId, body, actor, audit }) => {
  const created = await createEndpoint(ownerId, body, actor.name)
  await audit('webhook.create', `Added webhook endpoint ${created.url}`, { entityType: 'webhook_endpoint', entityId: created.id, metadata: { events: created.events } })
  return created
})
