import { handler } from '@/lib/api'
import { attributionSchema, getAttribution, setAttribution } from '@/lib/services/payroll-config'

export const dynamic = 'force-dynamic'

// GET /api/memberships/:id/attribution - who is credited with selling this membership
export const GET = handler({ permission: 'payroll.view' }, async ({ ownerId, params }) => getAttribution(ownerId, params.id))

// PUT /api/memberships/:id/attribution { shares: [{ staffId, sharePercent }] } - shares add up to 100; an empty list credits nobody
export const PUT = handler({ permission: 'payroll.manage', write: true, body: attributionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await setAttribution(ownerId, params.id, body, actor)
  await audit('payroll.attribution', 'Changed who is credited with a membership sale', { entityType: 'membership', entityId: params.id, metadata: { shares: body.shares } })
  return result
})
