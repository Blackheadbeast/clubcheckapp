import { prisma } from '@/lib/prisma'
import { publicHandler, API_VERSION } from '@/lib/public-api/handler'

export const dynamic = 'force-dynamic'

// GET /api/v1 - who this key is: the quickest way to check a key works
export const GET = publicHandler({ scope: null }, async ({ ownerId, key }) => {
  const gym = await prisma.gymProfile.findUnique({ where: { ownerId }, select: { name: true, timezone: true, currency: true } })
  return { object: 'api_key_info', apiVersion: API_VERSION, gym: { name: gym?.name || null, timezone: gym?.timezone || 'UTC', currency: gym?.currency || 'usd' }, key: { name: key.name, scopes: key.scopes } }
})
