// Priority 8: workout programming. Exercises, versioned workouts, programs and assignments, the
// member's sessions (logging, scaling, substituting, completing), personal records, coach views,
// class and appointment attachment, permissions and tenant isolation.
// The HTTP parts need `npm run dev` against the same local database.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts } from '@/lib/dates'
import { contentInputSchema, describeBlock, describePrescription, scoring, type WorkoutContent } from '@/lib/workouts/content'
import { dateOf, lastDate, mondayOf, position, weekday } from '@/lib/workouts/schedule'
import { detectRecords, estimatedOneRepMax, recordKey, recordValue, type Best, type LoggedSet } from '@/lib/workouts/records'
import { copyExercise, createExercise, ensureSystemExercises, exerciseSchema, listExercises, retireExercise, updateExercise } from '@/lib/services/exercises'
import { createWorkout, updateWorkout, workoutDetail, workoutSchema, workoutUpdateSchema } from '@/lib/services/workouts'
import { archiveProgram, assignProgram, changeAssignment, createProgram, missedYesterday, programDetail, programSchema, refreshAssignments, updateProgram } from '@/lib/services/programs'
import { assignWorkout, completeSession, deleteSet, logSet, memberRecords, memberWorkouts, openSession, saveCoachNote, sessionView, setApproach, skipSession, workoutHistory } from '@/lib/services/workout-sessions'
import { coachingDay, memberProgress, programMembers } from '@/lib/services/coaching'
import { bookAppointment } from '@/lib/services/appointments'
import { bookClass } from '@/lib/services/bookings'
import { sellMembership } from '@/lib/services/memberships'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { DAY, createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

let gym: string
let other: string
let today: string
const ex: Record<string, string> = {}
const sys: Record<string, string> = {}

beforeAll(async () => {
  gym = await createGym({ timezone: 'UTC' })
  other = await createGym({ timezone: 'UTC' })
  today = zonedParts(new Date(), 'UTC').date
  await ensureSystemExercises(true)
  for (const name of ['Back Squat', 'Bench Press', 'Pull-up', 'Band-Assisted Pull-up', 'Lat Pulldown', 'Plank', 'Run', 'Burpee', 'Thruster', 'Barbell Row']) {
    sys[name] = (await prisma.exercise.findFirstOrThrow({ where: { ownerId: null, name } })).id
  }
  ex.sled = (await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Sled Push', category: 'Conditioning', measure: 'distance', equipment: ['sled'], coachNotes: 'Keep the heavy sled for the back lane' }))).id
})
afterAll(async () => {
  for (const ownerId of [gym, other]) {
    await prisma.personalRecord.deleteMany({ where: { ownerId } })
    await prisma.workoutSession.deleteMany({ where: { ownerId } })
    await prisma.programAssignment.deleteMany({ where: { ownerId } })
    await prisma.program.deleteMany({ where: { ownerId } })
    await prisma.workout.deleteMany({ where: { ownerId } })
    await prisma.exercise.deleteMany({ where: { ownerId } })
    await destroyGym(ownerId)
  }
})

/** A simple strength workout: squat 4 × 8 @ 225, then pull-ups 4 × 10 with a scale and an alternative. */
const strength = (name = `Lower ${randomUUID().slice(0, 4)}`, ownerId = gym) => tx((db) => createWorkout(db, ownerId, workoutSchema.parse({
  name, type: 'strength', estimatedMinutes: 45, instructions: 'Warm up first.',
  content: { blocks: [
    { type: 'straight', items: [{ exerciseId: sys['Back Squat'], sets: 4, reps: '8', weight: 225, weightUnit: 'lb', restSec: 120, rpe: 8 }] },
    { type: 'straight', items: [{ exerciseId: sys['Pull-up'], sets: 4, reps: '10', scaling: [{ label: 'Scaled', exerciseId: sys['Band-Assisted Pull-up'], sets: 4, reps: '10' }, { label: 'Alternative', exerciseId: sys['Lat Pulldown'], sets: 4, reps: '12' }] }] },
  ] },
}), { type: 'staff', id: randomUUID(), name: 'Coach Casey' }))
const itemsOf = (v: { content: unknown }) => (v.content as WorkoutContent).blocks.flatMap((b) => b.items)

/** A one-week program with a workout on today's weekday, assigned to a member from today. */
async function onProgram(memberId?: string, workoutId?: string, opts: { coachId?: string; weeks?: number; ownerId?: string } = {}) {
  const ownerId = opts.ownerId || gym
  const w = workoutId ? await prisma.workout.findUniqueOrThrow({ where: { id: workoutId } }) : (await strength(undefined, ownerId)).workout
  const member = memberId ? { id: memberId } : await createMember(ownerId)
  const weeks = opts.weeks || 1
  const program = await tx((db) => createProgram(db, ownerId, programSchema.parse({ name: `Program ${randomUUID().slice(0, 4)}`, weeks, days: Array.from({ length: weeks }, (_, i) => ({ week: i + 1, day: weekday(today), workoutId: w.id })) })))
  const result = await tx((db) => assignProgram(db, { ownerId, programId: program.id, memberIds: [member.id], startDate: today, coachId: opts.coachId }))
  const day = await prisma.programDay.findFirstOrThrow({ where: { programId: program.id, week: 1 } })
  return { ownerId, member, program, workout: w, assignment: result.created[0].assignment, day, source: { assignmentId: result.created[0].assignment.id, programDayId: day.id } }
}
async function started(p: Awaited<ReturnType<typeof onProgram>>) {
  const sessionId = await openSession({ ownerId: p.ownerId, memberId: p.member.id, source: p.source, start: true })
  const session = await prisma.workoutSession.findUniqueOrThrow({ where: { id: sessionId } })
  const version = await prisma.workoutVersion.findUniqueOrThrow({ where: { id: session.workoutVersionId } })
  const [squat, pull] = itemsOf(version)
  return { sessionId, version, squat, pull, me: { ownerId: p.ownerId, memberId: p.member.id, sessionId } }
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

describe('workout structure', () => {
  it('writes a prescription the way a coach would, using only the fields that were given', () => {
    const none = { sets: null, reps: null, durationSec: null, distanceM: null, weight: null, weightUnit: null, percent: null, rpe: null, restSec: null, tempo: null, notes: null }
    expect(describePrescription({ ...none, sets: 4, reps: '8', weight: 225, weightUnit: 'lb', rpe: 8, restSec: 90 })).toBe('4 × 8 @ 225 lb · RPE 8 · rest 1:30')
    expect(describePrescription({ ...none, sets: 3, durationSec: 60 })).toBe('3 × 1 min')
    expect(describePrescription({ ...none, distanceM: 5000 })).toBe('5 km')
    expect(describePrescription({ ...none, sets: 5, reps: '3', percent: 85, tempo: '31X1' })).toBe('5 × 3 @ 85% · tempo 31X1')
    expect(describePrescription({ ...none, reps: '21-15-9' })).toBe('21-15-9')
    expect(describePrescription(none)).toBe('')
    expect(describeBlock({ type: 'amrap', rounds: null, durationSec: 720, workSec: null, restSec: null })).toBe('AMRAP 12 min')
    expect(describeBlock({ type: 'emom', rounds: null, durationSec: 600, workSec: null, restSec: null })).toBe('EMOM 10 min')
    expect(describeBlock({ type: 'superset', rounds: 4, durationSec: null, workSec: null, restSec: null })).toBe('4 rounds')
    expect(describeBlock({ type: 'interval', rounds: 8, durationSec: null, workSec: 30, restSec: 30 })).toBe('30 sec on / 30 sec off × 8')
    expect(describeBlock({ type: 'for_time', rounds: null, durationSec: null, workSec: null, restSec: null })).toBe('For time')
  })

  it('accepts every way of working and refuses an empty block', () => {
    const e = randomUUID()
    for (const type of ['straight', 'superset', 'circuit', 'emom', 'amrap', 'for_time', 'interval'] as const) {
      expect(contentInputSchema.safeParse({ blocks: [{ type, items: [{ exerciseId: e }] }] }).success, type).toBe(true)
      expect(contentInputSchema.safeParse({ blocks: [{ type, items: [] }] }).success, `${type} empty`).toBe(false)
    }
    expect(contentInputSchema.safeParse({ blocks: [{ type: 'custom', instructions: '10 minutes of easy movement, coach\'s choice' }] }).success).toBe(true)
    expect(contentInputSchema.safeParse({ blocks: [{ type: 'custom' }] }).success).toBe(false)
    expect(contentInputSchema.safeParse({ blocks: [] }).success).toBe(false)
    expect(contentInputSchema.safeParse({ blocks: [{ type: 'tabata', items: [{ exerciseId: e }] }] }).success).toBe(false)
    expect(contentInputSchema.safeParse({ blocks: [{ type: 'straight', items: [{ exerciseId: e, sets: 0 }] }] }).success).toBe(false)
    expect(contentInputSchema.safeParse({ blocks: [{ type: 'straight', items: [{ exerciseId: e, weight: -5 }] }] }).success).toBe(false)
    const block = (type: string) => ({ id: type, type, title: null, instructions: null, rounds: null, durationSec: null, workSec: null, restSec: null, items: [] }) as any
    expect(scoring({ blocks: [block('for_time')] })).toBe('time')
    expect(scoring({ blocks: [block('straight'), block('amrap')] })).toBe('rounds')
    expect(scoring({ blocks: [block('amrap'), block('for_time')] })).toBeNull()
    expect(scoring({ blocks: [block('straight')] })).toBeNull()
  })
})

describe('program calendar', () => {
  // 2026-03-02 is a Monday.
  const t = { startDate: '2026-03-02', endDate: null, pausedDays: 0, pausedOn: null }
  it('puts each training day on its weekday, week by week', () => {
    expect(weekday('2026-03-02')).toBe(1)
    expect(weekday('2026-03-08')).toBe(7)
    expect(mondayOf('2026-03-05')).toBe('2026-03-02')
    expect(dateOf(t, 1, 1, '2026-03-02')).toBe('2026-03-02')
    expect(dateOf(t, 1, 4, '2026-03-02')).toBe('2026-03-05')
    expect(dateOf(t, 2, 1, '2026-03-02')).toBe('2026-03-09')
    expect(dateOf(t, 8, 5, '2026-03-02')).toBe('2026-04-24')
  })
  it('leaves out training days before the start and after the end', () => {
    const midweek = { ...t, startDate: '2026-03-04' }
    expect(dateOf(midweek, 1, 1, '2026-03-04')).toBeNull()
    expect(dateOf(midweek, 1, 3, '2026-03-04')).toBe('2026-03-04')
    expect(dateOf(midweek, 2, 1, '2026-03-04')).toBe('2026-03-09')
    expect(dateOf({ ...t, endDate: '2026-03-10' }, 2, 2, '2026-03-02')).toBe('2026-03-10')
    expect(dateOf({ ...t, endDate: '2026-03-10' }, 2, 3, '2026-03-02')).toBeNull()
  })
  it('pushes the schedule back by the time spent paused, including a pause still running', () => {
    expect(dateOf({ ...t, pausedDays: 3 }, 2, 1, '2026-03-20')).toBe('2026-03-12')
    expect(dateOf({ ...t, pausedOn: '2026-03-10' }, 2, 3, '2026-03-14')).toBe('2026-03-15')
    expect(dateOf({ ...t, pausedDays: 2, pausedOn: '2026-03-10' }, 2, 3, '2026-03-14')).toBe('2026-03-17')
    expect(lastDate(t, 2, '2026-03-02')).toBe('2026-03-15')
    expect(lastDate({ ...t, pausedDays: 7 }, 2, '2026-03-02')).toBe('2026-03-22')
    expect(lastDate({ ...t, endDate: '2026-03-12' }, 2, '2026-03-02')).toBe('2026-03-12')
  })
  it('knows which week it is', () => {
    expect(position(t, 8, '2026-03-01')).toMatchObject({ week: 1, notStarted: true, finished: false })
    expect(position(t, 8, '2026-03-11')).toMatchObject({ week: 2, day: 3, notStarted: false, finished: false })
    expect(position(t, 2, '2026-03-16')).toMatchObject({ week: 2, finished: true })
    expect(position({ ...t, pausedDays: 7 }, 2, '2026-03-16')).toMatchObject({ week: 2, finished: false })
  })
})

describe('personal records', () => {
  const squat = (weight: number | null, reps: number | null, extra: Partial<LoggedSet> = {}): LoggedSet => ({ exerciseId: 'squat', exerciseName: 'Back Squat', measure: 'weight_reps', weight, weightUnit: 'lb', reps, ...extra })
  const none = new Map<string, Best>()
  const types = (found: ReturnType<typeof detectRecords>) => found.map((r) => `${r.type}${r.bucket ? `:${r.bucket}` : ''}=${r.value}`)

  it('estimates a one-rep max only where the estimate means something', () => {
    expect(estimatedOneRepMax(225, 1)).toBe(225)
    expect(estimatedOneRepMax(225, 8)).toBe(285)
    expect(estimatedOneRepMax(100, 10)).toBe(133.3)
    for (const [w, r] of [[225, 11], [225, 0], [0, 5], [-5, 5], [225, 2.5]]) expect(estimatedOneRepMax(w, r), `${w}x${r}`).toBeNull()
  })

  it('treats a first result as a starting point, not a record', () => {
    const found = detectRecords({ sets: [squat(225, 8), squat(215, 8), squat(225, 6)] }, none)
    expect(types(found)).toEqual(['estimated_1rm=285', 'heaviest_weight=225', 'reps_at_weight:215lb=8', 'reps_at_weight:225lb=8'])
    expect(found.every((r) => r.previousValue === null)).toBe(true)
  })

  it('records only what beats the previous best, and says what it beat', () => {
    const bests = new Map<string, Best>([
      [recordKey('squat', 'heaviest_weight'), { value: 225, unit: 'lb' }],
      [recordKey('squat', 'estimated_1rm'), { value: 285, unit: 'lb' }],
      [recordKey('squat', 'reps_at_weight', '225lb'), { value: 8, unit: 'reps' }],
    ])
    // Matching a best is not beating it.
    expect(detectRecords({ sets: [squat(225, 8)] }, bests)).toEqual([])
    expect(detectRecords({ sets: [squat(225, 7), squat(200, 5)] }, bests).map((r) => r.type)).toEqual(['reps_at_weight'])
    const better = detectRecords({ sets: [squat(245, 5), squat(225, 9)] }, bests)
    expect(types(better)).toEqual(['estimated_1rm=292.5', 'heaviest_weight=245', 'reps_at_weight:225lb=9', 'reps_at_weight:245lb=5'])
    expect(better.find((r) => r.type === 'heaviest_weight')).toMatchObject({ previousValue: 225, detail: '245 lb × 5' })
    expect(better.find((r) => r.type === 'reps_at_weight' && r.bucket === '225lb')).toMatchObject({ previousValue: 8 })
    expect(better.find((r) => r.bucket === '245lb')).toMatchObject({ previousValue: null })
  })

  it('compares kilograms with pounds properly', () => {
    const bests = new Map<string, Best>([[recordKey('squat', 'heaviest_weight'), { value: 225, unit: 'lb' }], [recordKey('squat', 'estimated_1rm'), { value: 500, unit: 'lb' }]])
    // 100 kg is 220.5 lb: not a record. 105 kg is 231.5 lb: a record, reported in the unit it was lifted in.
    expect(detectRecords({ sets: [squat(100, 1, { weightUnit: 'kg' })] }, bests).filter((r) => r.type === 'heaviest_weight')).toEqual([])
    const found = detectRecords({ sets: [squat(105, 1, { weightUnit: 'kg' })] }, bests).find((r) => r.type === 'heaviest_weight')!
    expect(found).toMatchObject({ value: 105, unit: 'kg', previousValue: 102.1 })
  })

  it('does not invent a record from a set that is missing what the record needs', () => {
    expect(detectRecords({ sets: [squat(225, null), squat(null, 8), squat(0, 8), squat(225, 0), squat(null, null)] }, none)).toEqual([])
    // No exercise from the library to hang it on.
    expect(detectRecords({ sets: [{ exerciseId: null, exerciseName: 'Something else', measure: 'weight_reps', weight: 100, reps: 5 }] }, none)).toEqual([])
    // Twelve reps says nothing reliable about a one-rep max.
    expect(detectRecords({ sets: [squat(135, 12)] }, none).map((r) => r.type)).toEqual(['heaviest_weight', 'reps_at_weight'])
  })

  it('handles bodyweight reps, holds and distances by what each is measured in', () => {
    const pull = { exerciseId: 'pull', exerciseName: 'Pull-up', measure: 'reps' }
    expect(types(detectRecords({ sets: [{ ...pull, reps: 8 }, { ...pull, reps: 11 }, { ...pull, reps: 9 }] }, none))).toEqual(['most_reps=11'])
    expect(detectRecords({ sets: [{ ...pull, reps: 11 }] }, new Map([[recordKey('pull', 'most_reps'), { value: 11, unit: 'reps' }]]))).toEqual([])
    expect(types(detectRecords({ sets: [{ exerciseId: 'plank', exerciseName: 'Plank', measure: 'time', durationSec: 95 }] }, none))).toEqual(['longest_duration=95'])
    expect(types(detectRecords({ sets: [{ exerciseId: 'run', exerciseName: 'Run', measure: 'distance', distanceM: 5000, durationSec: 1500 }] }, none))).toEqual(['longest_distance=5000'])
    // A weighted movement done without weight is not a "most reps" record.
    expect(detectRecords({ sets: [squat(null, 30)] }, none)).toEqual([])
  })

  it('scores a whole workout only when it was done as written', () => {
    const fran = { id: 'fran', name: 'Fran', scoring: 'time' as const, asPrescribed: true }
    const best = new Map<string, Best>([[recordKey('workout:fran', 'fastest_time'), { value: 300, unit: 'sec' }]])
    expect(detectRecords({ sets: [], workout: { ...fran, timeSec: 285 } }, best)).toEqual([expect.objectContaining({ type: 'fastest_time', value: 285, previousValue: 300, workoutId: 'fran', detail: '4:45' })])
    // Slower, or the same: no record. Faster is the only way.
    expect(detectRecords({ sets: [], workout: { ...fran, timeSec: 300 } }, best)).toEqual([])
    expect(detectRecords({ sets: [], workout: { ...fran, timeSec: 320 } }, best)).toEqual([])
    // Scaled or substituted: a different workout, so nothing to compare.
    expect(detectRecords({ sets: [], workout: { ...fran, asPrescribed: false, timeSec: 200 } }, best)).toEqual([])
    expect(detectRecords({ sets: [], workout: { ...fran, timeSec: null } }, best)).toEqual([])
    const cindy = { id: 'cindy', name: 'Cindy', scoring: 'rounds' as const, asPrescribed: true }
    const rounds = new Map<string, Best>([[recordKey('workout:cindy', 'most_rounds'), { value: 15.003, unit: 'rounds' }]])
    expect(detectRecords({ sets: [], workout: { ...cindy, rounds: 15, reps: 12 } }, rounds)[0]).toMatchObject({ type: 'most_rounds', detail: '15 rounds + 12 reps' })
    expect(detectRecords({ sets: [], workout: { ...cindy, rounds: 15, reps: 3 } }, rounds)).toEqual([])
    expect(detectRecords({ sets: [], workout: { ...cindy, rounds: 14, reps: 29 } }, rounds)).toEqual([])
    expect(recordValue('most_rounds', 15.012, 'rounds')).toBe('15 rounds + 12 reps')
    expect(recordValue('fastest_time', 222, 'sec')).toBe('3:42')
    expect(recordValue('heaviest_weight', 245, 'lb')).toBe('245 lb')
  })

  it('gives the same answer, in the same order, every time', () => {
    const sets = [squat(245, 5), { exerciseId: 'bench', exerciseName: 'Bench Press', measure: 'weight_reps', weight: 185, weightUnit: 'lb', reps: 5 }, squat(225, 9)]
    const a = detectRecords({ sets }, none)
    const b = detectRecords({ sets: [...sets].reverse() }, none)
    expect(a).toEqual(b)
    expect(a.map((r) => r.name)).toEqual([...a.map((r) => r.name)].sort())
  })
})

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

describe('exercise library', () => {
  it('offers the built-in exercises to every gym and keeps each gym\'s own to itself', async () => {
    await ensureSystemExercises(true)
    await ensureSystemExercises(true)
    expect(await prisma.exercise.count({ where: { ownerId: null, name: 'Back Squat' } })).toBe(1)
    const theirs = await createExercise(prisma, other, exerciseSchema.parse({ name: 'Secret Other Gym Move', category: 'core' }))
    const mine = await listExercises(gym, { take: 200 })
    expect(mine.rows.find((e) => e.name === 'Back Squat')).toMatchObject({ system: true, category: 'squat', measure: 'weight_reps' })
    expect(mine.rows.find((e) => e.id === ex.sled)).toMatchObject({ system: false, category: 'conditioning', coachNotes: 'Keep the heavy sled for the back lane' })
    expect(mine.rows.map((e) => e.id)).not.toContain(theirs.id)
    expect((await listExercises(gym, { scope: 'gym' })).rows.every((e) => !e.system)).toBe(true)
    expect((await listExercises(gym, { search: 'sled' })).rows.map((e) => e.id)).toEqual([ex.sled])
    expect((await listExercises(gym, { category: 'Olympic Lift' })).rows.length).toBeGreaterThan(2)
    expect((await listExercises(gym, { equipment: 'sled' })).rows.map((e) => e.id)).toEqual([ex.sled])
    // Categories are whatever the gym uses, not a fixed list.
    const odd = await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Atlas Stone Load', category: 'Strongman' }))
    expect((await listExercises(gym, {})).categories.map((c) => c.category)).toContain('strongman')
    expect(odd.category).toBe('strongman')
  })

  it('refuses a second exercise of the gym\'s own with the same name, and numbers repeated copies', async () => {
    const first = await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Yoke Carry', category: 'carry' }))
    await expect(createExercise(prisma, gym, exerciseSchema.parse({ name: 'yoke carry', category: 'carry' }))).rejects.toMatchObject({ status: 409, code: 'duplicate_exercise' })
    // Another gym may use the name, and so may this gym once the first is retired.
    const theirs = await createExercise(prisma, other, exerciseSchema.parse({ name: 'Yoke Carry', category: 'carry' }))
    expect(theirs.ownerId).toBe(other)
    const second = await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Farmer Carry Heavy', category: 'carry' }))
    await expect(updateExercise(prisma, gym, second.id, { name: 'Yoke Carry' })).rejects.toMatchObject({ status: 409 })
    await retireExercise(prisma, gym, first.id)
    await updateExercise(prisma, gym, second.id, { name: 'Yoke Carry' })
    await expect(updateExercise(prisma, gym, first.id, { isActive: true })).rejects.toMatchObject({ status: 409 })
    const a = await copyExercise(prisma, gym, sys['Plank'])
    const b = await copyExercise(prisma, gym, sys['Plank'])
    expect([a.name, b.name]).toEqual(['Plank (copy)', 'Plank (copy 2)'])
  })

  it('lets a gym change and retire its own exercises, and nobody else\'s', async () => {
    const mine = await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Tyre Flip', category: 'conditioning', measure: 'reps' }))
    const { after } = await updateExercise(prisma, gym, mine.id, { name: 'Tire Flip', videoUrl: 'https://example.com/tire' })
    expect(after).toMatchObject({ name: 'Tire Flip', videoUrl: 'https://example.com/tire', measure: 'reps', category: 'conditioning' })
    await expect(updateExercise(prisma, gym, sys['Back Squat'], { name: 'My Squat' })).rejects.toMatchObject({ status: 403, code: 'system_exercise' })
    await expect(retireExercise(prisma, gym, sys['Back Squat'])).rejects.toMatchObject({ code: 'system_exercise' })
    await expect(updateExercise(prisma, other, mine.id, { name: 'Hijacked' })).rejects.toMatchObject({ status: 404 })
    await expect(retireExercise(prisma, other, mine.id)).rejects.toMatchObject({ status: 404 })
    expect((await prisma.exercise.findUniqueOrThrow({ where: { id: sys['Back Squat'] } })).name).toBe('Back Squat')
    expect((await prisma.exercise.findUniqueOrThrow({ where: { id: mine.id } })).name).toBe('Tire Flip')
    // A copy of a built-in exercise is the gym's own to adapt.
    const copy = await copyExercise(prisma, gym, sys['Back Squat'])
    expect(copy).toMatchObject({ ownerId: gym, name: 'Back Squat (copy)', slug: null, category: 'squat' })
    await updateExercise(prisma, gym, copy.id, { name: 'Tempo Back Squat' })
    await expect(copyExercise(prisma, gym, (await createExercise(prisma, other, exerciseSchema.parse({ name: 'Theirs', category: 'core' }))).id)).rejects.toMatchObject({ status: 404 })
    await retireExercise(prisma, gym, mine.id)
    expect((await listExercises(gym, { search: 'Tire' })).rows).toHaveLength(0)
    expect((await listExercises(gym, { search: 'Tire', includeInactive: true })).rows).toHaveLength(1)
    expect(exerciseSchema.safeParse({ name: 'X', category: 'core', videoUrl: 'javascript:alert(1)' }).success).toBe(false)
  })
})

describe('workout builder', () => {
  it('builds a workout from every kind of block and copies each exercise\'s name into it', async () => {
    const { workout, version } = await tx((db) => createWorkout(db, gym, workoutSchema.parse({
      name: 'Everything Day', type: 'mixed', difficulty: 'advanced', estimatedMinutes: 75, equipment: ['barbell'],
      content: { blocks: [
        { type: 'straight', items: [{ exerciseId: sys['Bench Press'], sets: 4, reps: '8' }] },
        { type: 'superset', rounds: 4, items: [{ exerciseId: sys['Bench Press'], reps: '8' }, { exerciseId: sys['Barbell Row'], reps: '8' }] },
        { type: 'circuit', rounds: 3, items: [{ exerciseId: sys['Burpee'], reps: '10' }, { exerciseId: sys['Plank'], durationSec: 45 }, { exerciseId: ex.sled, distanceM: 20 }] },
        { type: 'emom', durationSec: 600, items: [{ exerciseId: sys['Thruster'], reps: '5', percent: 60 }] },
        { type: 'amrap', durationSec: 720, items: [{ exerciseId: sys['Pull-up'], reps: '5' }, { exerciseId: sys['Burpee'], reps: '10' }] },
        { type: 'interval', rounds: 8, workSec: 30, restSec: 30, items: [{ exerciseId: sys['Run'] }] },
        { type: 'custom', title: 'Cool down', instructions: 'Ten easy minutes, your choice.' },
      ] },
    })))
    const content = version.content as unknown as WorkoutContent
    expect(content.blocks.map((b) => b.type)).toEqual(['straight', 'superset', 'circuit', 'emom', 'amrap', 'interval', 'custom'])
    expect(content.blocks[2].items.map((i) => [i.exerciseName, i.measure])).toEqual([['Burpee', 'reps'], ['Plank', 'time'], ['Sled Push', 'distance']])
    // Only what was given is there: a plank has no weight, a run no reps.
    expect(content.blocks[2].items[1]).toMatchObject({ durationSec: 45, reps: null, weight: null, sets: null })
    expect(content.blocks[3].items[0]).toMatchObject({ percent: 60, weight: null })
    const ids = content.blocks.flatMap((b) => [b.id, ...b.items.map((i) => i.id)])
    expect(new Set(ids).size).toBe(ids.length)
    expect(workout).toMatchObject({ name: 'Everything Day', currentVersionId: version.id })
    expect(version).toMatchObject({ version: 1, difficulty: 'advanced', estimatedMinutes: 75 })
  })

  it('only uses exercises the gym can see, and none that have been retired', async () => {
    const theirs = await createExercise(prisma, other, exerciseSchema.parse({ name: 'Other Gym Only', category: 'core' }))
    const build = (exerciseId: string, scaling: unknown[] = []) => tx((db) => createWorkout(db, gym, workoutSchema.parse({ name: 'X', content: { blocks: [{ type: 'straight', items: [{ exerciseId, scaling }] }] } })))
    await expect(build(theirs.id)).rejects.toMatchObject({ code: 'unknown_exercise' })
    await expect(build(sys['Pull-up'], [{ label: 'Scaled', exerciseId: theirs.id }])).rejects.toMatchObject({ code: 'unknown_exercise' })
    await expect(build(randomUUID())).rejects.toMatchObject({ code: 'unknown_exercise' })
    const retired = await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Old Move', category: 'core' }))
    const { workout } = await build(retired.id)
    await retireExercise(prisma, gym, retired.id)
    await expect(build(retired.id)).rejects.toMatchObject({ code: 'exercise_retired' })
    // A workout that already had it can still be saved with it.
    const kept = await tx((db) => updateWorkout(db, gym, workout.id, workoutUpdateSchema.parse({ content: { blocks: [{ type: 'straight', items: [{ exerciseId: retired.id, sets: 3 }] }] } })))
    expect(itemsOf(kept.version)[0]).toMatchObject({ exerciseName: 'Old Move', sets: 3 })
    await expect(tx((db) => updateWorkout(db, other, workout.id, { name: 'Taken' }))).rejects.toMatchObject({ status: 404 })
  })

  it('lets a coach change only the workouts they made, and a manager any', async () => {
    const coach = randomUUID()
    const { workout } = await tx((db) => createWorkout(db, gym, workoutSchema.parse({ name: 'Coach\'s Own', content: { blocks: [{ type: 'straight', items: [{ exerciseId: sys['Plank'] }] }] } }), { type: 'staff', id: coach, name: 'Coach A' }))
    await expect(tx((db) => updateWorkout(db, gym, workout.id, { name: 'Not Mine' }, { own: randomUUID() }))).rejects.toMatchObject({ status: 403, code: 'not_yours' })
    expect((await tx((db) => updateWorkout(db, gym, workout.id, { name: 'Coach\'s Own v2' }, { own: coach }))).workout.name).toBe('Coach\'s Own v2')
    expect((await tx((db) => updateWorkout(db, gym, workout.id, { name: 'Manager Fixed It' }, { own: null }))).workout.name).toBe('Manager Fixed It')
  })
})

describe('programs and assignment', () => {
  it('builds a multi-week program from reusable workouts without copying them', async () => {
    const [lower, upper] = [(await strength('Lower')).workout, (await strength('Upper')).workout]
    const days = [1, 2].flatMap((week) => [{ week, day: 1, workoutId: lower.id }, { week, day: 2, workoutId: upper.id }, { week, day: 4, workoutId: lower.id, title: 'Lower (speed)' }, { week, day: 5, workoutId: upper.id }])
    const before = await prisma.workout.count({ where: { ownerId: gym } })
    const program = await tx((db) => createProgram(db, gym, programSchema.parse({ name: '2 Week Strength', goals: 'Get stronger', audience: 'Intermediate lifters', weeks: 2, days })))
    expect(await prisma.workout.count({ where: { ownerId: gym } })).toBe(before)
    const detail = await programDetail(gym, program.id)
    expect(detail).toMatchObject({ name: '2 Week Strength', weeks: 2, goals: 'Get stronger', audience: 'Intermediate lifters' })
    expect(detail.days.map((d) => [d.week, d.day, d.workoutName])).toEqual([[1, 1, 'Lower'], [1, 2, 'Upper'], [1, 4, 'Lower'], [1, 5, 'Upper'], [2, 1, 'Lower'], [2, 2, 'Upper'], [2, 4, 'Lower'], [2, 5, 'Upper']])
    expect(detail.days[2].title).toBe('Lower (speed)')

    const make = (extra: unknown) => tx((db) => createProgram(db, gym, programSchema.parse({ name: 'Bad', weeks: 2, ...(extra as object) })))
    await expect(make({ days: [{ week: 1, day: 1, workoutId: lower.id }, { week: 1, day: 1, workoutId: upper.id }] })).rejects.toMatchObject({ code: 'day_taken' })
    await expect(make({ days: [{ week: 3, day: 1, workoutId: lower.id }] })).rejects.toMatchObject({ code: 'week_out_of_range' })
    await expect(make({ days: [{ week: 1, day: 1, workoutId: (await strength('Theirs', other)).workout.id }] })).rejects.toMatchObject({ status: 404 })
    expect(programSchema.safeParse({ name: 'X', weeks: 0 }).success).toBe(false)
    expect(programSchema.safeParse({ name: 'X', weeks: 1, days: [{ week: 1, day: 8, workoutId: lower.id }] }).success).toBe(false)

    // Editing keeps the identity of the days that stay where they are.
    const monday = detail.days[0].id
    await tx((db) => updateProgram(db, gym, program.id, programUpdateDays([{ week: 1, day: 1, workoutId: upper.id }, { week: 1, day: 3, workoutId: lower.id }])))
    const after = await programDetail(gym, program.id)
    expect(after.days.map((d) => [d.week, d.day, d.workoutName])).toEqual([[1, 1, 'Upper'], [1, 3, 'Lower']])
    expect(after.days[0].id).toBe(monday)
    await expect(tx((db) => updateProgram(db, other, program.id, { name: 'Taken' }))).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => updateProgram(db, gym, program.id, { name: 'Coach edit' }, randomUUID()))).rejects.toMatchObject({ code: 'not_yours' })
  })
  const programUpdateDays = (days: { week: number; day: number; workoutId: string }[]) => ({ days: days.map((d) => ({ ...d, title: null })) })

  it('assigns to one member, several, or everyone on a membership plan, and never twice', async () => {
    const { workout } = await strength()
    const program = await tx((db) => createProgram(db, gym, programSchema.parse({ name: 'Assignable', weeks: 4, days: [{ week: 1, day: 1, workoutId: workout.id }] })))
    const coach = await prisma.staff.create({ data: { ownerId: gym, name: 'Coach Riley', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
    const [a, b, c] = [await createMember(gym), await createMember(gym), await createMember(gym)]
    const assign = (input: Record<string, unknown>) => tx((db) => assignProgram(db, { ownerId: gym, programId: program.id, startDate: today, ...input } as any))

    const one = await assign({ memberIds: [a.id], coachId: coach.id })
    expect(one.created).toHaveLength(1)
    expect(one.created[0].assignment).toMatchObject({ status: 'active', coachId: coach.id, memberId: a.id })
    // The member is told, in their own notifications.
    expect(await prisma.memberNotification.findFirst({ where: { memberId: a.id, category: 'workout', type: 'program_assigned' } })).toBeTruthy()
    // Again, and with others: A is left alone and reported, B and C are added.
    const many = await assign({ memberIds: [a.id, b.id, c.id, b.id] })
    expect(many.created.map((x) => x.member.id).sort()).toEqual([b.id, c.id].sort())
    expect(many.already.map((m) => m.id)).toEqual([a.id])
    expect(await prisma.programAssignment.count({ where: { programId: program.id } })).toBe(3)

    // A future start is scheduled, not active.
    const later = await tx((db) => createProgram(db, gym, programSchema.parse({ name: 'Later', weeks: 1, days: [{ week: 1, day: 1, workoutId: workout.id }] })))
    const scheduled = await tx((db) => assignProgram(db, { ownerId: gym, programId: later.id, memberIds: [a.id], startDate: addDaysToDate(today, 10), endDate: addDaysToDate(today, 40) }))
    expect(scheduled.created[0].assignment.status).toBe('scheduled')

    // Everyone with a live membership on a plan.
    const plan = await createPlan(gym)
    const [p1, p2, lapsed] = [await createMember(gym), await createMember(gym), await createMember(gym)]
    for (const m of [p1, p2, lapsed]) await tx((db) => sellMembership(db, { ownerId: gym, memberId: m.id, planId: plan.id, paymentMethod: 'cash' }))
    await prisma.membership.updateMany({ where: { memberId: lapsed.id }, data: { status: 'cancelled' } })
    const group = await assign({ planId: plan.id })
    expect(group.created.map((x) => x.member.id).sort()).toEqual([p1.id, p2.id].sort())
    expect(group.created[0].assignment.sourcePlanId).toBe(plan.id)
    await expect(assign({ planId: (await createPlan(gym)).id })).rejects.toMatchObject({ code: 'nobody_on_plan' })

    // Three people press Assign at once for the same member.
    const d = await createMember(gym)
    const race = await Promise.all([1, 2, 3].map(() => assign({ memberIds: [d.id] })))
    expect(race.reduce((n, r) => n + r.created.length, 0)).toBe(1)
    expect(await prisma.programAssignment.count({ where: { programId: program.id, memberId: d.id } })).toBe(1)

    // What cannot be assigned.
    await expect(assign({ memberIds: [(await createMember(other)).id] })).rejects.toMatchObject({ status: 404 })
    await expect(assign({ memberIds: [a.id], coachId: (await prisma.staff.create({ data: { ownerId: other, name: 'Other Coach', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach' } })).id })).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => assignProgram(db, { ownerId: other, programId: program.id, memberIds: [a.id], startDate: today }))).rejects.toMatchObject({ status: 404 })
    const empty = await tx((db) => createProgram(db, gym, programSchema.parse({ name: 'Empty', weeks: 1 })))
    await expect(tx((db) => assignProgram(db, { ownerId: gym, programId: empty.id, memberIds: [a.id], startDate: today }))).rejects.toMatchObject({ code: 'empty_program' })
    await expect(tx((db) => archiveProgram(db, gym, program.id, true))).rejects.toMatchObject({ status: 409, code: 'program_in_use' })

    const roster = await programMembers(gym, program.id)
    expect(roster).toHaveLength(6)
    expect(roster.find((r) => r.member.id === a.id)).toMatchObject({ status: 'active', coach: { name: 'Coach Riley' }, completed: 0 })
    expect(await programMembers(gym, program.id, coach.id)).toHaveLength(1)
    await expect(programMembers(other, program.id)).rejects.toMatchObject({ status: 404 })
  })

  it('pauses, resumes, cancels and finishes an assignment, telling people once', async () => {
    const p = await onProgram()
    const act = (action: string, extra: object = {}) => tx((db) => changeAssignment(db, { ownerId: gym, id: p.assignment.id, action, ...extra } as any))
    expect((await act('pause')).status).toBe('paused')
    // Paused: nothing is offered, and the day cannot be opened.
    expect((await memberWorkouts(gym, p.member.id)).todays).toHaveLength(0)
    await expect(openSession({ ownerId: gym, memberId: p.member.id, source: p.source })).rejects.toMatchObject({ status: 409, code: 'program_paused' })
    // Resumed three days later: what is left has moved back three days.
    await prisma.programAssignment.update({ where: { id: p.assignment.id }, data: { pausedAt: new Date(Date.now() - 3 * DAY) } })
    const resumed = await act('resume')
    expect(resumed).toMatchObject({ status: 'active', pausedDays: 3, pausedAt: null })
    const view = await memberWorkouts(gym, p.member.id)
    expect(view.todays).toHaveLength(0)
    expect(view.upcoming[0]).toMatchObject({ date: addDaysToDate(today, 3), kind: 'program' })
    await expect(act('resume')).rejects.toMatchObject({ code: 'not_paused' })
    await expect(tx((db) => changeAssignment(db, { ownerId: other, id: p.assignment.id, action: 'cancel' }))).rejects.toMatchObject({ status: 404 })
    // A coach can only act on assignments they coach.
    await expect(tx((db) => changeAssignment(db, { ownerId: gym, id: p.assignment.id, action: 'pause', own: randomUUID() }))).rejects.toMatchObject({ status: 404 })
    expect((await act('cancel')).status).toBe('cancelled')
    await expect(act('pause')).rejects.toMatchObject({ code: 'assignment_over' })
    await expect(openSession({ ownerId: gym, memberId: p.member.id, source: p.source })).rejects.toMatchObject({ code: 'program_ended' })

    // A program that has run its course completes itself, once.
    const done = await onProgram()
    const future = new Date(Date.now() + 9 * DAY)
    expect(await refreshAssignments(gym, { memberId: done.member.id }, future)).toBe(1)
    expect(await refreshAssignments(gym, { memberId: done.member.id }, future)).toBe(0)
    expect((await prisma.programAssignment.findUniqueOrThrow({ where: { id: done.assignment.id } })).status).toBe('completed')
    expect(await prisma.memberNotification.count({ where: { memberId: done.member.id, type: 'program_completed' } })).toBe(1)
    expect(await prisma.notification.count({ where: { ownerId: gym, type: 'program_completed', href: `/members/${done.member.id}?tab=workouts` } })).toBe(1)
  })

  it('finds yesterday\'s programmed workouts that were not done', async () => {
    const [missed, did] = [await onProgram(), await onProgram()]
    const s = await started(did)
    await logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 135, reps: 5 })
    await completeSession(s.me)
    const tomorrow = new Date(Date.now() + DAY)
    const list = await missedYesterday(gym, tomorrow)
    expect(list.find((m) => m.memberId === missed.member.id)).toMatchObject({ assignmentId: missed.assignment.id, programDayId: missed.day.id, programName: missed.program.name })
    expect(list.find((m) => m.memberId === did.member.id)).toBeUndefined()
    expect((await missedYesterday(other, tomorrow)).length).toBe(0)
    // The automation built on it mentions each missed workout once.
    const automation = await prisma.automation.create({ data: { ownerId: gym, name: 'Missed', trigger: 'workout_missed', channel: 'email', subject: 'Missed', body: '{{workout_name}} from {{program_name}}', delayMinutes: 0, isActive: true } })
    const { scanScheduledTriggers } = await import('@/lib/services/automations')
    await scanScheduledTriggers(gym, tomorrow)
    await scanScheduledTriggers(gym, tomorrow)
    expect(await prisma.automationRun.count({ where: { automationId: automation.id, memberId: missed.member.id } })).toBe(1)
    expect(await prisma.automationRun.count({ where: { automationId: automation.id, memberId: did.member.id } })).toBe(0)
    await prisma.automation.delete({ where: { id: automation.id } })
  })
})

// ---------------------------------------------------------------------------
// The member's side
// ---------------------------------------------------------------------------

describe('a member\'s workouts', () => {
  it('shows today\'s workout, what is coming and where they are in the program, and only their own', async () => {
    const p = await onProgram(undefined, undefined, { weeks: 3 })
    const stranger = await createMember(gym)
    const view = await memberWorkouts(gym, p.member.id)
    expect(view.todays).toHaveLength(1)
    expect(view.todays[0]).toMatchObject({ kind: 'program', date: today, name: p.workout.name, programName: p.program.name, week: 1, status: 'not_started', sessionId: null, estimatedMinutes: 45, source: p.source })
    expect(view.upcoming.map((u) => [u.date, u.week])).toEqual([[addDaysToDate(today, 7), 2]])
    expect(view.programs).toEqual([expect.objectContaining({ name: p.program.name, weeks: 3, week: 1, status: 'active', totalWorkouts: 3, completedWorkouts: 0, percent: 0 })])
    expect(view.recent).toEqual([])
    const theirs = await memberWorkouts(gym, stranger.id)
    expect(theirs).toMatchObject({ todays: [], upcoming: [], programs: [], records: [] })
    // Looking does not create anything.
    expect(await prisma.workoutSession.count({ where: { memberId: p.member.id } })).toBe(0)
  })

  it('opens one session per training day however it is opened, and nobody else\'s', async () => {
    const p = await onProgram()
    const ids = await Promise.all(Array.from({ length: 6 }, () => openSession({ ownerId: gym, memberId: p.member.id, source: p.source, start: true })))
    expect(new Set(ids).size).toBe(1)
    expect(await prisma.workoutSession.count({ where: { assignmentId: p.assignment.id } })).toBe(1)
    const session = await prisma.workoutSession.findUniqueOrThrow({ where: { id: ids[0] } })
    expect(session).toMatchObject({ status: 'in_progress', memberId: p.member.id, workoutId: p.workout.id, programName: p.program.name, programDayId: p.day.id })
    expect(session.scheduledDate!.toISOString().slice(0, 10)).toBe(today)
    const outsider = await createMember(gym)
    const elsewhere = await createMember(other)
    // Another member, or another gym, quoting the same ids gets nothing.
    await expect(openSession({ ownerId: gym, memberId: outsider.id, source: p.source })).rejects.toMatchObject({ status: 404 })
    await expect(openSession({ ownerId: gym, memberId: outsider.id, source: { sessionId: session.id } })).rejects.toMatchObject({ status: 404 })
    await expect(openSession({ ownerId: other, memberId: elsewhere.id, source: p.source })).rejects.toMatchObject({ status: 404 })
    await expect(sessionView(gym, session.id, { memberId: outsider.id })).rejects.toMatchObject({ status: 404 })
    await expect(sessionView(other, session.id, { memberId: p.member.id })).rejects.toMatchObject({ status: 404 })
    // A training day from a different program cannot be opened under this assignment.
    const q = await onProgram()
    await expect(openSession({ ownerId: gym, memberId: p.member.id, source: { assignmentId: p.assignment.id, programDayId: q.day.id } })).rejects.toMatchObject({ status: 404 })
    await expect(openSession({ ownerId: gym, memberId: p.member.id, source: { assignmentId: q.assignment.id, programDayId: q.day.id } })).rejects.toMatchObject({ status: 404 })
  })

  it('logs what was actually done beside the prescription, never over it', async () => {
    const p = await onProgram()
    const s = await started(p)
    const prescribed = JSON.stringify(s.version.content)
    for (const [n, weight, reps] of [[1, 225, 8], [2, 225, 8], [3, 215, 8], [4, 215, 7]] as const) await logSet({ ...s.me, itemId: s.squat.id, setNumber: n, weight, reps, rpe: n === 4 ? 9.5 : undefined })
    // Correcting a set replaces it; it does not add a fifth.
    await logSet({ ...s.me, itemId: s.squat.id, setNumber: 3, weight: 220, reps: 8, notes: 'Felt better' })
    // The same set from two taps at once is still one set.
    await Promise.all(Array.from({ length: 5 }, () => logSet({ ...s.me, itemId: s.squat.id, setNumber: 4, weight: 215, reps: 7 })))
    // A set with nothing but "done" is allowed: not every field has to be filled in.
    await logSet({ ...s.me, itemId: s.pull.id, setNumber: 1 })
    await logSet({ ...s.me, itemId: s.pull.id, setNumber: 2, reps: 9 })
    expect((await deleteSet({ ...s.me, itemId: s.pull.id, setNumber: 1 })).deleted).toBe(1)

    const view = await sessionView(gym, s.sessionId, { memberId: p.member.id })
    const [squat, pull] = view.workout.blocks.flatMap((b) => b.items)
    expect(squat).toMatchObject({ exerciseName: 'Back Squat', reps: '8', weight: 225, weightUnit: 'lb', expectedSets: 4 })
    expect(squat.logged.map((x) => [x.setNumber, x.weight, x.reps])).toEqual([[1, 225, 8], [2, 225, 8], [3, 220, 8], [4, 215, 7]])
    expect(squat.logged[2]).toMatchObject({ notes: 'Felt better', weightUnit: 'lb' })
    expect(pull.logged.map((x) => [x.setNumber, x.reps])).toEqual([[2, 9]])
    // The prescription is exactly what the coach wrote.
    expect(JSON.stringify((await prisma.workoutVersion.findUniqueOrThrow({ where: { id: s.version.id } })).content)).toBe(prescribed)
    expect(view.workout.instructions).toBe('Warm up first.')

    await expect(logSet({ ...s.me, itemId: 'not-in-this-workout', setNumber: 1, reps: 5 })).rejects.toMatchObject({ code: 'unknown_item' })
    const outsider = await createMember(gym)
    await expect(logSet({ ownerId: gym, memberId: outsider.id, sessionId: s.sessionId, itemId: s.squat.id, setNumber: 1, weight: 999, reps: 1 })).rejects.toMatchObject({ status: 404 })
    await expect(deleteSet({ ownerId: gym, memberId: outsider.id, sessionId: s.sessionId, itemId: s.squat.id, setNumber: 1 })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.workoutSetLog.count({ where: { sessionId: s.sessionId } })).toBe(5)
  })

  it('records a scale or a substitution as what was done, from the options the coach allowed', async () => {
    const p = await onProgram()
    const s = await started(p)
    const [scaled, alternative] = s.pull.scaling
    await logSet({ ...s.me, itemId: s.pull.id, setNumber: 1, reps: 4 })
    const chosen = await setApproach({ ...s.me, itemId: s.pull.id, performedAs: 'scaled', scalingId: scaled.id, note: 'Shoulder is sore' })
    expect(chosen).toMatchObject({ performedAs: 'scaled', scalingId: scaled.id, exerciseName: 'Band-Assisted Pull-up', note: 'Shoulder is sore' })
    await logSet({ ...s.me, itemId: s.pull.id, setNumber: 2, reps: 10 })
    // Both sets now count as what was actually done.
    expect((await prisma.workoutSetLog.findMany({ where: { sessionId: s.sessionId, itemId: s.pull.id } })).map((x) => x.exerciseName)).toEqual(['Band-Assisted Pull-up', 'Band-Assisted Pull-up'])
    // Only the coach's options: not one made up, and not one from another exercise.
    await expect(setApproach({ ...s.me, itemId: s.pull.id, performedAs: 'scaled', scalingId: 'made-up' })).rejects.toMatchObject({ code: 'unknown_scaling' })
    await expect(setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'scaled', scalingId: scaled.id })).rejects.toMatchObject({ code: 'unknown_scaling' })
    await setApproach({ ...s.me, itemId: s.pull.id, performedAs: 'scaled', scalingId: alternative.id })
    expect((await prisma.workoutSetLog.findFirstOrThrow({ where: { sessionId: s.sessionId, itemId: s.pull.id } })).exerciseName).toBe('Lat Pulldown')

    // Substituting the squat for something from the library is recorded as a substitution.
    await logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 95, reps: 10 })
    const sub = await setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'substituted', exerciseId: sys['Thruster'], note: 'No rack free' })
    expect(sub).toMatchObject({ performedAs: 'substituted', exerciseId: sys['Thruster'], exerciseName: 'Thruster' })
    await expect(setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'substituted', exerciseId: sys['Back Squat'] })).rejects.toMatchObject({ code: 'same_exercise' })
    await expect(setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'substituted' })).rejects.toMatchObject({ code: 'unknown_exercise' })
    const theirs = await createExercise(prisma, other, exerciseSchema.parse({ name: 'Other Gym Sub', category: 'core' }))
    await expect(setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'substituted', exerciseId: theirs.id })).rejects.toMatchObject({ code: 'unknown_exercise' })

    const view = await sessionView(gym, s.sessionId, { memberId: p.member.id })
    const [squat, pull] = view.workout.blocks.flatMap((b) => b.items)
    // Prescribed and performed, side by side.
    expect(squat).toMatchObject({ exerciseName: 'Back Squat', weight: 225, approach: { performedAs: 'substituted', exerciseName: 'Thruster', note: 'No rack free' } })
    expect(squat.logged[0]).toMatchObject({ exerciseName: 'Thruster', weight: 95, reps: 10 })
    expect(pull).toMatchObject({ exerciseName: 'Pull-up', reps: '10', approach: { performedAs: 'scaled', scalingId: alternative.id } })
    expect(itemsOf(await prisma.workoutVersion.findUniqueOrThrow({ where: { id: s.version.id } })).map((i) => i.exerciseName)).toEqual(['Back Squat', 'Pull-up'])
    // Back to as written.
    expect(await setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'rx' })).toMatchObject({ performedAs: 'rx', exerciseId: null })
    expect((await prisma.workoutSetLog.findFirstOrThrow({ where: { sessionId: s.sessionId, itemId: s.squat.id } })).exerciseName).toBe('Back Squat')
    // Skipping an exercise clears its sets and stops more being logged until it is undone.
    await setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'skipped', note: 'Knee' })
    expect(await prisma.workoutSetLog.count({ where: { sessionId: s.sessionId, itemId: s.squat.id } })).toBe(0)
    await expect(logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 225, reps: 8 })).rejects.toMatchObject({ status: 409, code: 'item_skipped' })
  })

  it('completes once, fixes the result, and cannot be finished empty', async () => {
    const p = await onProgram(undefined, undefined, { coachId: (await prisma.staff.create({ data: { ownerId: gym, name: 'Coach Finn', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })).id })
    const s = await started(p)
    await expect(completeSession(s.me)).rejects.toMatchObject({ code: 'nothing_logged' })
    await logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 225, reps: 8 })
    const results = await Promise.all(Array.from({ length: 5 }, () => completeSession({ ...s.me, notes: 'Good session', durationSec: 2700 })))
    expect(results.filter((r) => !r.alreadyCompleted)).toHaveLength(1)
    const again = await completeSession(s.me)
    expect(again).toMatchObject({ alreadyCompleted: true, records: [] })
    const session = await prisma.workoutSession.findUniqueOrThrow({ where: { id: s.sessionId } })
    expect(session).toMatchObject({ status: 'completed', durationSec: 2700, memberNotes: 'Good session', coachName: 'Coach Finn', programName: p.program.name, workoutVersionId: s.version.id })
    expect(session.completedAt).toBeTruthy()
    // Everything recorded once: the timeline entry, the coach's notice, the starting-point records.
    expect(await prisma.activity.count({ where: { memberId: p.member.id, type: 'workout_completed' } })).toBe(1)
    expect(await prisma.notification.count({ where: { ownerId: gym, type: 'workout_completed', staffId: p.assignment.coachId, title: { contains: p.workout.name } } })).toBe(1)
    expect(await prisma.personalRecord.count({ where: { sessionId: s.sessionId } })).toBe(3)
    // Finished means fixed.
    await expect(logSet({ ...s.me, itemId: s.squat.id, setNumber: 2, weight: 500, reps: 1 })).rejects.toMatchObject({ status: 409, code: 'session_completed' })
    await expect(deleteSet({ ...s.me, itemId: s.squat.id, setNumber: 1 })).rejects.toMatchObject({ code: 'session_completed' })
    await expect(setApproach({ ...s.me, itemId: s.squat.id, performedAs: 'skipped' })).rejects.toMatchObject({ code: 'session_completed' })
    await expect(skipSession(s.me)).rejects.toMatchObject({ code: 'session_completed' })
    expect(await prisma.workoutSetLog.count({ where: { sessionId: s.sessionId } })).toBe(1)
    const view = await memberWorkouts(gym, p.member.id)
    expect(view.todays[0]).toMatchObject({ status: 'completed', sessionId: s.sessionId })
    expect(view.programs[0]).toMatchObject({ completedWorkouts: 1, totalWorkouts: 1, percent: 100 })
    expect(view.recent[0]).toMatchObject({ id: s.sessionId, name: p.workout.name, durationSec: 2700 })
    expect(view.totals.completed).toBe(1)

    // Skipping is its own outcome, and a skipped workout can be picked up again.
    const q = await onProgram()
    const id = await openSession({ ownerId: gym, memberId: q.member.id, source: q.source })
    expect((await prisma.workoutSession.findUniqueOrThrow({ where: { id } })).status).toBe('not_started')
    await skipSession({ ownerId: gym, memberId: q.member.id, sessionId: id, notes: 'Travelling' })
    expect((await memberWorkouts(gym, q.member.id)).todays[0].status).toBe('skipped')
    const item = itemsOf(await prisma.workoutVersion.findUniqueOrThrow({ where: { id: (await prisma.workoutSession.findUniqueOrThrow({ where: { id } })).workoutVersionId } }))[0]
    await logSet({ ownerId: gym, memberId: q.member.id, sessionId: id, itemId: item.id, setNumber: 1, weight: 135, reps: 5 })
    expect((await prisma.workoutSession.findUniqueOrThrow({ where: { id } })).status).toBe('in_progress')
  })
})

