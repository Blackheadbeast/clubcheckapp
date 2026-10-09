// Workouts and their versions.
//
// A Workout is the thing a coach names and reuses. What a member trains from is a WorkoutVersion:
// a complete snapshot of the workout as it stood. Once any member has a session on a version, that
// version is never written to again. Editing the workout then makes a new version, which future
// sessions use, while everything already done keeps pointing at the version it was done from.

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { ContentInput, DIFFICULTIES, Measure, Prescription, WORKOUT_TYPES, WorkoutContent, contentInputSchema } from '@/lib/workouts/content'
import { ActorRef, Db, lockRow } from './core'
import { visibleTo } from './exercises'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const meta = {
  name: z.string().trim().min(1, 'Name the workout').max(120),
  description: optional(1000),
  instructions: optional(4000),
  type: z.enum(WORKOUT_TYPES),
  difficulty: z.enum(DIFFICULTIES),
  estimatedMinutes: z.number().int().min(1).max(600).nullish().transform((v) => v ?? null),
  equipment: z.array(z.string().trim().min(1).max(40)).max(20),
}
export const workoutSchema = z.object({ ...meta, type: meta.type.default('mixed'), difficulty: meta.difficulty.default('intermediate'), equipment: meta.equipment.default([]), content: contentInputSchema })
export const workoutUpdateSchema = z.object({ ...meta, content: contentInputSchema }).partial()
export type WorkoutInput = z.infer<typeof workoutSchema>

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const prescriptionOf = (p: Prescription): Prescription => ({ sets: p.sets, reps: p.reps, durationSec: p.durationSec, distanceM: p.distanceM, weight: p.weight, weightUnit: p.weight ? p.weightUnit || 'lb' : null, percent: p.percent, rpe: p.rpe, restSec: p.restSec, tempo: p.tempo, notes: p.notes })

/**
 * Turn what the coach submitted into what is stored: every exercise checked against the gym's
 * library, its name and unit of measure copied in, and every block, exercise and scaling option
 * given an id that logged sets can point at.
 */
export async function buildContent(db: Db, ownerId: string, input: ContentInput, keep?: WorkoutContent | null): Promise<WorkoutContent> {
  const ids = Array.from(new Set(input.blocks.flatMap((b) => b.items.flatMap((i) => [i.exerciseId, ...i.scaling.map((s) => s.exerciseId)])).filter(Boolean))) as string[]
  const found = ids.length ? await db.exercise.findMany({ where: { id: { in: ids }, AND: [visibleTo(ownerId)] }, select: { id: true, name: true, measure: true, isActive: true } }) : []
  // An exercise that was already in this workout can stay even if it has since been retired.
  const already = new Set((keep?.blocks || []).flatMap((b) => b.items.flatMap((i) => [i.exerciseId, ...i.scaling.map((s) => s.exerciseId)])))
  const exercise = (id: string) => {
    const e = found.find((x) => x.id === id)
    if (!e) throw badRequest('One of the exercises in this workout is not in your library.', 'unknown_exercise')
    if (!e.isActive && !already.has(id)) throw badRequest(`${e.name} has been retired from the library. Choose another exercise.`, 'exercise_retired')
    return e
  }
  const seen = new Set<string>()
  const unique = (given?: string) => {
    const id = given && !seen.has(given) ? given : newId()
    seen.add(id)
    return id
  }
  return {
    blocks: input.blocks.map((b) => ({
      id: unique(b.id), type: b.type, title: b.title, instructions: b.instructions, rounds: b.rounds, durationSec: b.durationSec, workSec: b.workSec, restSec: b.restSec,
      items: b.items.map((i) => {
        const e = exercise(i.exerciseId)
        return {
          id: unique(i.id), exerciseId: e.id, exerciseName: e.name, measure: e.measure as Measure, ...prescriptionOf(i),
          scaling: i.scaling.map((s) => {
            const other = s.exerciseId ? exercise(s.exerciseId) : null
            return { id: unique(s.id), label: s.label, exerciseId: other?.id || null, exerciseName: other?.name || null, measure: (other?.measure as Measure) || null, ...prescriptionOf(s) }
          }),
        }
      }),
    })),
  }
}

/** Coaches and trainers change their own work; managers and above change anyone's. */
export function assertMayEdit(row: { createdById: string | null }, own: string | null, what: string) {
  if (own && row.createdById !== own) throw new ApiError(403, `You can only change ${what} you created. Ask a manager, or make a copy.`, 'not_yours')
}

