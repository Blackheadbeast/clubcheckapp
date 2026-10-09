import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { copyExercise, exerciseUpdateSchema, getExercise, retireExercise, updateExercise } from '@/lib/services/exercises'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, params }) => getExercise(ownerId, params.id))

// PATCH - change one of this gym's own exercises. Built-in exercises, and other gyms', are refused.
export const PATCH = handler({ permission: 'workouts.manage', write: true, body: exerciseUpdateSchema }, async ({ ownerId, params, body, audit }) => {
  const { before, after } = await updateExercise(prisma, ownerId, params.id, body)
  await audit('exercise.update', `Updated the exercise ${after.name}`, { entityType: 'exercise', entityId: after.id, before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive } })
  return { id: after.id }
})

// DELETE - retire it. Workouts and history that used it keep its name.
export const DELETE = handler({ permission: 'workouts.manage', write: true }, async ({ ownerId, params, audit }) => {
  const exercise = await retireExercise(prisma, ownerId, params.id)
  await audit('exercise.retire', `Retired the exercise ${exercise.name}`, { entityType: 'exercise', entityId: exercise.id })
  return { retired: true }
})

// POST { action: "copy" } - an editable copy in this gym's library
export const POST = handler({ permission: 'workouts.manage', write: true, body: z.object({ action: z.literal('copy') }) }, async ({ ownerId, params, actor, audit }) => {
  const copy = await copyExercise(prisma, ownerId, params.id, actor)
  await audit('exercise.create', `Copied an exercise as ${copy.name}`, { entityType: 'exercise', entityId: copy.id, metadata: { from: params.id } })
  return { id: copy.id }
})