describe('versioning', () => {
  it('keeps a finished workout exactly as it was done when the coach changes the workout afterwards', async () => {
    const p = await onProgram(undefined, undefined, { weeks: 2 })
    const s = await started(p)
    await logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 225, reps: 8 })
    await logSet({ ...s.me, itemId: s.pull.id, setNumber: 1, reps: 10 })
    await completeSession(s.me)
    const before = await sessionView(gym, s.sessionId, { memberId: p.member.id })
    const snapshot = JSON.stringify({ blocks: before.workout.blocks.map((b) => b.items.map((i) => [i.exerciseName, i.sets, i.reps, i.weight])), name: before.workout.name, sets: before.workout.blocks.flatMap((b) => b.items.flatMap((i) => i.logged)) })
    expect(before.workout).toMatchObject({ version: 1, changedSince: false })

    // The coach rewrites it: new name, heavier squat, pull-ups replaced by rows.
    const edited = await tx((db) => updateWorkout(db, gym, p.workout.id, workoutUpdateSchema.parse({
      name: 'Lower (rebuilt)', instructions: 'New instructions.',
      content: { blocks: [{ type: 'straight', items: [{ exerciseId: sys['Back Squat'], sets: 5, reps: '5', weight: 275, weightUnit: 'lb' }] }, { type: 'straight', items: [{ exerciseId: sys['Barbell Row'], sets: 3, reps: '12' }] }] },
    })))
    expect(edited).toMatchObject({ newVersion: true, previousVersion: 1 })
    expect(edited.version.version).toBe(2)
    // And renames an exercise in the gym's own library for good measure.
    expect(await prisma.workoutVersion.count({ where: { workoutId: p.workout.id } })).toBe(2)

    const after = await sessionView(gym, s.sessionId, { memberId: p.member.id })
    expect(JSON.stringify({ blocks: after.workout.blocks.map((b) => b.items.map((i) => [i.exerciseName, i.sets, i.reps, i.weight])), name: after.workout.name, sets: after.workout.blocks.flatMap((b) => b.items.flatMap((i) => i.logged)) })).toBe(snapshot)
    expect(after.workout).toMatchObject({ version: 1, changedSince: true, instructions: 'Warm up first.' })
    expect(after.workout.blocks.flatMap((b) => b.items).map((i) => i.exerciseName)).toEqual(['Back Squat', 'Pull-up'])
    expect((await workoutHistory(gym, p.member.id)).items[0]).toMatchObject({ id: s.sessionId, version: 1, sets: 2 })
    expect((await prisma.workoutSession.findUniqueOrThrow({ where: { id: s.sessionId } })).workoutVersionId).toBe(s.version.id)

    // The next time the workout comes round, it is the new one.
    const week2 = await prisma.programDay.findFirstOrThrow({ where: { programId: p.program.id, week: 2 } })
    const nextId = await openSession({ ownerId: gym, memberId: p.member.id, source: { assignmentId: p.assignment.id, programDayId: week2.id }, start: true })
    const next = await sessionView(gym, nextId, { memberId: p.member.id })
    expect(next.workout).toMatchObject({ version: 2, name: 'Lower (rebuilt)', changedSince: false })
    expect(next.workout.blocks.flatMap((b) => b.items).map((i) => [i.exerciseName, i.sets, i.weight])).toEqual([['Back Squat', 5, 275], ['Barbell Row', 3, null]])
    // What they did last time is offered as a guide, taken from the old version's log.
    expect(next.workout.blocks[0].items[0].lastTime?.sets).toEqual(['225 lb × 8'])

    const detail = await workoutDetail(gym, p.workout.id)
    expect(detail).toMatchObject({ version: 2, name: 'Lower (rebuilt)', inUse: true })
    expect(detail.versions.map((v) => [v.version, v.sessions, v.current])).toEqual([[2, 1, true], [1, 1, false]])
    expect((await workoutDetail(gym, p.workout.id, 1)).content.blocks[0].items[0]).toMatchObject({ sets: 4, weight: 225 })
  })

  it('corrects a workout in place while nobody has trained from it, and never mid-session', async () => {
    const { workout, version } = await strength()
    const fixed = await tx((db) => updateWorkout(db, gym, workout.id, { name: 'Typo Fixed' }))
    expect(fixed).toMatchObject({ newVersion: false })
    expect(fixed.version).toMatchObject({ id: version.id, version: 1, name: 'Typo Fixed' })

    // Assigned but not started: the member gets the workout as it stands when they start.
    const member = await createMember(gym)
    const given = await tx((db) => assignWorkout(db, { ownerId: gym, workoutId: workout.id, memberIds: [member.id], date: today }))
    const sessionId = given.created[0].session.id
    const v2 = await tx((db) => updateWorkout(db, gym, workout.id, { instructions: 'Changed before anyone started' }))
    expect(v2.newVersion).toBe(true)
    await openSession({ ownerId: gym, memberId: member.id, source: { sessionId }, start: true })
    expect((await prisma.workoutSession.findUniqueOrThrow({ where: { id: sessionId } })).workoutVersionId).toBe(v2.version.id)
    // Started and logging: a change now does not reach them.
    const item = itemsOf(v2.version)[0]
    await logSet({ ownerId: gym, memberId: member.id, sessionId, itemId: item.id, setNumber: 1, weight: 200, reps: 5 })
    const v3 = await tx((db) => updateWorkout(db, gym, workout.id, workoutUpdateSchema.parse({ content: { blocks: [{ type: 'straight', items: [{ exerciseId: sys['Bench Press'], sets: 3, reps: '5' }] }] } })))
    expect(v3.version.version).toBe(3)
    await logSet({ ownerId: gym, memberId: member.id, sessionId, itemId: item.id, setNumber: 2, weight: 200, reps: 5 })
    const view = await sessionView(gym, sessionId, { memberId: member.id })
    expect(view.workout).toMatchObject({ version: 2, changedSince: true })
    expect(view.workout.blocks[0].items[0]).toMatchObject({ exerciseName: 'Back Squat' })
    expect(view.workout.blocks[0].items[0].logged).toHaveLength(2)

    // Renaming or retiring an exercise in the library does not rewrite a version or a logged set.
    const mine = await createExercise(prisma, gym, exerciseSchema.parse({ name: 'Gym Special', category: 'core', measure: 'reps' }))
    const w = await tx((db) => createWorkout(db, gym, workoutSchema.parse({ name: 'Special Day', content: { blocks: [{ type: 'straight', items: [{ exerciseId: mine.id, sets: 2, reps: '20' }] }] } })))
    const who = await createMember(gym)
    const sid = (await tx((db) => assignWorkout(db, { ownerId: gym, workoutId: w.workout.id, memberIds: [who.id], date: today }))).created[0].session.id
    await logSet({ ownerId: gym, memberId: who.id, sessionId: sid, itemId: itemsOf(w.version)[0].id, setNumber: 1, reps: 20 })
    await completeSession({ ownerId: gym, memberId: who.id, sessionId: sid })
    await updateExercise(prisma, gym, mine.id, { name: 'Renamed Later' })
    await retireExercise(prisma, gym, mine.id)
    const old = await sessionView(gym, sid, { memberId: who.id })
    expect(old.workout.blocks[0].items[0]).toMatchObject({ exerciseName: 'Gym Special' })
    expect(old.workout.blocks[0].items[0].logged[0].exerciseName).toBe('Gym Special')
    expect((await memberRecords(gym, who.id)).records[0].name).toBe('Gym Special')
  })
})

