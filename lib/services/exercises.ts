// The exercise library.
//
// Two kinds of exercise live in one table. System exercises (ownerId null) ship with ClubCheck and
// every gym can use them; no gym can change them. Gym exercises belong to one gym. A workout version
// keeps the name each exercise had when it was saved, and a logged set keeps the name of what was
// done, so renaming or retiring an exercise never rewrites anyone's history.

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { DIFFICULTIES, MEASURES } from '@/lib/workouts/content'
import type { ActorRef, Db } from './core'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const url = z.string().trim().url('Enter a full web address, starting with https://').max(500).refine((u) => /^https?:\/\//i.test(u), 'Enter a web address starting with http:// or https://').nullish().or(z.literal('').transform(() => null))
const tags = z.array(z.string().trim().min(1).max(40)).max(12)

// No defaults in here: an update only changes what it was sent.
const fields = {
  name: z.string().trim().min(1, 'Name the exercise').max(100),
  description: optional(1000),
  instructions: optional(4000),
  category: z.string().trim().toLowerCase().min(1, 'Choose a category').max(40),
  movementPattern: optional(60),
  primaryMuscle: optional(60),
  secondaryMuscles: tags,
  equipment: tags,
  difficulty: z.enum(DIFFICULTIES),
  measure: z.enum(MEASURES),
  videoUrl: url,
  imageUrl: url,
  coachNotes: optional(2000),
  isActive: z.boolean(),
}
export const exerciseSchema = z.object({
  ...fields,
  secondaryMuscles: tags.default([]), equipment: tags.default([]), difficulty: fields.difficulty.default('intermediate'), measure: fields.measure.default('weight_reps'), isActive: fields.isActive.default(true),
})
export const exerciseUpdateSchema = z.object(fields).partial()

/** Exercises a gym can see: its own and the system ones. */
export const visibleTo = (ownerId: string): Prisma.ExerciseWhereInput => ({ OR: [{ ownerId }, { ownerId: null }] })

const staffView = { id: true, ownerId: true, name: true, description: true, instructions: true, category: true, movementPattern: true, primaryMuscle: true, secondaryMuscles: true, equipment: true, difficulty: true, measure: true, videoUrl: true, imageUrl: true, coachNotes: true, isActive: true, createdByName: true, updatedAt: true } as const
/** What a member may read about an exercise. Coach notes are not in it. */
export const memberExerciseView = { id: true, name: true, description: true, instructions: true, category: true, primaryMuscle: true, secondaryMuscles: true, equipment: true, difficulty: true, measure: true, videoUrl: true, imageUrl: true } as const

export interface ExerciseFilters { search?: string | null; category?: string | null; equipment?: string | null; scope?: string | null; includeInactive?: boolean; skip?: number; take?: number }

export async function listExercises(ownerId: string, filters: ExerciseFilters) {
  const search = (filters.search || '').trim()
  const where: Prisma.ExerciseWhereInput = {
    AND: [
      filters.scope === 'gym' ? { ownerId } : filters.scope === 'system' ? { ownerId: null } : visibleTo(ownerId),
      ...(filters.includeInactive ? [] : [{ isActive: true }]),
      ...(filters.category ? [{ category: filters.category.toLowerCase() }] : []),
      ...(filters.equipment ? [{ equipment: { has: filters.equipment } }] : []),
      ...(search ? [{ OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { primaryMuscle: { contains: search, mode: 'insensitive' as const } }, { category: { contains: search, mode: 'insensitive' as const } }] }] : []),
    ],
  }
  const [rows, total, categories] = await Promise.all([
    prisma.exercise.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: filters.skip || 0, take: Math.min(200, filters.take || 50), select: staffView }),
    prisma.exercise.count({ where }),
    prisma.exercise.groupBy({ by: ['category'], where: { AND: [visibleTo(ownerId), { isActive: true }] }, _count: { _all: true }, orderBy: { category: 'asc' } }),
  ])
  return { rows: rows.map((e) => ({ ...e, system: e.ownerId === null, ownerId: undefined })), total, categories: categories.map((c) => ({ category: c.category, count: c._count._all })) }
}

export async function getExercise(ownerId: string, id: string) {
  const exercise = await prisma.exercise.findFirst({ where: { id, AND: [visibleTo(ownerId)] }, select: staffView })
  if (!exercise) throw notFound('Exercise')
  return { ...exercise, system: exercise.ownerId === null, ownerId: undefined }
}