export async function createWorkout(db: Db, ownerId: string, input: WorkoutInput, actor?: ActorRef) {
  const content = await buildContent(db, ownerId, input.content)
  const workout = await db.workout.create({
    data: { ownerId, name: input.name, type: input.type, difficulty: input.difficulty, estimatedMinutes: input.estimatedMinutes, createdById: actor?.id || null, createdByName: actor?.name || null },
  })
  const version = await db.workoutVersion.create({
    data: {
      ownerId, workoutId: workout.id, version: 1, name: input.name, description: input.description, instructions: input.instructions, type: input.type, difficulty: input.difficulty,
      estimatedMinutes: input.estimatedMinutes, equipment: input.equipment, content: content as unknown as Prisma.InputJsonValue, createdByName: actor?.name || null,
    },
  })
  await db.workout.update({ where: { id: workout.id }, data: { currentVersionId: version.id } })
  return { workout: { ...workout, currentVersionId: version.id }, version }
}

/**
 * Change a workout. If nobody has trained from the current version it is simply corrected. If
 * anyone has, it is left exactly as it is and a new version takes over from here on.
 */
export async function updateWorkout(db: Db, ownerId: string, id: string, input: z.infer<typeof workoutUpdateSchema>, opts: { actor?: ActorRef; own?: string | null } = {}) {
  const found = await db.workout.findFirst({ where: { id, ownerId }, select: { id: true } })
  if (!found) throw notFound('Workout')
  // Two saves at once, or a save racing a member starting the workout, take turns.
  await lockRow(db, 'Workout', found.id)
  const workout = await db.workout.findUniqueOrThrow({ where: { id: found.id } })
  if (workout.archivedAt) throw badRequest('This workout is archived. Restore it before changing it.', 'archived')
  assertMayEdit(workout, opts.own || null, 'workouts')
  const current = await db.workoutVersion.findUniqueOrThrow({ where: { id: workout.currentVersionId! } })
  const used = await db.workoutSession.count({ where: { workoutVersionId: current.id } })
  const content = input.content ? await buildContent(db, ownerId, input.content, current.content as unknown as WorkoutContent) : (current.content as unknown as WorkoutContent)
  const data = {
    name: input.name ?? current.name,
    description: input.description !== undefined ? input.description : current.description,
    instructions: input.instructions !== undefined ? input.instructions : current.instructions,
    type: input.type ?? current.type,
    difficulty: input.difficulty ?? current.difficulty,
    estimatedMinutes: input.estimatedMinutes !== undefined ? input.estimatedMinutes : current.estimatedMinutes,
    equipment: input.equipment ?? current.equipment,
    content: content as unknown as Prisma.InputJsonValue,
  }
  const version = used === 0
    ? await db.workoutVersion.update({ where: { id: current.id }, data })
    : await db.workoutVersion.create({ data: { ...data, ownerId, workoutId: workout.id, version: current.version + 1, createdByName: opts.actor?.name || null } })
  const updated = await db.workout.update({ where: { id: workout.id }, data: { name: data.name, type: data.type, difficulty: data.difficulty, estimatedMinutes: data.estimatedMinutes, currentVersionId: version.id } })
  return { workout: updated, version, newVersion: used > 0, previousVersion: current.version }
}

export async function archiveWorkout(db: Db, ownerId: string, id: string, archived: boolean, own?: string | null) {
  const workout = await db.workout.findFirst({ where: { id, ownerId } })
  if (!workout) throw notFound('Workout')
  assertMayEdit(workout, own || null, 'workouts')
  return db.workout.update({ where: { id: workout.id }, data: { archivedAt: archived ? new Date() : null } })
}

export async function duplicateWorkout(db: Db, ownerId: string, id: string, actor?: ActorRef) {
  const { version } = await getWorkout(ownerId, id, db)
  const content = version.content as unknown as WorkoutContent
  const workout = await db.workout.create({ data: { ownerId, name: `${version.name} (copy)`.slice(0, 120), type: version.type, difficulty: version.difficulty, estimatedMinutes: version.estimatedMinutes, createdById: actor?.id || null, createdByName: actor?.name || null } })
  const copy = await db.workoutVersion.create({
    data: { ownerId, workoutId: workout.id, version: 1, name: workout.name, description: version.description, instructions: version.instructions, type: version.type, difficulty: version.difficulty, estimatedMinutes: version.estimatedMinutes, equipment: version.equipment, content: content as unknown as Prisma.InputJsonValue, createdByName: actor?.name || null },
  })
  await db.workout.update({ where: { id: workout.id }, data: { currentVersionId: copy.id } })
  return workout
}

