import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { createWorkout, listWorkouts, workoutSchema } from '@/lib/services/workouts'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/coaching/workouts?search=&type=&archived=1
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, query, actor }) => {
  const { page, pageSize, skip, take } = paging(query, 50)
  const list = await listWorkouts(ownerId, { search: query.get('search'), type: query.get('type'), archived: query.get('archived') === '1', skip, take })
  const own = ownDiaryOnly(actor)
  return new Paginated(list.rows.map((w) => ({ ...w, canEdit: !own || w.createdById === own })), list.total, page, pageSize)
})

// POST - build a workout
export const POST = handler({ permission: 'workouts.manage', write: true, body: workoutSchema }, async ({ ownerId, body, actor, audit }) => {
  const { workout } = await prisma.$transaction((db) => createWorkout(db, ownerId, body, actor), { timeout: 15_000 })
  await audit('workout.create', `Created the workout ${workout.name}`, { entityType: 'workout', entityId: workout.id })
  return { id: workout.id, version: 1 }
})