/** Two of a gym's own exercises with one name cannot be told apart in a picker, so the second is refused. */
async function nameTaken(db: Db, ownerId: string, name: string, exceptId?: string) {
  return !!(await db.exercise.findFirst({ where: { ownerId, isActive: true, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) }, select: { id: true } }))
}
const duplicate = (name: string) => new ApiError(409, `Your library already has an exercise called ${name}.`, 'duplicate_exercise')

export async function createExercise(db: Db, ownerId: string, input: z.infer<typeof exerciseSchema>, actor?: ActorRef) {
  if (await nameTaken(db, ownerId, input.name)) throw duplicate(input.name)
  return db.exercise.create({ data: { ownerId, ...input, createdByName: actor?.name || null } })
}

/** A gym's own exercise, or a refusal. System exercises and other gyms' exercises cannot be changed from here. */
async function ownExercise(db: Db, ownerId: string, id: string) {
  const exercise = await db.exercise.findFirst({ where: { id, AND: [visibleTo(ownerId)] } })
  if (!exercise) throw notFound('Exercise')
  if (exercise.ownerId === null) throw new ApiError(403, 'This exercise comes with ClubCheck and cannot be changed. Make a copy to adapt it for your gym.', 'system_exercise')
  return exercise
}

export async function updateExercise(db: Db, ownerId: string, id: string, input: z.infer<typeof exerciseUpdateSchema>) {
  const before = await ownExercise(db, ownerId, id)
  const name = input.name ?? before.name
  // Renaming onto another exercise's name, or bringing a retired one back beside its replacement.
  if ((input.name !== undefined || input.isActive === true) && (input.isActive ?? before.isActive) && (await nameTaken(db, ownerId, name, before.id))) throw duplicate(name)
  const after = await db.exercise.update({ where: { id: before.id }, data: input })
  return { before, after }
}

/**
 * Take an exercise out of the library. It stays on record (workouts and history that used it still
 * name it) but can no longer be picked for new programming.
 */
export async function retireExercise(db: Db, ownerId: string, id: string) {
  const exercise = await ownExercise(db, ownerId, id)
  return db.exercise.update({ where: { id: exercise.id }, data: { isActive: false } })
}

/** A gym's own editable copy of any exercise it can see, system ones included. */
export async function copyExercise(db: Db, ownerId: string, id: string, actor?: ActorRef) {
  const source = await db.exercise.findFirst({ where: { id, AND: [visibleTo(ownerId)] } })
  if (!source) throw notFound('Exercise')
  const { id: _id, slug: _slug, ownerId: _owner, createdAt: _c, updatedAt: _u, coachNotes, ...rest } = source
  let name = `${source.name.slice(0, 90)} (copy)`
  for (let n = 2; n < 50 && (await nameTaken(db, ownerId, name)); n++) name = `${source.name.slice(0, 88)} (copy ${n})`
  return db.exercise.create({ data: { ...rest, ownerId, name, coachNotes: source.ownerId === ownerId ? coachNotes : null, isActive: true, createdByName: actor?.name || null } })
}