export async function listWorkouts(ownerId: string, filters: { search?: string | null; type?: string | null; archived?: boolean; skip?: number; take?: number }) {
  const search = (filters.search || '').trim()
  const where: Prisma.WorkoutWhereInput = {
    ownerId, archivedAt: filters.archived ? { not: null } : null,
    ...(filters.type && { type: filters.type }),
    ...(search && { name: { contains: search, mode: 'insensitive' } }),
  }
  const [rows, total] = await Promise.all([
    prisma.workout.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: filters.skip || 0, take: Math.min(200, filters.take || 50) }),
    prisma.workout.count({ where }),
  ])
  // One query for the versions and one for how often each has been done, not one per workout.
  const [versions, done] = await Promise.all([
    prisma.workoutVersion.findMany({ where: { id: { in: rows.map((r) => r.currentVersionId).filter(Boolean) as string[] } }, select: { id: true, version: true, description: true, content: true, equipment: true } }),
    prisma.workoutSession.groupBy({ by: ['workoutId'], where: { ownerId, workoutId: { in: rows.map((r) => r.id) }, status: 'completed' }, _count: { _all: true } }),
  ])
  return {
    total,
    rows: rows.map((w) => {
      const v = versions.find((x) => x.id === w.currentVersionId)
      const content = (v?.content as unknown as WorkoutContent) || { blocks: [] }
      return {
        id: w.id, name: w.name, type: w.type, difficulty: w.difficulty, estimatedMinutes: w.estimatedMinutes, version: v?.version || 1, description: v?.description || null, equipment: v?.equipment || [],
        blocks: content.blocks.map((b) => b.type), exercises: content.blocks.reduce((sum, b) => sum + b.items.length, 0),
        createdById: w.createdById, createdByName: w.createdByName, archived: !!w.archivedAt, updatedAt: w.updatedAt, timesCompleted: done.find((d) => d.workoutId === w.id)?._count._all || 0,
      }
    }),
  }
}

/** A workout with one of its versions (the current one unless another is asked for). */
export async function getWorkout(ownerId: string, id: string, db: Db = prisma, versionNumber?: number | null) {
  const workout = await db.workout.findFirst({ where: { id, ownerId } })
  if (!workout) throw notFound('Workout')
  const version = versionNumber
    ? await db.workoutVersion.findFirst({ where: { workoutId: workout.id, version: versionNumber } })
    : await db.workoutVersion.findFirst({ where: { id: workout.currentVersionId || '' } })
  if (!version) throw notFound('Workout version')
  return { workout, version }
}

export async function workoutDetail(ownerId: string, id: string, versionNumber?: number | null) {
  const { workout, version } = await getWorkout(ownerId, id, prisma, versionNumber)
  const [versions, used, programs, sessions] = await Promise.all([
    prisma.workoutVersion.findMany({ where: { workoutId: workout.id }, orderBy: { version: 'desc' }, select: { id: true, version: true, createdAt: true, createdByName: true } }),
    prisma.workoutSession.groupBy({ by: ['workoutVersionId'], where: { ownerId, workoutId: workout.id }, _count: { _all: true } }),
    prisma.programDay.findMany({ where: { ownerId, workoutId: workout.id }, select: { week: true, day: true, program: { select: { id: true, name: true, archivedAt: true } } }, take: 50 }),
    prisma.workoutSession.count({ where: { ownerId, workoutVersionId: version.id } }),
  ])
  return {
    id: workout.id, name: version.name, description: version.description, instructions: version.instructions, type: version.type, difficulty: version.difficulty,
    estimatedMinutes: version.estimatedMinutes, equipment: version.equipment, content: version.content as unknown as WorkoutContent,
    version: version.version, isCurrent: version.id === workout.currentVersionId, archived: !!workout.archivedAt, createdById: workout.createdById, createdByName: workout.createdByName,
    /** True when saving changes will start a new version instead of correcting this one. */
    inUse: sessions > 0,
    versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, createdByName: v.createdByName, sessions: used.find((u) => u.workoutVersionId === v.id)?._count._all || 0, current: v.id === workout.currentVersionId })),
    programs: Array.from(new Map(programs.filter((p) => !p.program.archivedAt).map((p) => [p.program.id, { id: p.program.id, name: p.program.name }])).values()),
  }
}

/** Workouts a member may be shown by name: in this gym and not archived. */
export async function assertWorkout(db: Db, ownerId: string, id: string | null | undefined) {
  if (!id) return null
  const workout = await db.workout.findFirst({ where: { id, ownerId }, select: { id: true, name: true, currentVersionId: true, archivedAt: true } })
  if (!workout) throw notFound('Workout')
  if (workout.archivedAt) throw badRequest('That workout is archived.', 'archived')
  return workout
}