describe('records through real workouts', () => {
  it('marks a first result as a starting point and a better one as a record, with what it beat', async () => {
    const p = await onProgram(undefined, undefined, { weeks: 3 })
    const days = await prisma.programDay.findMany({ where: { programId: p.program.id }, orderBy: { week: 'asc' } })
    const run = async (week: number, sets: [number, number][]) => {
      const sessionId = await openSession({ ownerId: gym, memberId: p.member.id, source: { assignmentId: p.assignment.id, programDayId: days[week - 1].id }, start: true })
      const item = itemsOf(await prisma.workoutVersion.findUniqueOrThrow({ where: { id: (await prisma.workoutSession.findUniqueOrThrow({ where: { id: sessionId } })).workoutVersionId } }))[0]
      for (const [i, [weight, reps]] of sets.entries()) await logSet({ ownerId: gym, memberId: p.member.id, sessionId, itemId: item.id, setNumber: i + 1, weight, reps })
      return completeSession({ ownerId: gym, memberId: p.member.id, sessionId, now: new Date(Date.now() + week * 1000) })
    }
    const first = await run(1, [[225, 8], [225, 8]])
    expect(first.records.map((r) => [r.type, r.value, r.isRecord])).toEqual([['estimated_1rm', '285 lb', false], ['heaviest_weight', '225 lb', false], ['reps_at_weight', '8 reps', false]])
    expect(await prisma.memberNotification.count({ where: { memberId: p.member.id, type: 'personal_record' } })).toBe(0)
    expect((await memberWorkouts(gym, p.member.id)).records).toEqual([])

    // Week 2 (opened a week early: within the window): heavier.
    const second = await run(2, [[245, 5], [225, 8]])
    const real = second.records.filter((r) => r.isRecord)
    expect(real.map((r) => [r.type, r.previous, r.value])).toEqual([['estimated_1rm', '285 lb', '285.8 lb'], ['heaviest_weight', '225 lb', '245 lb']])
    expect(second.records.find((r) => r.type === 'reps_at_weight')).toMatchObject({ isRecord: false, value: '5 reps' })
    // One line for the member about it.
    const notices = await prisma.memberNotification.findMany({ where: { memberId: p.member.id, type: 'personal_record' } })
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toBe('New personal record: Back Squat, 245 lb')

    // Week 3: lighter. No record, and no notice.
    const third = await run(3, [[205, 8]])
    expect(third.records.filter((r) => r.isRecord)).toEqual([])
    expect(await prisma.memberNotification.count({ where: { memberId: p.member.id, type: 'personal_record' } })).toBe(1)

    const bests = (await memberRecords(gym, p.member.id)).records
    expect(bests.map((r) => [r.name, r.type, r.value])).toEqual([['Back Squat', 'estimated_1rm', '285.8 lb'], ['Back Squat', 'heaviest_weight', '245 lb']])
    const history = (await memberRecords(gym, p.member.id, { exerciseId: sys['Back Squat'] })).records.filter((r) => r.type === 'heaviest_weight')
    expect(history.map((r) => [r.value, r.previous])).toEqual([['245 lb', '225 lb'], ['225 lb', null]])
    expect((await memberWorkouts(gym, p.member.id)).records.map((r) => r.value).sort()).toEqual(['245 lb', '285.8 lb'])
    // Another member's records are their own.
    expect((await memberRecords(gym, (await createMember(gym)).id)).records).toEqual([])
    expect((await memberRecords(other, p.member.id)).records).toEqual([])
  })

  it('scores a "for time" workout, and counts a record only when it was done as written', async () => {
    const { workout, version } = await tx((db) => createWorkout(db, gym, workoutSchema.parse({ name: `Fran ${randomUUID().slice(0, 4)}`, type: 'conditioning', content: { blocks: [{ type: 'for_time', instructions: '21-15-9', items: [{ exerciseId: sys['Thruster'], reps: '21-15-9', weight: 95, weightUnit: 'lb', scaling: [{ label: 'Scaled', weight: 65, weightUnit: 'lb' }] }, { exerciseId: sys['Pull-up'], reps: '21-15-9' }] }] } })))
    const member = await createMember(gym)
    const [thruster] = itemsOf(version)
    const go = async (day: number, timeSec: number, scaled = false) => {
      const sessionId = (await tx((db) => assignWorkout(db, { ownerId: gym, workoutId: workout.id, memberIds: [member.id], date: addDaysToDate(today, day) }))).created[0].session.id
      const me = { ownerId: gym, memberId: member.id, sessionId }
      if (scaled) await setApproach({ ...me, itemId: thruster.id, performedAs: 'scaled', scalingId: thruster.scaling[0].id })
      return completeSession({ ...me, timeSec, now: new Date(Date.now() + day * 1000) })
    }
    expect((await go(0, 420)).records.map((r) => [r.type, r.value, r.isRecord])).toEqual([['fastest_time', '7:00', false]])
    expect((await go(1, 395)).records.map((r) => [r.type, r.previous, r.value, r.isRecord])).toEqual([['fastest_time', '7:00', '6:35', true]])
    expect((await go(2, 410)).records).toEqual([])
    // A scaled run is quicker but is not the same workout.
    expect((await go(3, 300, true)).records).toEqual([])
    const view = await workoutHistory(gym, member.id)
    expect(view.items.map((i) => i.result)).toEqual(['5:00', '6:50', '6:35', '7:00'])
    expect((await memberRecords(gym, member.id)).records).toEqual([expect.objectContaining({ type: 'fastest_time', value: '6:35', workoutId: workout.id })])
  })

  it('pages through a long history a few at a time', async () => {
    const member = await createMember(gym)
    const { workout, version } = await strength()
    const base = Date.now() - 400 * DAY
    await prisma.workoutSession.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ ownerId: gym, memberId: member.id, workoutId: workout.id, workoutVersionId: version.id, status: 'completed', completedAt: new Date(base + i * DAY), durationSec: 1800 + i })) })
    const first = await workoutHistory(gym, member.id)
    expect(first.items).toHaveLength(15)
    expect(first.nextBefore).toBeTruthy()
    const second = await workoutHistory(gym, member.id, { before: first.nextBefore })
    const third = await workoutHistory(gym, member.id, { before: second.nextBefore })
    expect([second.items.length, third.items.length, third.nextBefore]).toEqual([15, 10, null])
    const all = [...first.items, ...second.items, ...third.items]
    expect(new Set(all.map((i) => i.id)).size).toBe(40)
    expect(all.map((i) => i.completedAt!.getTime())).toEqual([...all.map((i) => i.completedAt!.getTime())].sort((a, b) => b - a))
    // The overview stays small however long the history is.
    const overview = await memberWorkouts(gym, member.id)
    expect(overview.recent).toHaveLength(5)
    expect(overview.totals.completed).toBe(40)
    expect((await workoutHistory(gym, member.id, { take: 500 })).items.length).toBeLessThanOrEqual(50)
  })
})

