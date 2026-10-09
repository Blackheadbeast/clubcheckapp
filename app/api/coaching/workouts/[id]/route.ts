import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { archiveWorkout, duplicateWorkout, updateWorkout, workoutDetail, workoutUpdateSchema } from '@/lib/services/workouts'
import { assignWorkout, assignWorkoutSchema } from '@/lib/services/workout-sessions'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/coaching/workouts/:id?version= - the workout as it is now, or as it was at an earlier version
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, params, query, actor }) => {
  const version = Number(query.get('version')) || null
  const detail = await workoutDetail(ownerId, params.id, version)
  const own = ownDiaryOnly(actor)
  return { ...detail, canEdit: !own || detail.createdById === own }
})

// PATCH - change it. Once members have trained from the current version this starts a new one; their history is untouched.
export const PATCH = handler({ permission: 'workouts.manage', write: true, body: workoutUpdateSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await prisma.$transaction((db) => updateWorkout(db, ownerId, params.id, body, { actor, own: ownDiaryOnly(actor) }), { timeout: 15_000 })
  await audit('workout.update', result.newVersion ? `Updated ${result.workout.name} (now version ${result.version.version})` : `Updated ${result.workout.name}`, { entityType: 'workout', entityId: result.workout.id, metadata: { version: result.version.version, newVersion: result.newVersion } })
  return { id: result.workout.id, version: result.version.version, newVersion: result.newVersion }
})

// DELETE - archive it. Programs and history that use it keep working.
export const DELETE = handler({ permission: 'workouts.manage', write: true }, async ({ ownerId, params, actor, audit }) => {
  const workout = await archiveWorkout(prisma, ownerId, params.id, true, ownDiaryOnly(actor))
  await audit('workout.archive', `Archived the workout ${workout.name}`, { entityType: 'workout', entityId: workout.id })
  return { archived: true }
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('duplicate') }),
  z.object({ action: z.literal('restore') }),
  z.object({ action: z.literal('assign') }).merge(assignWorkoutSchema),
])

// POST { action: duplicate | restore | assign }
export const POST = handler({ permission: 'workouts.manage', write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  if (body.action === 'duplicate') {
    const copy = await prisma.$transaction((db) => duplicateWorkout(db, ownerId, params.id, actor))
    await audit('workout.create', `Duplicated a workout as ${copy.name}`, { entityType: 'workout', entityId: copy.id, metadata: { from: params.id } })
    return { id: copy.id }
  }
  if (body.action === 'restore') {
    await archiveWorkout(prisma, ownerId, params.id, false, ownDiaryOnly(actor))
    return { restored: true }
  }
  const { action: _action, ...assignment } = body
  const result = await prisma.$transaction((db) => assignWorkout(db, { ownerId, workoutId: params.id, ...assignment, actor }), { timeout: 30_000 })
  await audit('workout.assign', `Assigned ${result.workout.name} to ${result.created.length} member${result.created.length === 1 ? '' : 's'} for ${body.date}`, { entityType: 'workout', entityId: params.id, metadata: { memberIds: result.created.map((c) => c.member.id), date: body.date } })
  return { assigned: result.created.length, alreadyAssigned: result.skipped }
})