const SYSTEM_EXERCISES: [name: string, category: string, measure: string, primary: string, equipment: string[], difficulty: string, pattern: string][] = [
  ['Back Squat', 'squat', 'weight_reps', 'Quadriceps', ['barbell', 'rack'], 'intermediate', 'Bilateral squat'],
  ['Front Squat', 'squat', 'weight_reps', 'Quadriceps', ['barbell', 'rack'], 'intermediate', 'Bilateral squat'],
  ['Goblet Squat', 'squat', 'weight_reps', 'Quadriceps', ['dumbbell'], 'beginner', 'Bilateral squat'],
  ['Air Squat', 'squat', 'reps', 'Quadriceps', [], 'beginner', 'Bilateral squat'],
  ['Walking Lunge', 'squat', 'weight_reps', 'Glutes', ['dumbbell'], 'beginner', 'Single-leg squat'],
  ['Deadlift', 'hinge', 'weight_reps', 'Hamstrings', ['barbell'], 'intermediate', 'Hip hinge'],
  ['Romanian Deadlift', 'hinge', 'weight_reps', 'Hamstrings', ['barbell'], 'intermediate', 'Hip hinge'],
  ['Kettlebell Swing', 'hinge', 'weight_reps', 'Glutes', ['kettlebell'], 'beginner', 'Hip hinge'],
  ['Hip Thrust', 'hinge', 'weight_reps', 'Glutes', ['barbell', 'bench'], 'beginner', 'Hip extension'],
  ['Bench Press', 'push', 'weight_reps', 'Chest', ['barbell', 'bench'], 'intermediate', 'Horizontal push'],
  ['Overhead Press', 'push', 'weight_reps', 'Shoulders', ['barbell'], 'intermediate', 'Vertical push'],
  ['Dumbbell Bench Press', 'push', 'weight_reps', 'Chest', ['dumbbell', 'bench'], 'beginner', 'Horizontal push'],
  ['Push-up', 'push', 'reps', 'Chest', [], 'beginner', 'Horizontal push'],
  ['Dip', 'push', 'reps', 'Triceps', ['dip bars'], 'intermediate', 'Vertical push'],
  ['Pull-up', 'pull', 'reps', 'Lats', ['pull-up bar'], 'intermediate', 'Vertical pull'],
  ['Band-Assisted Pull-up', 'pull', 'reps', 'Lats', ['pull-up bar', 'band'], 'beginner', 'Vertical pull'],
  ['Lat Pulldown', 'pull', 'weight_reps', 'Lats', ['cable machine'], 'beginner', 'Vertical pull'],
  ['Barbell Row', 'pull', 'weight_reps', 'Upper back', ['barbell'], 'intermediate', 'Horizontal pull'],
  ['Dumbbell Row', 'pull', 'weight_reps', 'Upper back', ['dumbbell', 'bench'], 'beginner', 'Horizontal pull'],
  ['Ring Row', 'pull', 'reps', 'Upper back', ['rings'], 'beginner', 'Horizontal pull'],
  ['Farmer Carry', 'carry', 'distance', 'Grip', ['dumbbell'], 'beginner', 'Loaded carry'],
  ['Clean', 'olympic lift', 'weight_reps', 'Full body', ['barbell'], 'advanced', 'Olympic lift'],
  ['Power Clean', 'olympic lift', 'weight_reps', 'Full body', ['barbell'], 'intermediate', 'Olympic lift'],
  ['Snatch', 'olympic lift', 'weight_reps', 'Full body', ['barbell'], 'advanced', 'Olympic lift'],
  ['Clean and Jerk', 'olympic lift', 'weight_reps', 'Full body', ['barbell'], 'advanced', 'Olympic lift'],
  ['Thruster', 'olympic lift', 'weight_reps', 'Full body', ['barbell'], 'intermediate', 'Squat to press'],
  ['Toes-to-Bar', 'gymnastics', 'reps', 'Abdominals', ['pull-up bar'], 'intermediate', 'Hanging'],
  ['Handstand Push-up', 'gymnastics', 'reps', 'Shoulders', [], 'advanced', 'Vertical push'],
  ['Muscle-up', 'gymnastics', 'reps', 'Lats', ['rings'], 'advanced', 'Pull to press'],
  ['Plank', 'core', 'time', 'Abdominals', [], 'beginner', 'Anti-extension'],
  ['Hollow Hold', 'core', 'time', 'Abdominals', [], 'beginner', 'Anti-extension'],
  ['Sit-up', 'core', 'reps', 'Abdominals', [], 'beginner', 'Trunk flexion'],
  ['Russian Twist', 'core', 'reps', 'Obliques', [], 'beginner', 'Rotation'],
  ['Burpee', 'conditioning', 'reps', 'Full body', [], 'beginner', 'Full body'],
  ['Box Jump', 'conditioning', 'reps', 'Quadriceps', ['box'], 'beginner', 'Jump'],
  ['Wall Ball', 'conditioning', 'reps', 'Full body', ['medicine ball'], 'beginner', 'Squat to throw'],
  ['Double-Under', 'conditioning', 'reps', 'Calves', ['jump rope'], 'intermediate', 'Jump'],
  ['Run', 'cardio', 'distance', 'Legs', [], 'beginner', 'Locomotion'],
  ['Row (erg)', 'cardio', 'distance', 'Full body', ['rower'], 'beginner', 'Cyclical'],
  ['Assault Bike', 'cardio', 'time', 'Full body', ['air bike'], 'beginner', 'Cyclical'],
  ['Couch Stretch', 'mobility', 'time', 'Hip flexors', [], 'beginner', 'Stretch'],
  ['World\'s Greatest Stretch', 'mobility', 'reps', 'Hips', [], 'beginner', 'Stretch'],
]

let seeded = false
/** Make sure the system exercises exist. Safe to call any number of times; existing ones are left alone. */
export async function ensureSystemExercises(force = false) {
  if (seeded && !force) return
  await prisma.exercise.createMany({
    data: SYSTEM_EXERCISES.map(([name, category, measure, primaryMuscle, equipment, difficulty, movementPattern]) => ({
      ownerId: null, slug: `system:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, name, category, measure, primaryMuscle, equipment, difficulty, movementPattern,
    })),
    skipDuplicates: true,
  })
  seeded = true
}
