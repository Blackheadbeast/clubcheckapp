import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { locationSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: null }, async ({ ownerId, query }) => {
  const includeInactive = query.get('all') === '1'
  const locations = await prisma.location.findMany({
    where: { ownerId, ...(!includeInactive && { isActive: true }) },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { members: true, staff: true } } },
  })
  return locations.map(({ _count, ...l }) => ({ ...l, memberCount: _count.members, staffCount: _count.staff }))
})

export const POST = handler({ permission: 'locations.manage', write: true, body: locationSchema }, async ({ ownerId, body, audit }) => {
  const location = await prisma.location.create({ data: { ownerId, ...body } })
  await audit('location.create', `Added location ${location.name}`, { entityType: 'location', entityId: location.id, after: location })
  return location
})
