import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { classTypeSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'classes.view' }, async ({ ownerId }) => {
  const types = await prisma.classType.findMany({
    where: { ownerId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { schedules: { where: { isActive: true } } } } },
  })
  return types.map(({ _count, ...t }) => ({ ...t, scheduleCount: _count.schedules }))
})

export const POST = handler({ permission: 'classes.manage', write: true, body: classTypeSchema }, async ({ ownerId, body, audit }) => {
  const type = await prisma.classType.create({ data: { ownerId, ...body } })
  await audit('class_type.create', `Created class ${type.name}`, { entityType: 'classType', entityId: type.id })
  return type
})
