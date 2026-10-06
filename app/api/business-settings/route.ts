import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { businessSettingsSchema } from '@/lib/schemas'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'settings.manage' }, async ({ ownerId }) => getGymSettings(ownerId))

export const PUT = handler({ permission: 'settings.manage', write: true, body: businessSettingsSchema }, async ({ ownerId, body, audit }) => {
  const before = await getGymSettings(ownerId)
  await prisma.gymProfile.upsert({ where: { ownerId }, create: { ownerId, ...body }, update: body })
  const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => before[k] !== body[k])
  await audit('settings_update', `Updated booking and billing rules${changed.length ? ` (${changed.join(', ')})` : ''}`, {
    entityType: 'settings', before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, body[k]])),
  })
  return getGymSettings(ownerId)
})
