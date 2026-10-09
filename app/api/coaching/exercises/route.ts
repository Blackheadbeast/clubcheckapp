import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { createExercise, ensureSystemExercises, exerciseSchema, listExercises } from '@/lib/services/exercises'
import { EXERCISE_CATEGORIES } from '@/lib/workouts/content'

export const dynamic = 'force-dynamic'

// GET /api/coaching/exercises?search=&category=&equipment=&scope=gym|system&inactive=1 - the gym's exercises and the built-in ones
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, query }) => {
  await ensureSystemExercises()
  const { page, pageSize, skip, take } = paging(query, 50)
  const list = await listExercises(ownerId, { search: query.get('search'), category: query.get('category'), equipment: query.get('equipment'), scope: query.get('scope'), includeInactive: query.get('inactive') === '1', skip, take })
  return new Paginated(list.rows, list.total, page, pageSize, { categories: list.categories, suggestedCategories: EXERCISE_CATEGORIES })
})

// POST - add an exercise to this gym's library
export const POST = handler({ permission: 'workouts.manage', write: true, body: exerciseSchema }, async ({ ownerId, body, actor, audit }) => {
  const exercise = await createExercise(prisma, ownerId, body, actor)
  await audit('exercise.create', `Added the exercise ${exercise.name}`, { entityType: 'exercise', entityId: exercise.id })
  return { id: exercise.id }
})
