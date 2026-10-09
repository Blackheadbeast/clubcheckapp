import { handler } from '@/lib/api'
import { apiKeySchema, createApiKey, listApiKeys } from '@/lib/public-api/keys'
import { DEFAULT_KEY_LIMIT, GYM_LIMIT, SCOPES, SCOPE_KEYS } from '@/lib/public-api/scopes'

export const dynamic = 'force-dynamic'

// GET /api/developer/keys - this gym's API keys (never the keys themselves) and the scopes this person may grant
export const GET = handler({ permission: 'developer.manage' }, async ({ ownerId, can }) => ({
  keys: await listApiKeys(ownerId),
  scopes: SCOPE_KEYS.map((key) => ({ key, label: SCOPES[key].label, allowed: can(SCOPES[key].permission) })),
  limits: { perKeyPerMinute: DEFAULT_KEY_LIMIT, perGymPerMinute: GYM_LIMIT },
}))

// POST /api/developer/keys - make a key. The response is the only time the key is ever shown.
export const POST = handler({ permission: 'developer.manage', write: true, body: apiKeySchema, rateLimit: { key: 'api-key-create', windowMs: 60_000, maxRequests: 20 } }, async ({ ownerId, body, actor, audit }) => {
  const created = await createApiKey(ownerId, body, actor)
  await audit('api_key.create', `Created API key ${created.name} (${created.prefix})`, { entityType: 'api_key', entityId: created.id, metadata: { scopes: created.scopes, expiresAt: created.expiresAt } })
  return created
})
