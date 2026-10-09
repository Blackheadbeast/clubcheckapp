import { prisma } from '@/lib/prisma'
import { Created, publicHandler } from '@/lib/public-api/handler'
import { workoutSessionOut } from '@/lib/public-api/serialize'
import { assignWorkout, assignWorkoutSchema } from '@/lib/services/workout-sessions'

export const dynamic = 'force-dynamic'

// POST /api/v1/workouts/:id/assign - give members this workout to do on a day
export const POST = publicHandler({ scope: 'workouts:write', write: true, body: assignWorkoutSchema, idempotent: true }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await prisma.$transaction((db) => assignWorkout(db, { ownerId, workoutId: params.id, ...body, actor }), { timeout: 20_000 })
  await audit('workout.assign', `Assigned ${result.workout.name} to ${result.created.length} member${result.created.length === 1 ? '' : 's'} through the API`, { entityType: 'workout', entityId: params.id })
  return new Created({ assigned: result.created.map((c) => workoutSessionOut(c.session)), alreadyAssigned: result.skipped })
})
