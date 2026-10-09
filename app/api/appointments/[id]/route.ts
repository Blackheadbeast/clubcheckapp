import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, handler } from '@/lib/api'
import { dateInput, optionalText } from '@/lib/schemas'
import { assertOwnAppointment, ownDiaryOnly } from '@/lib/appointments-http'
import { cancelAppointment, getAppointment, isLate, markAppointment, rescheduleAppointment } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'appointments.view' }, async ({ ownerId, params, actor }) => {
  await assertOwnAppointment(ownerId, actor, params.id)
  const a = await getAppointment(ownerId, params.id)
  const workout = a.workoutId ? await prisma.workout.findFirst({ where: { id: a.workoutId, ownerId }, select: { id: true, name: true } }) : null
  return { ...a, late: a.status === 'booked' && isLate(a), workout }
})

// PATCH - notes only; times change through "reschedule" so the rules run
export const PATCH = handler({ permission: 'appointments.manage', write: true, body: z.object({ notes: optionalText(500), staffNotes: optionalText(2000) }) }, async ({ ownerId, params, body, actor }) => {
  await assertOwnAppointment(ownerId, actor, params.id)
  await getAppointment(ownerId, params.id)
  await prisma.appointment.update({ where: { id: params.id }, data: body })
  return { saved: true }
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: optionalText(300), waive: z.boolean().optional() }),
  z.object({ action: z.literal('reschedule'), startsAt: dateInput, staffId: z.string().uuid().nullish(), override: z.boolean().optional() }),
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('no_show') }),
])

// POST { action } - cancel, reschedule, mark attended or no-show
export const POST = handler({ permission: 'appointments.manage', write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  await assertOwnAppointment(ownerId, actor, params.id)
  const limit = ownDiaryOnly(actor)
  if (body.action === 'cancel') {
    const r = await cancelAppointment({ ownerId, appointmentId: params.id, by: 'staff', reason: body.reason, waive: body.waive, actor })
    await audit('appointment.cancel', `Cancelled an appointment${r.late ? ' (late)' : ''}`, { entityType: 'appointment', entityId: params.id, metadata: { creditsReturned: r.creditsReturned, refunded: r.refunded } })
    return { status: r.appointment.status, late: r.late, creditsReturned: r.creditsReturned, refunded: r.refunded }
  }
  if (body.action === 'reschedule') {
    if (limit && body.staffId && body.staffId !== limit) throw new ApiError(403, 'You can only move appointments within your own diary.', 'forbidden')
    const r = await rescheduleAppointment({ ownerId, appointmentId: params.id, startsAt: body.startsAt, staffId: body.staffId, by: 'staff', override: body.override, actor })
    await audit('appointment.reschedule', `Moved ${r.member.name}'s ${r.type.name}`, { entityType: 'appointment', entityId: params.id })
    return { status: r.appointment.status, startsAt: r.appointment.startsAt, staff: { id: r.staff.id, name: r.staff.name } }
  }
  const updated = await markAppointment({ ownerId, appointmentId: params.id, outcome: body.action === 'complete' ? 'completed' : 'no_show', actor })
  await audit(`appointment.${body.action}`, body.action === 'complete' ? 'Marked an appointment attended' : 'Marked an appointment as a no-show', { entityType: 'appointment', entityId: params.id })
  return { status: updated.status }
})
