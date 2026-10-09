import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { assertTypeRefs, publicType, typeInclude, typeSchema } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/appointments/types?all=1 - appointment types (active only unless all=1)
export const GET = handler({ permission: ['appointments.view', 'appointments.configure'] }, async ({ ownerId, query }) => {
  const types = await prisma.appointmentType.findMany({ where: { ownerId, ...(query.get('all') !== '1' && { isActive: true }) }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: typeInclude })
  return types.map(publicType)
})

export const POST = handler({ permission: 'appointments.configure', write: true, body: typeSchema }, async ({ ownerId, body, audit }) => {
  await assertTypeRefs(ownerId, body)
  const { staffIds, ...data } = body
  const type = await prisma.appointmentType.create({ data: { ownerId, ...data, staff: { create: staffIds.map((staffId) => ({ staffId, ownerId })) } }, include: typeInclude })
  await audit('appointment_type.create', `Created appointment type ${type.name}`, { entityType: 'appointment_type', entityId: type.id })
  return publicType(type)
})
