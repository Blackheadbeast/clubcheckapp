import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, handler, notFound } from '@/lib/api'
import { assertWorkout } from '@/lib/services/workouts'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// PUT { workoutId | null } - attach a programmed workout to a class, or take it off.
// Booking and attendance are untouched: this only decides what members in the class can see and log.
export const PUT = handler({ permission: 'workouts.manage', write: true, body: z.object({ workoutId: z.string().uuid().nullable() }) }, async ({ ownerId, params, body, actor, audit }) => {
  const session = await prisma.classSession.findFirst({ where: { id: params.id, ownerId }, select: { id: true, coachId: true, title: true, classType: { select: { name: true } } } })
  if (!session) throw notFound('Class')
  const own = ownDiaryOnly(actor)
  if (own && session.coachId !== own) throw new ApiError(403, 'You can only set the workout for classes you coach.', 'not_your_class')
  const workout = await assertWorkout(prisma, ownerId, body.workoutId)
  await prisma.classSession.update({ where: { id: session.id }, data: { workoutId: workout?.id || null } })
  await audit('session.workout', workout ? `Set the workout for ${session.title || session.classType.name} to ${workout.name}` : `Removed the workout from ${session.title || session.classType.name}`, { entityType: 'classSession', entityId: session.id, metadata: { workoutId: workout?.id || null } })
  return { workoutId: workout?.id || null, workoutName: workout?.name || null }
})