describe('classes and appointments', () => {
  it('shows a class\'s workout to the members booked into it, and keeps doing it separate from attending', async () => {
    const plan = await createPlan(gym)
    const join = async () => { const m = await createMember(gym); await tx((db) => sellMembership(db, { ownerId: gym, memberId: m.id, planId: plan.id, paymentMethod: 'cash', startDate: new Date(Date.now() - DAY) })); return m }
    const [booked, notBooked] = [await join(), await join()]
    const { workout } = await strength('Class WOD')
    const cls = await createSession(gym, { startsAt: new Date(Date.now() + 2 * 3_600_000), endsAt: new Date(Date.now() + 3 * 3_600_000), capacity: 10, title: 'Monday 6 PM CrossFit' })
    await tx((db) => bookClass(db, { ownerId: gym, memberId: booked.id, sessionId: cls.id, source: 'staff' }))
    // No workout attached yet: nothing to see.
    expect((await memberWorkouts(gym, booked.id)).todays.concat((await memberWorkouts(gym, booked.id)).upcoming)).toEqual([])
    await prisma.classSession.update({ where: { id: cls.id }, data: { workoutId: workout.id } })
    const view = await memberWorkouts(gym, booked.id)
    const entry = [...view.todays, ...view.upcoming][0]
    expect(entry).toMatchObject({ kind: 'class', name: 'Class WOD', context: 'Monday 6 PM CrossFit', status: 'not_started', source: { classSessionId: cls.id } })
    expect((await memberWorkouts(gym, notBooked.id)).todays.concat((await memberWorkouts(gym, notBooked.id)).upcoming)).toEqual([])
    await expect(openSession({ ownerId: gym, memberId: notBooked.id, source: { classSessionId: cls.id } })).rejects.toMatchObject({ status: 404 })

    const bookingBefore = await prisma.booking.findFirstOrThrow({ where: { memberId: booked.id, sessionId: cls.id } })
    const ids = await Promise.all([1, 2, 3].map(() => openSession({ ownerId: gym, memberId: booked.id, source: { classSessionId: cls.id }, start: true })))
    expect(new Set(ids).size).toBe(1)
    const item = itemsOf(await prisma.workoutVersion.findUniqueOrThrow({ where: { id: (await prisma.workoutSession.findUniqueOrThrow({ where: { id: ids[0] } })).workoutVersionId } }))[0]
    await logSet({ ownerId: gym, memberId: booked.id, sessionId: ids[0], itemId: item.id, setNumber: 1, weight: 135, reps: 8 })
    await completeSession({ ownerId: gym, memberId: booked.id, sessionId: ids[0] })
    // Finishing the workout is not attendance: the booking is untouched and nobody was checked in.
    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: bookingBefore.id } })
    expect(bookingAfter).toMatchObject({ status: 'booked', checkedInAt: null })
    expect(await prisma.checkin.count({ where: { memberId: booked.id } })).toBe(0)
    // And attending is not finishing the workout.
    const { markAttendance } = await import('@/lib/services/bookings')
    const other2 = await join()
    const b2 = await tx((db) => bookClass(db, { ownerId: gym, memberId: other2.id, sessionId: cls.id, source: 'staff' }))
    await prisma.classSession.update({ where: { id: cls.id }, data: { startsAt: new Date(Date.now() - 600_000) } })
    await tx((db) => markAttendance(db, { ownerId: gym, bookingId: b2.booking.id, attended: true } as any))
    expect(await prisma.workoutSession.count({ where: { memberId: other2.id } })).toBe(0)
    expect((await memberWorkouts(gym, other2.id)).todays[0]).toMatchObject({ kind: 'class', status: 'not_started' })
  })

  it('carries a workout on a one-to-one appointment without changing the appointment', async () => {
    const coach = await prisma.staff.create({ data: { ownerId: gym, name: 'Trainer Toni', email: `${randomUUID()}@test.local`, password: 'x', role: 'trainer', isCoach: true } })
    await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId: gym, staffId: coach.id, weekday, startMinute: 0, endMinute: 1440, kind: 'work' })) })
    const type = await prisma.appointmentType.create({ data: { ownerId: gym, name: 'PT Session', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 90, staff: { create: [{ staffId: coach.id, ownerId: gym }] } } })
    const [client, stranger] = [await createMember(gym), await createMember(gym)]
    const startsAt = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 300_000) * 300_000)
    const { appointment } = await bookAppointment({ ownerId: gym, typeId: type.id, memberId: client.id, staffId: coach.id, startsAt, source: 'staff', override: true })
    const { workout } = await strength('PT Plan')
    await prisma.appointment.update({ where: { id: appointment.id }, data: { workoutId: workout.id } })
    const view = await memberWorkouts(gym, client.id)
    expect([...view.todays, ...view.upcoming][0]).toMatchObject({ kind: 'appointment', name: 'PT Plan', coachName: 'Trainer Toni', context: 'PT Session with Trainer Toni', source: { appointmentId: appointment.id } })
    await expect(openSession({ ownerId: gym, memberId: stranger.id, source: { appointmentId: appointment.id } })).rejects.toMatchObject({ status: 404 })
    const sessionId = await openSession({ ownerId: gym, memberId: client.id, source: { appointmentId: appointment.id }, start: true })
    expect(await prisma.workoutSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ appointmentId: appointment.id, coachId: coach.id, coachName: 'Trainer Toni' })
    // The appointment is still what it was.
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ status: 'booked', staffId: coach.id, memberId: client.id })
  })
})

