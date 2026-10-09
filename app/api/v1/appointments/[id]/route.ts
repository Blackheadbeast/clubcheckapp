import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { appointmentOut } from '@/lib/public-api/serialize'
import { dateInput } from '@/lib/schemas'
import { cancelAppointment, rescheduleAppointment } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

const names = { type: { select: { name: true } }, staff: { select: { id: true, name: true } } } as const
const load = async (ownerId: string, id: string) => {
  const row = await prisma.appointment.findFirst({ where: { id, ownerId }, include: names })
  if (!row) throw notFound('Appointment')
  return row
}

export const GET = publicHandler({ scope: 'appointments:read' }, async ({ ownerId, params }) => appointmentOut(await load(ownerId, params.id)))

// PATCH /api/v1/appointments/:id - move it to another time, and optionally another coach
export const PATCH = publicHandler({ scope: 'appointments:write', write: true, body: z.object({ startsAt: dateInput, staffId: z.string().uuid().nullish() }), idempotent: true }, async ({ ownerId, params, body, actor, audit }) => {
  await load(ownerId, params.id)
  const r = await rescheduleAppointment({ ownerId, appointmentId: params.id, startsAt: body.startsAt, staffId: body.staffId, by: 'staff', actor })
  await audit('appointment.reschedule', `Moved ${r.member.name}'s ${r.type.name} through the API`, { entityType: 'appointment', entityId: params.id })
  return appointmentOut(await load(ownerId, params.id))
})

// DELETE /api/v1/appointments/:id?reason= - cancel. The type's cancellation window decides whether a credit or payment comes back.
export const DELETE = publicHandler({ scope: 'appointments:write', write: true }, async ({ ownerId, params, query, actor, audit }) => {
  await load(ownerId, params.id)
  const r = await cancelAppointment({ ownerId, appointmentId: params.id, by: 'staff', reason: (query.get('reason') || '').slice(0, 300) || null, actor })
  await audit('appointment.cancel', `Cancelled an appointment through the API${r.late ? ' (late)' : ''}`, { entityType: 'appointment', entityId: params.id, metadata: { creditsReturned: r.creditsReturned, refunded: r.refunded } })
  return { ...appointmentOut(await load(ownerId, params.id)), late: r.late, creditsReturned: r.creditsReturned, refunded: r.refunded }
})
