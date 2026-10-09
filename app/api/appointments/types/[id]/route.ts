import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { assertTypeRefs, publicType, typeInclude, typeUpdateSchema } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

export const PATCH = handler({ permission: 'appointments.configure', write: true, body: typeUpdateSchema }, async ({ ownerId, params, body, audit }) => {
  const existing = await prisma.appointmentType.findFirst({ where: { id: params.id, ownerId } })
  if (!existing) throw notFound('Appointment type')
  await assertTypeRefs(ownerId, { ...body, paymentMode: body.paymentMode ?? (existing.paymentMode as 'paid'), priceCents: body.priceCents ?? existing.priceCents })
  const { staffIds, ...data } = body
  const type = await prisma.$transaction(async (db) => {
    if (staffIds) {
      await db.appointmentTypeStaff.deleteMany({ where: { typeId: existing.id } })
      await db.appointmentTypeStaff.createMany({ data: staffIds.map((staffId) => ({ typeId: existing.id, staffId, ownerId })) })
    }
    return db.appointmentType.update({ where: { id: existing.id }, data, include: typeInclude })
  })
  await audit('appointment_type.update', `Updated appointment type ${type.name}`, { entityType: 'appointment_type', entityId: type.id })
  return publicType(type)
})

// DELETE - switch the type off. Existing appointments are kept; nothing new can be booked.
export const DELETE = handler({ permission: 'appointments.configure', write: true }, async ({ ownerId, params, audit }) => {
  const existing = await prisma.appointmentType.findFirst({ where: { id: params.id, ownerId } })
  if (!existing) throw notFound('Appointment type')
  await prisma.appointmentType.update({ where: { id: existing.id }, data: { isActive: false } })
  await audit('appointment_type.disable', `Switched off appointment type ${existing.name}`, { entityType: 'appointment_type', entityId: existing.id })
  return { isActive: false }
})