describe('coach views and notes', () => {
  it('shows who had a workout today and what became of it, to the right coach', async () => {
    const g = await createGym({ timezone: 'UTC' })
    try {
      const [riley, sam] = await Promise.all(['Riley', 'Sam'].map((name) => prisma.staff.create({ data: { ownerId: g, name: `Coach ${name}`, email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })))
      const w = (await strength('Day Workout', g)).workout
      const done = await onProgram(undefined, w.id, { ownerId: g, coachId: riley.id })
      const going = await onProgram(undefined, w.id, { ownerId: g, coachId: riley.id })
      const idle = await onProgram(undefined, w.id, { ownerId: g, coachId: sam.id })
      const s = await started(done)
      await logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 225, reps: 8 })
      await completeSession({ ...s.me, notes: 'Hips felt tight' })
      await started(going)
      const day = await coachingDay(g, {})
      expect(day).toMatchObject({ isToday: true, summary: { due: 3, completed: 1, inProgress: 1, notStarted: 1, missed: 0 }, assignments: { active: 3 } })
      expect(day.rows.find((r) => r.member.id === done.member.id)).toMatchObject({ status: 'completed', note: 'Hips felt tight', workout: 'Day Workout' })
      expect(day.rows.find((r) => r.member.id === idle.member.id)).toMatchObject({ status: 'not_started', sessionId: null })
      expect(day.recent[0]).toMatchObject({ workout: 'Day Workout', note: 'Hips felt tight' })
      // Each coach sees their own members; yesterday's undone workouts read as missed.
      expect((await coachingDay(g, { own: riley.id })).summary).toMatchObject({ due: 2, completed: 1 })
      expect((await coachingDay(g, { own: sam.id })).rows.map((r) => r.member.id)).toEqual([idle.member.id])
      expect((await coachingDay(g, { own: randomUUID() })).rows).toEqual([])
      expect((await coachingDay(other, {})).rows).toEqual([])
      // A coach can open the progress of a member they coach, and not of one they do not.
      expect((await memberProgress(g, done.member.id, riley.id)).history[0]).toMatchObject({ name: 'Day Workout' })
      await expect(memberProgress(g, idle.member.id, riley.id)).rejects.toMatchObject({ status: 403, code: 'not_your_member' })
      await expect(sessionView(g, s.sessionId, { staff: true, own: sam.id })).rejects.toMatchObject({ code: 'not_your_member' })
      await expect(memberProgress(other, done.member.id)).rejects.toMatchObject({ status: 404 })
    } finally {
      await prisma.workoutSession.deleteMany({ where: { ownerId: g } })
      await destroyGym(g)
    }
  })

  it('keeps a coach\'s private note from the member, and delivers feedback written for them', async () => {
    const p = await onProgram()
    const s = await started(p)
    await logSet({ ...s.me, itemId: s.squat.id, setNumber: 1, weight: 225, reps: 8 })
    await completeSession({ ...s.me, notes: 'Left knee clicked on set 1' })
    const actor = { type: 'staff' as const, id: randomUUID(), name: 'Coach Casey' }
    await tx((db) => saveCoachNote(db, { ownerId: gym, sessionId: s.sessionId, coachNotes: 'PRIVATE: watch for knee valgus, do not mention weight', actor }))
    await tx((db) => saveCoachNote(db, { ownerId: gym, sessionId: s.sessionId, coachFeedback: 'Great depth today. Add 5 lb next week.', actor }))
    await tx((db) => saveCoachNote(db, { ownerId: gym, sessionId: s.sessionId, coachFeedback: 'Great depth today. Add 5 lb next week.', actor }))

    const staff = await sessionView(gym, s.sessionId, { staff: true })
    expect(staff).toMatchObject({ coachNotes: 'PRIVATE: watch for knee valgus, do not mention weight', coachFeedback: 'Great depth today. Add 5 lb next week.', memberNotes: 'Left knee clicked on set 1', member: { id: p.member.id } })
    const mine = await sessionView(gym, s.sessionId, { memberId: p.member.id })
    expect(mine).toMatchObject({ coachFeedback: 'Great depth today. Add 5 lb next week.', memberNotes: 'Left knee clicked on set 1' })
    expect('coachNotes' in mine).toBe(false)
    expect(JSON.stringify(mine)).not.toContain('PRIVATE')
    // Not in anything else the member is sent, either.
    for (const payload of [await memberWorkouts(gym, p.member.id), await workoutHistory(gym, p.member.id), await memberRecords(gym, p.member.id)]) expect(JSON.stringify(payload)).not.toContain('PRIVATE')
    expect(JSON.stringify(await prisma.memberNotification.findMany({ where: { memberId: p.member.id } }))).not.toContain('PRIVATE')
    // The feedback reached them once.
    const notices = await prisma.memberNotification.findMany({ where: { memberId: p.member.id, type: 'coach_feedback' } })
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toBe(`Coach Casey left a note on ${p.workout.name}`)
    expect((await memberProgress(gym, p.member.id)).coachNotes[0]).toMatchObject({ note: 'PRIVATE: watch for knee valgus, do not mention weight' })
    await expect(tx((db) => saveCoachNote(db, { ownerId: other, sessionId: s.sessionId, coachNotes: 'x' }))).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => saveCoachNote(db, { ownerId: gym, sessionId: s.sessionId, coachNotes: 'x', own: randomUUID() }))).rejects.toMatchObject({ code: 'not_your_member' })
    // An exercise's coach notes are staff-only too.
    const w = await tx((db) => createWorkout(db, gym, workoutSchema.parse({ name: 'Sled Day', content: { blocks: [{ type: 'straight', items: [{ exerciseId: ex.sled, sets: 4, distanceM: 20 }] }] } })))
    const sid = (await tx((db) => assignWorkout(db, { ownerId: gym, workoutId: w.workout.id, memberIds: [p.member.id], date: today }))).created[0].session.id
    expect(JSON.stringify(await sessionView(gym, sid, { memberId: p.member.id }))).not.toContain('back lane')
  })

  it('assigns a single workout for a day once, and tells the member', async () => {
    const { workout } = await strength('One-off')
    const [a, b] = [await createMember(gym), await createMember(gym)]
    const first = await tx((db) => assignWorkout(db, { ownerId: gym, workoutId: workout.id, memberIds: [a.id, b.id], date: today, actor: { type: 'staff', id: randomUUID(), name: 'Coach Casey' } }))
    expect(first.created).toHaveLength(2)
    const again = await tx((db) => assignWorkout(db, { ownerId: gym, workoutId: workout.id, memberIds: [a.id, b.id], date: today }))
    expect(again).toMatchObject({ created: [], skipped: 2 })
    expect(await prisma.workoutSession.count({ where: { workoutId: workout.id } })).toBe(2)
    expect((await memberWorkouts(gym, a.id)).todays[0]).toMatchObject({ kind: 'assigned', name: 'One-off', context: 'From Coach Casey', status: 'not_started' })
    expect(await prisma.memberNotification.count({ where: { memberId: a.id, type: 'workout_assigned' } })).toBe(1)
    await expect(tx(async (db) => assignWorkout(db, { ownerId: gym, workoutId: workout.id, memberIds: [(await createMember(other)).id], date: today }))).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => assignWorkout(db, { ownerId: other, workoutId: workout.id, memberIds: [a.id], date: today }))).rejects.toMatchObject({ status: 404 })
  })
})

