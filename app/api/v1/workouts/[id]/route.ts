import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { workoutOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/workouts/:id - the workout as currently prescribed, block by block
export const GET = publicHandler({ scope: 'workouts:read' }, async ({ ownerId, params }) => {
  const workout = await prisma.workout.findFirst({ where: { id: params.id, ownerId } })
  if (!workout) throw notFound('Workout')
  const version = workout.currentVersionId ? await prisma.workoutVersion.findUnique({ where: { id: workout.currentVersionId } }) : null
  return workoutOut(workout, version, true)
})
