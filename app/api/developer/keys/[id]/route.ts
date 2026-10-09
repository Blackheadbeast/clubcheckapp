import { handler } from '@/lib/api'
import { revokeApiKey } from '@/lib/public-api/keys'

export const dynamic = 'force-dynamic'

// DELETE /api/developer/keys/:id - revoke. It stops working on the next request and cannot be brought back.
export const DELETE = handler({ permission: 'developer.manage', write: true }, async ({ ownerId, params, actor, audit }) => {
  const key = await revokeApiKey(ownerId, params.id, actor)
  await audit('api_key.revoke', `Revoked API key ${key.name} (${key.prefix})`, { entityType: 'api_key', entityId: key.id })
  return key
})
