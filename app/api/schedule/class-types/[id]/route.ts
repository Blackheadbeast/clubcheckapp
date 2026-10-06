import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { classTypeSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

export const PATCH = handler({ permission: 'classes.manage', write: true, body: classTypeSchema.partial() }, async ({ ownerId, params, body, audit }) => {
  const before = await prisma.classType.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Class')
  const type = await prisma.classType.update({ where: { id: before.id }, data: body })
  await audit('class_type.update', `Updated class ${type.name}`, { entityType: 'classType', entityId: type.id, before, after: type })
  return type
})

export const DELETE = handler({ permission: 'classes.manage', write: true }, async ({ ownerId, params, audit }) => {
  const type = await prisma.classType.findFirst({ where: { id: params.id, ownerId } })
  if (!type) throw notFound('Class')
  const used = await prisma.classSession.count({ where: { classTypeId: type.id } })
  if (used > 0) {
    // Sessions and attendance history hang off it: retire rather than delete.
    await prisma.$transaction([
      prisma.classType.update({ where: { id: type.id }, data: { isActive: false } }),
      prisma.classSchedule.updateMany({ where: { classTypeId: type.id }, data: { isActive: false } }),
    ])
    await audit('class_type.archive', `Retired class ${type.name}`, { entityType: 'classType', entityId: type.id })
    return { deleted: false, archived: true }
  }
  await prisma.classType.delete({ where: { id: type.id } })
  await audit('class_type.delete', `Deleted class ${type.name}`, { entityType: 'classType', entityId: type.id })
  return { deleted: true, archived: false }
})
