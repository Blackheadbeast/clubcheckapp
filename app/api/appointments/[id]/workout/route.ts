import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { assertWorkout } from '@/lib/services/workouts'
import { assertOwnAppointment } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// PUT { workoutId | null } - the workout planned for a one-to-one appointment.
// The appointment stays the record of when and with whom; the workout is what was programmed and done.
export const PUT = handler({ permission: 'workouts.manage', write: true, body: z.object({ workoutId: z.string().uuid().nullable() }) }, async ({ ownerId, params, body, actor, audit }) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: params.id, ownerId }, select: { id: true, memberId: true } })
  if (!appointment) throw notFound('Appointment')
  await assertOwnAppointment(ownerId, actor, appointment.id)
  const workout = await assertWorkout(prisma, ownerId, body.workoutId)
  await prisma.appointment.update({ where: { id: appointment.id }, data: { workoutId: workout?.id || null } })
  await audit('appointment.workout', workout ? `Attached ${workout.name} to an appointment` : 'Removed the workout from an appointment', { entityType: 'appointment', entityId: appointment.id, metadata: { workoutId: workout?.id || null, memberId: appointment.memberId } })
  return { workoutId: workout?.id || null, workoutName: workout?.name || null }
})
