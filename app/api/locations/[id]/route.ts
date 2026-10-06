import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound, badRequest } from '@/lib/api'
import { locationSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

const patchSchema = locationSchema.partial().extend({ isActive: z.boolean().optional() })

export const PATCH = handler({ permission: 'locations.manage', write: true, body: patchSchema }, async ({ ownerId, params, body, audit }) => {
  const before = await prisma.location.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Location')
  if (body.isActive === false && before.isActive) {
    const others = await prisma.location.count({ where: { ownerId, isActive: true, id: { not: before.id } } })
    if (others === 0) throw badRequest('You need at least one active location.', 'last_location')
  }
  const location = await prisma.location.update({ where: { id: before.id }, data: body })
  await audit('location.update', `Updated location ${location.name}`, { entityType: 'location', entityId: location.id, before, after: location })
  return location
})