// ---------------------------------------------------------------------------
// Over HTTP: permissions and tenant isolation
// ---------------------------------------------------------------------------

async function call(auth: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text }
}

describe.skipIf(!up)('workout programming over HTTP', () => {
  const who: Record<string, { cookie: string; id: string }> = {}
  let owner: string
  let foreignOwner: string
  const ROLES = ['admin', 'manager', 'coach', 'trainer', 'sales', 'front_desk', 'accountant'] as const
  const COACHING = ['admin', 'manager', 'coach', 'trainer']

  beforeAll(async () => {
    owner = `auth-token=${await createToken({ ownerId: gym, emailVerified: true })}`
    foreignOwner = `auth-token=${await createToken({ ownerId: other, emailVerified: true })}`
    for (const role of ROLES) {
      const row = await prisma.staff.create({ data: { ownerId: gym, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role, isCoach: role === 'coach' || role === 'trainer' } })
      who[role] = { id: row.id, cookie: `auth-token=${await createToken({ ownerId: gym, staffId: row.id, role: role as any })}` }
    }
  })
  const allowed = async (roles: readonly string[], method: string, path: string, body?: unknown) => {
    for (const role of ROLES) {
      const status = (await call(who[role].cookie, method, path, body)).status
      expect(status !== 403, `${role} ${method} ${path} -> ${status}`).toBe(roles.includes(role))
    }
    expect((await call(null, method, path, body)).status, `signed out ${method} ${path}`).toBe(401)
  }
  const workoutBody = (name: string) => ({ name, type: 'strength', content: { blocks: [{ type: 'straight', items: [{ exerciseId: sys['Back Squat'], sets: 3, reps: '5', weight: 185, weightUnit: 'lb' }] }] } })

  it('opens the coaching area to coaches and managers, and to nobody on sales, the desk or accounts', async () => {
    for (const path of ['/api/coaching/exercises', '/api/coaching/workouts', '/api/coaching/programs', '/api/coaching/day']) await allowed(COACHING, 'GET', path)
    await allowed(COACHING, 'POST', '/api/coaching/exercises', { name: `Perm ${randomUUID().slice(0, 6)}`, category: 'core' })
    await allowed(COACHING, 'POST', '/api/coaching/workouts', workoutBody(`Perm ${randomUUID().slice(0, 6)}`))
    await allowed(COACHING, 'POST', '/api/coaching/programs', { name: `Perm ${randomUUID().slice(0, 6)}`, weeks: 2 })
    const member = await createMember(gym)
    for (const role of ['sales', 'front_desk', 'accountant']) expect((await call(who[role].cookie, 'GET', `/api/members/${member.id}/workouts`)).status, role).toBe(403)
    expect((await call(who.manager.cookie, 'GET', `/api/members/${member.id}/workouts`)).status).toBe(200)
    // A coach has no claim on a member they do not coach.
    expect((await call(who.coach.cookie, 'GET', `/api/members/${member.id}/workouts`)).json.code).toBe('not_your_member')
    const list = await call(who.coach.cookie, 'GET', '/api/coaching/exercises?search=Sled')
    expect(list.data[0]).toMatchObject({ name: 'Sled Push', system: false })
    expect(list.json.meta.suggestedCategories).toContain('olympic lift')
  })

  it('lets a coach change what they built, a manager anything, and no gym another gym\'s', async () => {
    const mine = await call(who.coach.cookie, 'POST', '/api/coaching/workouts', workoutBody('Coach Built'))
    const theirs = await call(who.manager.cookie, 'POST', '/api/coaching/workouts', workoutBody('Manager Built'))
    expect((await call(who.coach.cookie, 'PATCH', `/api/coaching/workouts/${mine.data.id}`, { name: 'Coach Built v2' })).status).toBe(200)
    const refused = await call(who.coach.cookie, 'PATCH', `/api/coaching/workouts/${theirs.data.id}`, { name: 'Coach Took It' })
    expect([refused.status, refused.json.code]).toEqual([403, 'not_yours'])
    expect((await call(who.coach.cookie, 'DELETE', `/api/coaching/workouts/${theirs.data.id}`)).status).toBe(403)
    expect((await call(who.trainer.cookie, 'PATCH', `/api/coaching/workouts/${mine.data.id}`, { name: 'Trainer Took It' })).status).toBe(403)
    expect((await call(who.manager.cookie, 'PATCH', `/api/coaching/workouts/${mine.data.id}`, { name: 'Manager Fixed' })).status).toBe(200)
    expect((await call(who.coach.cookie, 'GET', '/api/coaching/workouts?search=Manager')).data.filter((w: any) => [mine.data.id, theirs.data.id].includes(w.id)).map((w: any) => [w.name, w.canEdit]).sort()).toEqual([['Manager Built', false], ['Manager Fixed', true]])
    // A coach can copy someone else's workout and change the copy.
    const copy = await call(who.coach.cookie, 'POST', `/api/coaching/workouts/${theirs.data.id}`, { action: 'duplicate' })
    expect((await call(who.coach.cookie, 'PATCH', `/api/coaching/workouts/${copy.data.id}`, { name: 'My Version' })).status).toBe(200)
    // Programs follow the same rule.
    const program = await call(who.manager.cookie, 'POST', '/api/coaching/programs', { name: 'Manager Program', weeks: 1, days: [{ week: 1, day: 1, workoutId: theirs.data.id }] })
    expect((await call(who.coach.cookie, 'PATCH', `/api/coaching/programs/${program.data.id}`, { name: 'Coach Took It' })).json.code).toBe('not_yours')
    // A coach assigns members to themselves, not to another coach.
    const m = await createMember(gym)
    expect((await call(who.coach.cookie, 'POST', `/api/coaching/programs/${program.data.id}`, { action: 'assign', assignment: { memberIds: [m.id], startDate: today, coachId: who.trainer.id } })).status).toBe(403)
    const assigned = await call(who.coach.cookie, 'POST', `/api/coaching/programs/${program.data.id}`, { action: 'assign', assignment: { memberIds: [m.id], startDate: today } })
    expect(assigned.data).toEqual({ assigned: 1, alreadyOn: [] })
    expect((await prisma.programAssignment.findFirstOrThrow({ where: { memberId: m.id } })).coachId).toBe(who.coach.id)
    expect((await call(who.coach.cookie, 'GET', `/api/members/${m.id}/workouts`)).status).toBe(200)
    expect((await call(who.trainer.cookie, 'GET', `/api/members/${m.id}/workouts`)).status).toBe(403)

    // Another gym: nothing of this gym's can be read, changed, copied, assigned or attached.
    const exercise = await call(owner, 'POST', '/api/coaching/exercises', { name: 'Private Gym Move', category: 'core', coachNotes: 'private' })
    const outsider = await createMember(other)
    for (const [method, path, body] of [
      ['GET', `/api/coaching/workouts/${theirs.data.id}`], ['PATCH', `/api/coaching/workouts/${theirs.data.id}`, { name: 'Stolen' }], ['DELETE', `/api/coaching/workouts/${theirs.data.id}`],
      ['POST', `/api/coaching/workouts/${theirs.data.id}`, { action: 'duplicate' }],
      ['POST', `/api/coaching/workouts/${theirs.data.id}`, { action: 'assign', memberIds: [outsider.id], date: today }],
      ['GET', `/api/coaching/programs/${program.data.id}`], ['PATCH', `/api/coaching/programs/${program.data.id}`, { name: 'Stolen' }], ['DELETE', `/api/coaching/programs/${program.data.id}`],
      ['GET', `/api/coaching/programs/${program.data.id}/members`],
      ['GET', `/api/coaching/exercises/${exercise.data.id}`], ['PATCH', `/api/coaching/exercises/${exercise.data.id}`, { name: 'Stolen' }], ['DELETE', `/api/coaching/exercises/${exercise.data.id}`],
      ['POST', `/api/coaching/exercises/${exercise.data.id}`, { action: 'copy' }],
      ['GET', `/api/members/${m.id}/workouts`],
    ] as const) expect((await call(foreignOwner, method, path, body)).status, `${method} ${path}`).toBe(404)
    for (const path of ['/api/coaching/workouts', '/api/coaching/programs', '/api/coaching/exercises?scope=gym', '/api/coaching/day']) {
      const seen = (await call(foreignOwner, 'GET', path)).text
      for (const name of ['Manager Built', 'Manager Program', 'Private Gym Move']) expect(seen, `${path} leaks ${name}`).not.toContain(name)
    }
    // Their own program cannot be given this gym's workouts or members.
    const elsewhere = await call(foreignOwner, 'POST', '/api/coaching/programs', { name: 'Elsewhere', weeks: 1, days: [{ week: 1, day: 1, workoutId: theirs.data.id }] })
    expect(elsewhere.status).toBe(404)
    expect((await call(foreignOwner, 'POST', '/api/coaching/workouts', { name: 'Borrowed', content: { blocks: [{ type: 'straight', items: [{ exerciseId: exercise.data.id }] }] } })).json.code).toBe('unknown_exercise')
    expect((await prisma.workout.findUniqueOrThrow({ where: { id: theirs.data.id } })).name).toBe('Manager Built')
    // A built-in exercise cannot be changed by any gym, the owner included.
    expect((await call(owner, 'PATCH', `/api/coaching/exercises/${sys['Back Squat']}`, { name: 'Renamed For Everyone' })).json.code).toBe('system_exercise')
    expect((await call(owner, 'DELETE', `/api/coaching/exercises/${sys['Back Squat']}`)).status).toBe(403)
  })

  it('attaches a workout to a class or an appointment for the people allowed to, inside the gym', async () => {
    const w = await call(who.manager.cookie, 'POST', '/api/coaching/workouts', workoutBody('Attach Me'))
    const cls = await createSession(gym, { coachId: who.coach.id })
    const notMine = await createSession(gym, { coachId: who.trainer.id })
    await allowed(COACHING.filter((r) => r !== 'trainer'), 'PUT', `/api/schedule/sessions/${cls.id}/workout`, { workoutId: w.data.id })
    // A coach sets the workout for their own classes only.
    expect((await call(who.trainer.cookie, 'PUT', `/api/schedule/sessions/${cls.id}/workout`, { workoutId: w.data.id })).json.code).toBe('not_your_class')
    expect((await call(who.coach.cookie, 'PUT', `/api/schedule/sessions/${notMine.id}/workout`, { workoutId: w.data.id })).json.code).toBe('not_your_class')
    expect((await call(who.manager.cookie, 'GET', `/api/schedule/sessions/${cls.id}`)).data.workout).toEqual({ id: w.data.id, name: 'Attach Me' })
    const foreign = (await strength('Foreign', other)).workout
    expect((await call(owner, 'PUT', `/api/schedule/sessions/${cls.id}/workout`, { workoutId: foreign.id })).status).toBe(404)
    expect((await call(foreignOwner, 'PUT', `/api/schedule/sessions/${cls.id}/workout`, { workoutId: foreign.id })).status).toBe(404)
    expect((await prisma.classSession.findUniqueOrThrow({ where: { id: cls.id } })).workoutId).toBe(w.data.id)
    expect((await call(who.coach.cookie, 'PUT', `/api/schedule/sessions/${cls.id}/workout`, { workoutId: null })).data.workoutId).toBeNull()
    // The class itself is as it was.
    expect(await prisma.classSession.findUniqueOrThrow({ where: { id: cls.id } })).toMatchObject({ status: 'scheduled', coachId: who.coach.id, capacity: cls.capacity })

    await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId: gym, staffId: who.trainer.id, weekday, startMinute: 0, endMinute: 1440, kind: 'work' })) })
    const type = await prisma.appointmentType.create({ data: { ownerId: gym, name: 'PT', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 90, staff: { create: [{ staffId: who.trainer.id, ownerId: gym }] } } })
    const client = await createMember(gym)
    const { appointment } = await bookAppointment({ ownerId: gym, typeId: type.id, memberId: client.id, staffId: who.trainer.id, startsAt: new Date(Math.ceil((Date.now() + 26 * 3_600_000) / 300_000) * 300_000), source: 'staff', override: true })
    const path = `/api/appointments/${appointment.id}/workout`
    expect((await call(who.front_desk.cookie, 'PUT', path, { workoutId: w.data.id })).status).toBe(403)
    expect((await call(who.coach.cookie, 'PUT', path, { workoutId: w.data.id })).status).toBe(404)
    expect((await call(foreignOwner, 'PUT', path, { workoutId: w.data.id })).status).toBe(404)
    expect((await call(who.trainer.cookie, 'PUT', path, { workoutId: w.data.id })).data).toEqual({ workoutId: w.data.id, workoutName: 'Attach Me' })
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ workoutId: w.data.id, status: 'booked', staffId: who.trainer.id })
  })

  describe('the member app', () => {
    let a: Awaited<ReturnType<typeof onProgram>>
    let b: Awaited<ReturnType<typeof onProgram>>
    let bearerA: string
    let bearerB: string

    beforeAll(async () => {
      a = await onProgram(undefined, undefined, { coachId: who.coach.id })
      b = await onProgram()
      for (const m of [a.member, b.member]) { const { token } = await createInvite(gym, m.id); await setPasswordWithToken(token, 'a-long-test-password-1') }
      bearerA = await memberBearer(a.member.id)
      bearerB = await memberBearer(b.member.id)
    })

    it('gives each member their own training and nobody else\'s', async () => {
      const mine = await call(bearerA, 'GET', '/api/portal/me/workouts')
      expect(mine.status).toBe(200)
      expect(mine.data.todays).toHaveLength(1)
      expect(mine.data.todays[0]).toMatchObject({ name: a.workout.name, programName: a.program.name, status: 'not_started' })
      expect(mine.text).not.toContain(b.program.name)
      expect((await call(null, 'GET', '/api/portal/me/workouts')).status).toBe(401)
      // The member is whoever is signed in. A member id in the request changes nothing.
      const opened = await call(bearerA, 'POST', '/api/portal/me/workouts/sessions', { source: a.source, start: true, memberId: b.member.id })
      expect(opened.status).toBe(200)
      expect(await prisma.workoutSession.count({ where: { memberId: b.member.id } })).toBe(0)
      // Nor can extra ids be smuggled into the source itself.
      expect((await call(bearerA, 'POST', '/api/portal/me/workouts/sessions', { source: { ...a.source, memberId: b.member.id } })).status).toBe(400)
      const session = await call(bearerA, 'POST', '/api/portal/me/workouts/sessions', { source: a.source, start: true })
      expect(session.data).toMatchObject({ status: 'in_progress', programName: a.program.name, source: 'program' })
      expect((await prisma.workoutSession.findUniqueOrThrow({ where: { id: session.data.id } })).memberId).toBe(a.member.id)
      const [squat, pull] = session.data.workout.blocks.flatMap((x: any) => x.items)
      expect(squat).toMatchObject({ exerciseName: 'Back Squat', sets: 4, reps: '8', weight: 225, restSec: 120 })
      expect(pull.scaling.map((x: any) => x.label)).toEqual(['Scaled', 'Alternative'])

      // B cannot open A's program day, read A's session, or write to it in any way.
      expect((await call(bearerB, 'POST', '/api/portal/me/workouts/sessions', { source: a.source })).status).toBe(404)
      expect((await call(bearerB, 'POST', '/api/portal/me/workouts/sessions', { source: { sessionId: session.data.id } })).status).toBe(404)
      const path = `/api/portal/me/workouts/sessions/${session.data.id}`
      expect((await call(bearerB, 'GET', path)).status).toBe(404)
      for (const body of [
        { action: 'set', set: { itemId: squat.id, setNumber: 1, weight: 999, reps: 1 } }, { action: 'delete_set', itemId: squat.id, setNumber: 1 },
        { action: 'approach', approach: { itemId: squat.id, performedAs: 'skipped' } }, { action: 'notes', notes: 'not mine' },
        { action: 'complete', result: {} }, { action: 'skip' }, { action: 'start' },
      ]) expect((await call(bearerB, 'POST', path, body)).status, body.action).toBe(404)
      expect(await prisma.workoutSetLog.count({ where: { sessionId: session.data.id } })).toBe(0)
      expect((await prisma.workoutSession.findUniqueOrThrow({ where: { id: session.data.id } })).status).toBe('in_progress')

      // A logs, scales, notes and finishes through the app.
      expect((await call(bearerA, 'POST', path, { action: 'set', set: { itemId: squat.id, setNumber: 1, weight: 225, reps: 8 } })).data.set).toMatchObject({ weight: 225, reps: 8, exerciseName: 'Back Squat' })
      expect((await call(bearerA, 'POST', path, { action: 'set', set: { itemId: squat.id, setNumber: 1, weight: 5001, reps: 8 } })).status).toBe(400)
      expect((await call(bearerA, 'POST', path, { action: 'set', set: { itemId: squat.id, setNumber: 0, reps: 8 } })).status).toBe(400)
      expect((await call(bearerA, 'POST', path, { action: 'approach', approach: { itemId: pull.id, performedAs: 'scaled', scalingId: pull.scaling[0].id } })).data.approach).toMatchObject({ exerciseName: 'Band-Assisted Pull-up' })
      expect((await call(bearerA, 'POST', path, { action: 'approach', approach: { itemId: pull.id, performedAs: 'scaled', scalingId: 'invented' } })).json.code).toBe('unknown_scaling')
      expect((await call(bearerA, 'POST', path, { action: 'set', set: { itemId: pull.id, setNumber: 1, reps: 10 } })).data.set.exerciseName).toBe('Band-Assisted Pull-up')
      const done = await call(bearerA, 'POST', path, { action: 'complete', result: { notes: 'Solid' } })
      expect(done.data).toMatchObject({ alreadyCompleted: false, session: { status: 'completed', memberNotes: 'Solid' } })
      expect((await call(bearerA, 'POST', path, { action: 'complete', result: {} })).data.alreadyCompleted).toBe(true)
      expect((await call(bearerA, 'POST', path, { action: 'set', set: { itemId: squat.id, setNumber: 2, weight: 225, reps: 8 } })).json.code).toBe('session_completed')

      // History and records are theirs alone.
      expect((await call(bearerA, 'GET', '/api/portal/me/workouts/history')).data.items.map((i: any) => i.id)).toEqual([session.data.id])
      expect((await call(bearerB, 'GET', '/api/portal/me/workouts/history')).data.items).toEqual([])
      expect((await call(bearerA, 'GET', '/api/portal/me/workouts/records')).data.records.length).toBeGreaterThan(0)
      expect((await call(bearerB, 'GET', '/api/portal/me/workouts/records')).data.records).toEqual([])
      expect((await call(bearerB, 'GET', `/api/portal/me/workouts/records?exerciseId=${sys['Back Squat']}`)).data.records).toEqual([])

      // The coach sees it, writes a private note and feedback; only the feedback reaches the member.
      const coachView = await call(who.coach.cookie, 'GET', `/api/coaching/sessions/${session.data.id}`)
      expect(coachView.data).toMatchObject({ status: 'completed', memberNotes: 'Solid', member: { id: a.member.id } })
      expect((await call(who.trainer.cookie, 'GET', `/api/coaching/sessions/${session.data.id}`)).status).toBe(403)
      expect((await call(who.front_desk.cookie, 'GET', `/api/coaching/sessions/${session.data.id}`)).status).toBe(403)
      expect((await call(foreignOwner, 'GET', `/api/coaching/sessions/${session.data.id}`)).status).toBe(404)
      expect((await call(foreignOwner, 'PATCH', `/api/coaching/sessions/${session.data.id}`, { coachNotes: 'x' })).status).toBe(404)
      expect((await call(who.coach.cookie, 'PATCH', `/api/coaching/sessions/${session.data.id}`, { coachNotes: 'STAFF-ONLY-NOTE', coachFeedback: 'Nice work on the squats.' })).status).toBe(200)
      for (const path2 of ['/api/portal/me/workouts', path, '/api/portal/me/workouts/history', '/api/portal/me/workouts/records', '/api/portal/me', '/api/portal/me/notifications']) {
        const res = await call(bearerA, 'GET', path2)
        expect(res.status, path2).toBe(200)
        expect(res.text, path2).not.toContain('STAFF-ONLY-NOTE')
        expect(res.text, path2).not.toContain('coachNotes')
      }
      expect((await call(bearerA, 'GET', path)).data.coachFeedback).toBe('Nice work on the squats.')
      // Exercise coach notes do not reach members through the substitution picker either.
      const picker = await call(bearerA, 'GET', '/api/portal/me/workouts/exercises?search=Sled')
      expect(picker.data[0]).toMatchObject({ name: 'Sled Push' })
      expect(picker.text).not.toContain('back lane')
      expect(picker.text).not.toContain('coachNotes')
    })

    it('gives members no way into the coaching area', async () => {
      for (const [method, path, body] of [
        ['GET', '/api/coaching/workouts'], ['GET', '/api/coaching/programs'], ['GET', '/api/coaching/exercises'], ['GET', '/api/coaching/day'],
        ['POST', '/api/coaching/workouts', { name: 'x', content: { blocks: [] } }], ['PATCH', `/api/coaching/workouts/${a.workout.id}`, { name: 'Mine now' }],
        ['GET', `/api/members/${b.member.id}/workouts`], ['POST', `/api/coaching/assignments/${a.assignment.id}`, { action: 'complete' }],
        ['POST', `/api/coaching/programs/${b.program.id}`, { action: 'assign', assignment: { memberIds: [a.member.id], startDate: today } }],
      ] as const) expect((await call(bearerA, method, path, body)).status, `${method} ${path}`).toBe(401)
      expect((await prisma.workout.findUniqueOrThrow({ where: { id: a.workout.id } })).name).toBe(a.workout.name)
    })
  })
})
