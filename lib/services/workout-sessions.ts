// A member doing a workout.
//
// A WorkoutSession ties one member to one version of one workout on one occasion. The version is the
// prescription and is never written to from here. What the member actually did goes in WorkoutSetLog
// (one row per set) and WorkoutItemLog (how they approached each exercise: as written, scaled,
// substituted or skipped). Completing a session fixes it: the sets are locked, records are worked
// out once, and later edits to the workout cannot reach it because it points at its own version.

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { addDaysToDate, startOfZonedDay, zonedParts } from '@/lib/dates'
import { WorkoutContent, allItems, expectedSets, findItem, scoring } from '@/lib/workouts/content'
import { Best, LoggedSet, RECORD_LABELS, RecordType, detectRecords, recordKey, recordValue } from '@/lib/workouts/records'
import { dateOf, fromDay, position, toDay } from '@/lib/workouts/schedule'
import { ActorRef, Db, getGymSettings, lockRow, logActivity, notify } from './core'
import { memberExerciseView, visibleTo } from './exercises'
import { LIVE_ASSIGNMENTS, refreshAssignments, timing } from './programs'

const SPOT = ['booked', 'attended']

export type SessionSource =
  | { sessionId: string }
  | { assignmentId: string; programDayId: string }
  | { classSessionId: string }
  | { appointmentId: string }

export const sourceSchema = z.union([
  z.object({ sessionId: z.string().uuid() }).strict(),
  z.object({ assignmentId: z.string().uuid(), programDayId: z.string().uuid() }).strict(),
  z.object({ classSessionId: z.string().uuid() }).strict(),
  z.object({ appointmentId: z.string().uuid() }).strict(),
])

// ---------------------------------------------------------------------------
// The member's overview
// ---------------------------------------------------------------------------

export interface Entry {
  key: string
  kind: 'program' | 'assigned' | 'class' | 'appointment'
  date: string
  /** A clock time for things that have one (a class, an appointment). */
  startsAt: Date | null
  workoutId: string
  name: string
  estimatedMinutes: number | null
  programName: string | null
  week: number | null
  coachName: string | null
  context: string | null
  sessionId: string | null
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'missed'
  source: SessionSource
}

/**
 * Everything the member's Workouts tab opens with: today, what is coming, where they are in their
 * program, and a few recent results. A fixed number of queries whatever the member's history.
 */
export async function memberWorkouts(ownerId: string, memberId: string, now = new Date()) {
  await refreshAssignments(ownerId, { memberId }, now)
  const settings = await getGymSettings(ownerId)
  const tz = settings.timezone
  const today = zonedParts(now, tz).date
  const from = addDaysToDate(today, -6)
  const to = addDaysToDate(today, 13)
  const dayStart = startOfZonedDay(now, tz)
  const horizon = new Date(dayStart.getTime() + 8 * 86_400_000)

  const assignments = await prisma.programAssignment.findMany({ where: { ownerId, memberId, status: { in: LIVE_ASSIGNMENTS } }, orderBy: { startDate: 'asc' }, take: 10 })
  const programIds = Array.from(new Set(assignments.map((a) => a.programId)))
  const [programs, days, programSessions, loose, bookings, appointments, recent, records, totals] = await Promise.all([
    prisma.program.findMany({ where: { ownerId, id: { in: programIds } }, select: { id: true, name: true, weeks: true, goals: true, description: true } }),
    prisma.programDay.findMany({ where: { ownerId, programId: { in: programIds } }, select: { id: true, programId: true, week: true, day: true, workoutId: true, title: true } }),
    prisma.workoutSession.findMany({ where: { ownerId, memberId, assignmentId: { in: assignments.map((a) => a.id) } }, select: { id: true, assignmentId: true, programDayId: true, status: true, completedAt: true } }),
    prisma.workoutSession.findMany({
      where: { ownerId, memberId, assignmentId: null, classSessionId: null, appointmentId: null, OR: [{ status: 'in_progress' }, { status: 'not_started', scheduledDate: { gte: fromDay(from), lte: fromDay(to) } }, { status: { in: ['completed', 'skipped'] }, scheduledDate: fromDay(today) }] },
      orderBy: { scheduledDate: 'asc' }, take: 30, select: { id: true, workoutId: true, scheduledDate: true, status: true, coachName: true, assignedByName: true },
    }),
    prisma.booking.findMany({
      where: { ownerId, memberId, status: { in: SPOT }, session: { status: 'scheduled', workoutId: { not: null }, startsAt: { gte: dayStart, lt: horizon } } },
      orderBy: { session: { startsAt: 'asc' } }, take: 20,
      select: { session: { select: { id: true, startsAt: true, title: true, workoutId: true, classType: { select: { name: true } }, coach: { select: { name: true } } } } },
    }),
    prisma.appointment.findMany({
      where: { ownerId, memberId, status: { in: ['booked', 'completed'] }, workoutId: { not: null }, startsAt: { gte: dayStart, lt: horizon } },
      orderBy: { startsAt: 'asc' }, take: 20, select: { id: true, startsAt: true, workoutId: true, type: { select: { name: true } }, staff: { select: { name: true } } },
    }),
    prisma.workoutSession.findMany({ where: { ownerId, memberId, status: 'completed' }, orderBy: { completedAt: 'desc' }, take: 5, select: { id: true, workoutId: true, workoutVersionId: true, completedAt: true, durationSec: true, programName: true, result: true } }),
    prisma.personalRecord.findMany({ where: { ownerId, memberId, previousValue: { not: null } }, orderBy: { achievedAt: 'desc' }, take: 5 }),
    prisma.workoutSession.count({ where: { ownerId, memberId, status: 'completed' } }),
  ])
  const attached = await prisma.workoutSession.findMany({
    where: { ownerId, memberId, OR: [{ classSessionId: { in: bookings.map((b) => b.session.id) } }, { appointmentId: { in: appointments.map((a) => a.id) } }] },
    select: { id: true, classSessionId: true, appointmentId: true, status: true },
  })
  const workoutIds = Array.from(new Set([...days.map((d) => d.workoutId), ...loose.map((s) => s.workoutId), ...bookings.map((b) => b.session.workoutId!), ...appointments.map((a) => a.workoutId!), ...recent.map((r) => r.workoutId)]))
  const [workouts, versions, coaches] = await Promise.all([
    prisma.workout.findMany({ where: { ownerId, id: { in: workoutIds } }, select: { id: true, name: true, estimatedMinutes: true } }),
    prisma.workoutVersion.findMany({ where: { id: { in: recent.map((r) => r.workoutVersionId) } }, select: { id: true, name: true } }),
    prisma.staff.findMany({ where: { ownerId, id: { in: assignments.map((a) => a.coachId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ])
  const workout = (id: string) => workouts.find((w) => w.id === id)
  const entries: Entry[] = []
  const state = (status: string | undefined, date: string): Entry['status'] => (status === 'completed' || status === 'skipped' || status === 'in_progress' ? status : date < today ? 'missed' : 'not_started')

  const progress = assignments.map((a) => {
    const program = programs.find((p) => p.id === a.programId)!
    const t = timing(a, tz)
    const mine = days.filter((d) => d.programId === a.programId)
    const dated = mine.map((d) => ({ d, date: dateOf(t, d.week, d.day, today) })).filter((x) => x.date) as { d: (typeof mine)[number]; date: string }[]
    const sessions = programSessions.filter((s) => s.assignmentId === a.id)
    const coach = coaches.find((c) => c.id === a.coachId)?.name || null
    if (a.status !== 'paused') {
      for (const { d, date } of dated) {
        if (date < from || date > to) continue
        const session = sessions.find((s) => s.programDayId === d.id)
        // Something done long ago is history, not part of this week.
        if (date < today && session && ['completed', 'skipped'].includes(session.status)) continue
        entries.push({
          key: `p:${a.id}:${d.id}`, kind: 'program', date, startsAt: null, workoutId: d.workoutId, name: d.title || workout(d.workoutId)?.name || 'Workout', estimatedMinutes: workout(d.workoutId)?.estimatedMinutes || null,
          programName: program.name, week: d.week, coachName: coach, context: `${program.name} · week ${d.week}`, sessionId: session?.id || null, status: state(session?.status, date), source: { assignmentId: a.id, programDayId: d.id },
        })
      }
    }
    const done = sessions.filter((s) => s.status === 'completed').length
    const at = position(t, program.weeks, today)
    return {
      id: a.id, programId: program.id, name: program.name, goals: program.goals, description: program.description, weeks: program.weeks, status: a.status, coachName: coach,
      startDate: t.startDate, endDate: t.endDate, week: at.week, notStarted: at.notStarted, totalWorkouts: dated.length, completedWorkouts: done,
      percent: dated.length ? Math.min(100, Math.round((done / dated.length) * 100)) : 0,
    }
  })
  for (const s of loose) {
    const date = s.scheduledDate ? toDay(s.scheduledDate) : today
    entries.push({ key: `s:${s.id}`, kind: 'assigned', date: s.status === 'in_progress' && date < today ? today : date, startsAt: null, workoutId: s.workoutId, name: workout(s.workoutId)?.name || 'Workout', estimatedMinutes: workout(s.workoutId)?.estimatedMinutes || null, programName: null, week: null, coachName: s.coachName, context: s.assignedByName ? `From ${s.assignedByName}` : null, sessionId: s.id, status: state(s.status, date), source: { sessionId: s.id } })
  }
  for (const b of bookings) {
    const session = attached.find((x) => x.classSessionId === b.session.id)
    const date = zonedParts(b.session.startsAt, tz).date
    entries.push({ key: `c:${b.session.id}`, kind: 'class', date, startsAt: b.session.startsAt, workoutId: b.session.workoutId!, name: workout(b.session.workoutId!)?.name || 'Workout', estimatedMinutes: workout(b.session.workoutId!)?.estimatedMinutes || null, programName: null, week: null, coachName: b.session.coach?.name || null, context: b.session.title || b.session.classType.name, sessionId: session?.id || null, status: session ? state(session.status, date) : 'not_started', source: { classSessionId: b.session.id } })
  }
  for (const a of appointments) {
    const session = attached.find((x) => x.appointmentId === a.id)
    const date = zonedParts(a.startsAt, tz).date
    entries.push({ key: `a:${a.id}`, kind: 'appointment', date, startsAt: a.startsAt, workoutId: a.workoutId!, name: workout(a.workoutId!)?.name || 'Workout', estimatedMinutes: workout(a.workoutId!)?.estimatedMinutes || null, programName: null, week: null, coachName: a.staff.name, context: `${a.type.name} with ${a.staff.name}`, sessionId: session?.id || null, status: session ? state(session.status, date) : 'not_started', source: { appointmentId: a.id } })
  }
  entries.sort((x, y) => x.date.localeCompare(y.date) || (x.startsAt?.getTime() || 0) - (y.startsAt?.getTime() || 0) || x.name.localeCompare(y.name))
  return {
    today,
    todays: entries.filter((e) => e.date === today),
    upcoming: entries.filter((e) => e.date > today).slice(0, 12),
    /** Programmed workouts from the last week that were not done. They can still be done today. */
    missed: entries.filter((e) => e.date < today && e.status === 'missed').slice(-5),
    programs: progress,
    recent: recent.map((r) => ({ id: r.id, name: versions.find((v) => v.id === r.workoutVersionId)?.name || workout(r.workoutId)?.name || 'Workout', completedAt: r.completedAt, durationSec: r.durationSec, programName: r.programName, result: resultText(r.result) })),
    records: records.map(recordView),
    totals: { completed: totals },
  }
}

const resultText = (result: Prisma.JsonValue | null) => {
  const r = (result || {}) as { timeSec?: number; rounds?: number; reps?: number }
  if (r.timeSec) return recordValue('fastest_time', r.timeSec, 'sec')
  if (r.rounds != null) return recordValue('most_rounds', r.rounds + (r.reps || 0) / 1000, 'rounds')
  return null
}

export const recordView = (r: { id: string; name: string; type: string; bucket: string; value: number; unit: string; previousValue: number | null; detail: string | null; achievedAt: Date; exerciseId: string | null; workoutId: string | null; sessionId: string }) => ({
  id: r.id, name: r.name, type: r.type, label: RECORD_LABELS[r.type as RecordType] || r.type, exerciseId: r.exerciseId, workoutId: r.workoutId, sessionId: r.sessionId,
  value: recordValue(r.type, r.value, r.unit), previous: r.previousValue == null ? null : recordValue(r.type, r.previousValue, r.unit), detail: r.detail, at: r.achievedAt,
  /** False for the first time something was recorded: a starting point, not a record. */
  isRecord: r.previousValue != null,
})

// ---------------------------------------------------------------------------
// Opening a session
// ---------------------------------------------------------------------------

/**
 * Find the member's session for a program day, a class, an appointment or a workout their coach
 * assigned, creating it if this is the first time they have opened it. The version is fixed here:
 * whatever the workout looks like at this moment is what they will be doing.
 */
export async function openSession(input: { ownerId: string; memberId: string; source: SessionSource; start?: boolean }) {
  const { ownerId, memberId, source } = input
  const settings = await getGymSettings(ownerId)
  const today = zonedParts(new Date(), settings.timezone).date
  return prisma.$transaction(async (db) => {
    let session: { id: string } | null = null
    if ('sessionId' in source) {
      session = await db.workoutSession.findFirst({ where: { id: source.sessionId, ownerId, memberId }, select: { id: true } })
      if (!session) throw notFound('Workout')
    } else {
      let data: Omit<Prisma.WorkoutSessionCreateManyInput, 'ownerId' | 'memberId' | 'workoutVersionId'> & { workoutId: string }
      if ('assignmentId' in source) {
        const assignment = await db.programAssignment.findFirst({ where: { id: source.assignmentId, ownerId, memberId } })
        if (!assignment) throw notFound('Program')
        if (assignment.status === 'paused') throw new ApiError(409, 'This program is paused. Ask your coach to resume it.', 'program_paused')
        if (assignment.status === 'cancelled') throw new ApiError(409, 'This program has ended.', 'program_ended')
        const day = await db.programDay.findFirst({ where: { id: source.programDayId, ownerId, programId: assignment.programId } })
        if (!day) throw notFound('Workout')
        const [program, coach] = await Promise.all([db.program.findUniqueOrThrow({ where: { id: assignment.programId }, select: { name: true } }), assignment.coachId ? db.staff.findFirst({ where: { id: assignment.coachId, ownerId }, select: { name: true } }) : null])
        const date = dateOf(timing(assignment, settings.timezone), day.week, day.day, today)
        if (!date) throw new ApiError(409, 'That training day is outside your program.', 'outside_program')
        if (date > addDaysToDate(today, 14)) throw new ApiError(409, 'That workout is too far ahead to open yet.', 'too_early')
        data = { workoutId: day.workoutId, assignmentId: assignment.id, programDayId: day.id, scheduledDate: fromDay(date), coachId: assignment.coachId, coachName: coach?.name || null, programName: program.name }
      } else if ('classSessionId' in source) {
        const booking = await db.booking.findFirst({ where: { ownerId, memberId, sessionId: source.classSessionId, status: { in: SPOT } }, select: { session: { select: { id: true, workoutId: true, startsAt: true, status: true, coachId: true, coach: { select: { name: true } } } } } })
        // Being booked into the class is what lets a member see its workout.
        if (!booking?.session.workoutId || booking.session.status !== 'scheduled') throw notFound('Workout')
        data = { workoutId: booking.session.workoutId, classSessionId: booking.session.id, scheduledDate: fromDay(zonedParts(booking.session.startsAt, settings.timezone).date), coachId: booking.session.coachId, coachName: booking.session.coach?.name || null }
      } else {
        const appointment = await db.appointment.findFirst({ where: { id: source.appointmentId, ownerId, memberId, status: { in: ['booked', 'completed'] } }, select: { id: true, workoutId: true, startsAt: true, staffId: true, staff: { select: { name: true } } } })
        if (!appointment?.workoutId) throw notFound('Workout')
        data = { workoutId: appointment.workoutId, appointmentId: appointment.id, scheduledDate: fromDay(zonedParts(appointment.startsAt, settings.timezone).date), coachId: appointment.staffId, coachName: appointment.staff.name }
      }
      // Taking the workout's lock means an edit in flight either finishes first or sees this session.
      await lockRow(db, 'Workout', data.workoutId)
      const workout = await db.workout.findFirst({ where: { id: data.workoutId, ownerId }, select: { currentVersionId: true } })
      if (!workout?.currentVersionId) throw notFound('Workout')
      // The unique index decides a race between two taps (or two devices): one row, whoever asks.
      await db.workoutSession.createMany({ data: [{ ...data, ownerId, memberId, workoutVersionId: workout.currentVersionId }], skipDuplicates: true })
      session = await db.workoutSession.findFirst({
        where: { ownerId, memberId, ...('assignmentId' in source ? { assignmentId: source.assignmentId, programDayId: source.programDayId } : 'classSessionId' in source ? { classSessionId: source.classSessionId } : { appointmentId: source.appointmentId }) },
        select: { id: true },
      })
    }
    if (!session) throw notFound('Workout')
    if (input.start) await begin(db, session.id)
    return session.id
  }, { timeout: 15_000 })
}

/** Move a session to "in progress". One that has not been started yet picks up the workout as it is now. */
async function begin(db: Db, sessionId: string) {
  // Always the workout's lock before the session's, the same order opening a session takes them in.
  const which = await db.workoutSession.findUniqueOrThrow({ where: { id: sessionId }, select: { workoutId: true } })
  await lockRow(db, 'Workout', which.workoutId)
  await lockRow(db, 'WorkoutSession', sessionId)
  const session = await db.workoutSession.findUniqueOrThrow({ where: { id: sessionId } })
  if (session.status === 'completed' || session.status === 'in_progress') return session
  const logged = await db.workoutSetLog.count({ where: { sessionId } })
  let versionId = session.workoutVersionId
  if (logged === 0) {
    const workout = await db.workout.findUnique({ where: { id: session.workoutId }, select: { currentVersionId: true } })
    if (workout?.currentVersionId) versionId = workout.currentVersionId
  }
  return db.workoutSession.update({ where: { id: sessionId }, data: { status: 'in_progress', startedAt: session.startedAt || new Date(), workoutVersionId: versionId } })
}

// ---------------------------------------------------------------------------
// Reading a session
// ---------------------------------------------------------------------------

const setView = (s: { id: string; itemId: string; setNumber: number; exerciseName: string; weight: number | null; weightUnit: string | null; reps: number | null; durationSec: number | null; distanceM: number | null; rpe: number | null; notes: string | null }) =>
  ({ id: s.id, itemId: s.itemId, setNumber: s.setNumber, exerciseName: s.exerciseName, weight: s.weight, weightUnit: s.weightUnit, reps: s.reps, durationSec: s.durationSec, distanceM: s.distanceM, rpe: s.rpe, notes: s.notes })

/**
 * One session with its prescription and what has been logged. `viewer` decides what is in it: a
 * member never receives the coach's private notes or an exercise's coach notes.
 */
export async function sessionView(ownerId: string, sessionId: string, viewer: { memberId: string } | { staff: true; own?: string | null }) {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, ownerId, ...('memberId' in viewer && { memberId: viewer.memberId }) },
    include: { sets: { orderBy: [{ itemId: 'asc' }, { setNumber: 'asc' }] }, items: true },
  })
  if (!session) throw notFound('Workout')
  const staff = 'staff' in viewer
  if (staff && viewer.own) await assertCoaches(ownerId, viewer.own, session.memberId)
  const version = await prisma.workoutVersion.findUniqueOrThrow({ where: { id: session.workoutVersionId } })
  const content = version.content as unknown as WorkoutContent
  const exerciseIds = Array.from(new Set(content.blocks.flatMap((b) => b.items.flatMap((i) => [i.exerciseId, ...i.scaling.map((s) => s.exerciseId)])).filter(Boolean))) as string[]
  const [exercises, previous, records, member, current] = await Promise.all([
    prisma.exercise.findMany({ where: { id: { in: exerciseIds } }, select: memberExerciseView }),
    // What they did last time, for every exercise in this workout, in one query.
    session.status === 'completed' ? [] : prisma.workoutSetLog.findMany({
      where: { ownerId, memberId: session.memberId, exerciseId: { in: exerciseIds }, sessionId: { not: session.id }, session: { status: 'completed' } },
      orderBy: { createdAt: 'desc' }, take: 300, select: { exerciseId: true, sessionId: true, setNumber: true, weight: true, weightUnit: true, reps: true, durationSec: true, distanceM: true, createdAt: true },
    }),
    session.status === 'completed' ? prisma.personalRecord.findMany({ where: { ownerId, sessionId: session.id }, orderBy: [{ name: 'asc' }, { type: 'asc' }] }) : [],
    staff ? prisma.member.findFirst({ where: { id: session.memberId, ownerId }, select: { id: true, name: true } }) : null,
    prisma.workout.findUnique({ where: { id: session.workoutId }, select: { currentVersionId: true } }),
  ])
  const last = new Map<string, { at: Date; sets: string[] }>()
  for (const exerciseId of exerciseIds) {
    const mine = previous.filter((p) => p.exerciseId === exerciseId)
    if (mine.length === 0) continue
    const latest = mine.filter((p) => p.sessionId === mine[0].sessionId).sort((a, b) => a.setNumber - b.setNumber)
    last.set(exerciseId, { at: mine[0].createdAt, sets: latest.map((s) => setText(s)).filter(Boolean) })
  }
  return {
    id: session.id, status: session.status, scheduledDate: session.scheduledDate ? toDay(session.scheduledDate) : null, startedAt: session.startedAt, completedAt: session.completedAt, durationSec: session.durationSec,
    result: (session.result || null) as { timeSec?: number; rounds?: number; reps?: number } | null, resultText: resultText(session.result),
    memberNotes: session.memberNotes, coachFeedback: session.coachFeedback, coachName: session.coachName, programName: session.programName, assignedByName: session.assignedByName,
    source: session.assignmentId ? 'program' : session.classSessionId ? 'class' : session.appointmentId ? 'appointment' : 'assigned',
    workout: {
      id: session.workoutId, name: version.name, description: version.description, instructions: version.instructions, type: version.type, difficulty: version.difficulty, estimatedMinutes: version.estimatedMinutes, equipment: version.equipment,
      version: version.version, scoring: scoring(content),
      /** The coach has changed the workout since this was done (or started). What is shown here is what was actually prescribed. */
      changedSince: current?.currentVersionId !== version.id,
      blocks: content.blocks.map((b) => ({
        ...b,
        items: b.items.map((i) => {
          const log = session.items.find((x) => x.itemId === i.id)
          const about = exercises.find((e) => e.id === (log?.exerciseId || i.exerciseId))
          return {
            ...i, expectedSets: expectedSets(b, i),
            exercise: about ? { name: about.name, measure: about.measure, description: about.description, instructions: about.instructions, videoUrl: about.videoUrl, imageUrl: about.imageUrl, primaryMuscle: about.primaryMuscle, equipment: about.equipment } : null,
            approach: { performedAs: log?.performedAs || 'rx', scalingId: log?.scalingId || null, exerciseId: log?.exerciseId || null, exerciseName: log?.exerciseName || null, note: log?.note || null },
            lastTime: last.get(log?.exerciseId || i.exerciseId) || null,
            // What was actually done. Kept under its own name so it can never be mistaken for the prescribed `sets`.
            logged: session.sets.filter((s) => s.itemId === i.id).map(setView),
          }
        }),
      })),
    },
    records: records.map(recordView),
    ...(staff && { member, coachNotes: session.coachNotes }),
  }
}

const setText = (s: { weight: number | null; weightUnit: string | null; reps: number | null; durationSec: number | null; distanceM: number | null }) =>
  [s.weight ? `${s.weight} ${s.weightUnit || 'lb'}` : null, s.reps != null ? `${s.weight ? '× ' : ''}${s.reps}${s.weight ? '' : ' reps'}` : null, s.durationSec ? `${Math.floor(s.durationSec / 60)}:${String(s.durationSec % 60).padStart(2, '0')}` : null, s.distanceM ? `${s.distanceM} m` : null].filter(Boolean).join(' ')

/** A coach or trainer may look at a member they coach: by assignment, by a session of theirs, or as the member's assigned coach. */
export async function assertCoaches(ownerId: string, staffId: string, memberId: string) {
  const [assigned, programmed, led] = await Promise.all([
    prisma.member.count({ where: { id: memberId, ownerId, assignedStaffId: staffId } }),
    prisma.programAssignment.count({ where: { ownerId, memberId, coachId: staffId } }),
    prisma.workoutSession.count({ where: { ownerId, memberId, coachId: staffId } }),
  ])
  if (assigned + programmed + led === 0) throw new ApiError(403, 'You can only see the training of members you coach.', 'not_your_member')
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const number = (max: number) => z.number().min(0).max(max).nullish()
export const setSchema = z.object({
  itemId: z.string().min(1).max(40),
  setNumber: z.number().int().min(1).max(100),
  weight: number(5000),
  weightUnit: z.enum(['lb', 'kg']).nullish(),
  reps: z.number().int().min(0).max(10_000).nullish(),
  durationSec: z.number().int().min(0).max(86_400).nullish(),
  distanceM: number(1_000_000),
  rpe: z.number().min(1).max(10).nullish(),
  notes: z.string().trim().max(500).nullish(),
})
export const approachSchema = z.object({
  itemId: z.string().min(1).max(40),
  performedAs: z.enum(['rx', 'scaled', 'substituted', 'skipped']),
  /** For "scaled": which of the coach's scaling options. */
  scalingId: z.string().max(40).nullish(),
  /** For "substituted": the exercise done instead, from the gym's library. */
  exerciseId: z.string().uuid().nullish(),
  note: z.string().trim().max(500).nullish(),
})
export const completeSchema = z.object({
  /** How long it took, if the member wants to say. Otherwise it is measured from when they started. */
  durationSec: z.number().int().min(1).max(86_400).nullish(),
  /** The score of a "for time" workout, or of an AMRAP. */
  timeSec: z.number().int().min(1).max(86_400).nullish(),
  rounds: z.number().int().min(0).max(1000).nullish(),
  reps: z.number().int().min(0).max(999).nullish(),
  notes: z.string().trim().max(2000).nullish(),
})

/** The member's own session, locked, with its prescription. Refuses once the session is finished. */
async function mine(db: Db, ownerId: string, memberId: string, sessionId: string, opts: { open?: boolean } = {}) {
  const found = await db.workoutSession.findFirst({ where: { id: sessionId, ownerId, memberId }, select: { id: true } })
  if (!found) throw notFound('Workout')
  let session = await begin(db, found.id)
  if (opts.open !== false && session.status === 'completed') throw new ApiError(409, 'This workout is finished. What you logged is saved and can no longer be changed.', 'session_completed')
  if (session.status === 'skipped') session = await db.workoutSession.update({ where: { id: session.id }, data: { status: 'in_progress', startedAt: session.startedAt || new Date() } })
  const version = await db.workoutVersion.findUniqueOrThrow({ where: { id: session.workoutVersionId } })
  return { session, version, content: version.content as unknown as WorkoutContent }
}

/** What exercise a set of this item counts as, given how the member is approaching it. */
function performing(item: NonNullable<ReturnType<typeof findItem>>['item'], log: { performedAs: string; scalingId: string | null; exerciseId: string | null; exerciseName: string | null } | null) {
  if (log?.performedAs === 'substituted' && log.exerciseName) return { exerciseId: log.exerciseId, exerciseName: log.exerciseName }
  if (log?.performedAs === 'scaled') {
    const scale = item.scaling.find((s) => s.id === log.scalingId)
    if (scale?.exerciseId && scale.exerciseName) return { exerciseId: scale.exerciseId, exerciseName: scale.exerciseName }
  }
  return { exerciseId: item.exerciseId, exerciseName: item.exerciseName }
}

/** Record (or correct) one set. The same set number again replaces what was there; it never adds a second. */
export async function logSet(input: { ownerId: string; memberId: string; sessionId: string } & z.infer<typeof setSchema>) {
  return prisma.$transaction(async (db) => {
    const { session, content } = await mine(db, input.ownerId, input.memberId, input.sessionId)
    const found = findItem(content, input.itemId)
    if (!found) throw badRequest('That exercise is not part of this workout.', 'unknown_item')
    const approach = await db.workoutItemLog.findUnique({ where: { sessionId_itemId: { sessionId: session.id, itemId: input.itemId } } })
    if (approach?.performedAs === 'skipped') throw new ApiError(409, 'You marked this exercise as skipped. Undo that to log sets for it.', 'item_skipped')
    const exercise = performing(found.item, approach)
    const values = {
      weight: input.weight ?? null, weightUnit: input.weight ? input.weightUnit || found.item.weightUnit || 'lb' : null, reps: input.reps ?? null,
      durationSec: input.durationSec ?? null, distanceM: input.distanceM ?? null, rpe: input.rpe ?? null, notes: input.notes || null, ...exercise,
    }
    await db.workoutSetLog.createMany({ data: [{ ownerId: input.ownerId, sessionId: session.id, memberId: input.memberId, itemId: input.itemId, setNumber: input.setNumber, ...values }], skipDuplicates: true })
    const row = await db.workoutSetLog.update({ where: { sessionId_itemId_setNumber: { sessionId: session.id, itemId: input.itemId, setNumber: input.setNumber } }, data: values })
    return setView(row)
  }, { timeout: 15_000 })
}

export async function deleteSet(input: { ownerId: string; memberId: string; sessionId: string; itemId: string; setNumber: number }) {
  return prisma.$transaction(async (db) => {
    const { session } = await mine(db, input.ownerId, input.memberId, input.sessionId)
    const result = await db.workoutSetLog.deleteMany({ where: { sessionId: session.id, itemId: input.itemId, setNumber: input.setNumber } })
    return { deleted: result.count }
  })
}

/**
 * Say how an exercise is being done: as written, on one of the coach's scaling options, as a
 * different exercise, or not at all. The prescription is not touched; this sits beside it.
 */
export async function setApproach(input: { ownerId: string; memberId: string; sessionId: string } & z.infer<typeof approachSchema>) {
  return prisma.$transaction(async (db) => {
    const { session, content } = await mine(db, input.ownerId, input.memberId, input.sessionId)
    const found = findItem(content, input.itemId)
    if (!found) throw badRequest('That exercise is not part of this workout.', 'unknown_item')
    let data: { performedAs: string; scalingId: string | null; exerciseId: string | null; exerciseName: string | null }
    if (input.performedAs === 'scaled') {
      // Only the options the coach wrote for this exercise. A member cannot invent a scale.
      const scale = found.item.scaling.find((s) => s.id === input.scalingId)
      if (!scale) throw badRequest('Choose one of the scaling options your coach set for this exercise.', 'unknown_scaling')
      data = { performedAs: 'scaled', scalingId: scale.id, exerciseId: scale.exerciseId, exerciseName: scale.exerciseName }
    } else if (input.performedAs === 'substituted') {
      const exercise = input.exerciseId ? await db.exercise.findFirst({ where: { id: input.exerciseId, isActive: true, AND: [visibleTo(input.ownerId)] }, select: { id: true, name: true } }) : null
      if (!exercise) throw badRequest('Choose the exercise you did instead from the list.', 'unknown_exercise')
      if (exercise.id === found.item.exerciseId) throw badRequest('That is the exercise that was prescribed.', 'same_exercise')
      data = { performedAs: 'substituted', scalingId: null, exerciseId: exercise.id, exerciseName: exercise.name }
    } else {
      data = { performedAs: input.performedAs, scalingId: null, exerciseId: null, exerciseName: null }
    }
    const note = input.note === undefined ? undefined : input.note || null
    await db.workoutItemLog.createMany({ data: [{ ownerId: input.ownerId, sessionId: session.id, itemId: input.itemId, ...data, note: note ?? null }], skipDuplicates: true })
    const row = await db.workoutItemLog.update({ where: { sessionId_itemId: { sessionId: session.id, itemId: input.itemId } }, data: { ...data, ...(note !== undefined && { note }) } })
    // Sets already logged for this exercise are of whatever is being done now.
    if (input.performedAs === 'skipped') await db.workoutSetLog.deleteMany({ where: { sessionId: session.id, itemId: input.itemId } })
    else await db.workoutSetLog.updateMany({ where: { sessionId: session.id, itemId: input.itemId }, data: performing(found.item, row) })
    return { itemId: row.itemId, performedAs: row.performedAs, scalingId: row.scalingId, exerciseId: row.exerciseId, exerciseName: row.exerciseName, note: row.note }
  })
}

export async function saveMemberNotes(input: { ownerId: string; memberId: string; sessionId: string; notes: string | null }) {
  const result = await prisma.workoutSession.updateMany({ where: { id: input.sessionId, ownerId: input.ownerId, memberId: input.memberId }, data: { memberNotes: input.notes || null } })
  if (result.count === 0) throw notFound('Workout')
}

export async function skipSession(input: { ownerId: string; memberId: string; sessionId: string; notes?: string | null }) {
  return prisma.$transaction(async (db) => {
    const found = await db.workoutSession.findFirst({ where: { id: input.sessionId, ownerId: input.ownerId, memberId: input.memberId }, select: { id: true } })
    if (!found) throw notFound('Workout')
    await lockRow(db, 'WorkoutSession', found.id)
    const session = await db.workoutSession.findUniqueOrThrow({ where: { id: found.id } })
    if (session.status === 'completed') throw new ApiError(409, 'This workout is already finished.', 'session_completed')
    return db.workoutSession.update({ where: { id: session.id }, data: { status: 'skipped', ...(input.notes !== undefined && { memberNotes: input.notes || null }) } })
  })
}

/**
 * Finish a workout. Done once: the session is locked while it is decided, and a second request
 * (a double tap, a second device) gets the finished session back without anything being recorded
 * again. Records are worked out here, against the member's bests as they stood before this workout.
 */
export async function completeSession(input: { ownerId: string; memberId: string; sessionId: string; now?: Date } & z.infer<typeof completeSchema>) {
  const now = input.now || new Date()
  return prisma.$transaction(async (db) => {
    const found = await db.workoutSession.findFirst({ where: { id: input.sessionId, ownerId: input.ownerId, memberId: input.memberId }, select: { id: true } })
    if (!found) throw notFound('Workout')
    // The member first, then the session: two of their workouts finishing together compare against the same bests in turn.
    await lockRow(db, 'Member', input.memberId)
    await lockRow(db, 'WorkoutSession', found.id)
    const session = await db.workoutSession.findUniqueOrThrow({ where: { id: found.id }, include: { sets: true, items: true } })
    if (session.status === 'completed') return { sessionId: session.id, alreadyCompleted: true, records: [] as ReturnType<typeof recordView>[] }
    const version = await db.workoutVersion.findUniqueOrThrow({ where: { id: session.workoutVersionId } })
    const content = version.content as unknown as WorkoutContent
    const score = scoring(content)
    if (session.sets.length === 0 && !input.timeSec && input.rounds == null && !session.items.some((i) => i.performedAs !== 'skipped')) {
      const anything = allItems(content).length > 0
      if (anything && !input.notes && !session.memberNotes) throw badRequest('Log at least one set, a result or a note before finishing. To leave it undone, skip the workout instead.', 'nothing_logged')
    }
    const result = score === 'time' && input.timeSec ? { timeSec: input.timeSec } : score === 'rounds' && input.rounds != null ? { rounds: input.rounds, reps: input.reps || 0 } : null
    const started = session.startedAt || now
    const durationSec = input.durationSec || (score === 'time' && input.timeSec ? input.timeSec : Math.max(1, Math.round((now.getTime() - started.getTime()) / 1000)))
    await db.workoutSession.update({
      where: { id: session.id },
      data: { status: 'completed', startedAt: started, completedAt: now, durationSec: Math.min(durationSec, 86_400), result: result || undefined, ...(input.notes !== undefined && { memberNotes: input.notes || null }) },
    })

    // Records.
    const measures = new Map<string, string>()
    for (const { item } of allItems(content)) {
      measures.set(item.exerciseId, item.measure)
      for (const s of item.scaling) if (s.exerciseId && s.measure) measures.set(s.exerciseId, s.measure)
    }
    const unknown = Array.from(new Set(session.sets.map((s) => s.exerciseId).filter((id): id is string => !!id && !measures.has(id))))
    if (unknown.length) for (const e of await db.exercise.findMany({ where: { id: { in: unknown } }, select: { id: true, measure: true } })) measures.set(e.id, e.measure)
    const sets: LoggedSet[] = session.sets.map((s) => ({ exerciseId: s.exerciseId, exerciseName: s.exerciseName, measure: (s.exerciseId && measures.get(s.exerciseId)) || 'weight_reps', weight: s.weight, weightUnit: s.weightUnit, reps: s.reps, durationSec: s.durationSec, distanceM: s.distanceM }))
    const exerciseIds = Array.from(new Set(sets.map((s) => s.exerciseId).filter(Boolean))) as string[]
    // Each record beats the one before it, so the newest row for a key is the best so far.
    const earlier = await db.personalRecord.findMany({
      where: { ownerId: input.ownerId, memberId: input.memberId, OR: [{ exerciseId: { in: exerciseIds } }, { workoutId: session.workoutId }] },
      orderBy: [{ achievedAt: 'desc' }, { createdAt: 'desc' }], take: 5000, select: { exerciseId: true, workoutId: true, type: true, bucket: true, value: true, unit: true },
    })
    const bests = new Map<string, Best>()
    for (const r of earlier) {
      const key = recordKey(r.exerciseId || `workout:${r.workoutId}`, r.type as RecordType, r.bucket)
      if (!bests.has(key)) bests.set(key, { value: r.value, unit: r.unit })
    }
    const asPrescribed = !session.items.some((i) => i.performedAs !== 'rx')
    const found2 = detectRecords({ sets, workout: { id: session.workoutId, name: version.name, scoring: score, asPrescribed, timeSec: result && 'timeSec' in result ? result.timeSec : null, rounds: result && 'rounds' in result ? result.rounds : null, reps: result && 'rounds' in result ? result.reps : null } }, bests)
    if (found2.length) {
      await db.personalRecord.createMany({ data: found2.map((r) => ({ ownerId: input.ownerId, memberId: input.memberId, exerciseId: r.exerciseId, workoutId: r.workoutId, name: r.name, type: r.type, bucket: r.bucket, value: r.value, unit: r.unit, previousValue: r.previousValue, detail: r.detail, sessionId: session.id, achievedAt: now })) })
    }
    const made = await db.personalRecord.findMany({ where: { sessionId: session.id }, orderBy: [{ name: 'asc' }, { type: 'asc' }, { bucket: 'asc' }] })
    const real = made.filter((r) => r.previousValue != null)

    const member = await db.member.findUnique({ where: { id: input.memberId }, select: { name: true } })
    await logActivity(db, {
      ownerId: input.ownerId, memberId: input.memberId, type: 'workout_completed', title: `Completed ${version.name}`,
      detail: [session.programName, resultText(result as Prisma.JsonValue), real.length ? `${real.length} personal record${real.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || undefined,
      metadata: { sessionId: session.id, workoutId: session.workoutId, version: version.version }, actor: { type: 'member', id: input.memberId, name: member?.name || 'Member' },
    })
    // One line for the member, naming the best of them, however many records fell.
    if (real.length) {
      const headline = real.find((r) => r.type === 'heaviest_weight') || real.find((r) => ['fastest_time', 'most_rounds'].includes(r.type)) || real[0]
      await logActivity(db, {
        ownerId: input.ownerId, memberId: input.memberId, type: 'personal_record',
        title: `New personal record: ${headline.name}, ${recordValue(headline.type, headline.value, headline.unit)}`,
        detail: real.length > 1 ? `and ${real.length - 1} more in ${version.name}` : `in ${version.name}`, metadata: { sessionId: session.id },
      })
    }
    // The coach who set it hears about it. Nobody else is interrupted.
    if (session.coachId) {
      await notify(db, { ownerId: input.ownerId, type: 'workout_completed', title: `${member?.name || 'A member'} completed ${version.name}`, body: [resultText(result as Prisma.JsonValue), real.length ? `${real.length} personal record${real.length === 1 ? '' : 's'}` : null, input.notes].filter(Boolean).join(' · ') || undefined, href: `/members/${input.memberId}?tab=workouts`, staffId: session.coachId })
    }
    const { workoutCompletedEvent } = await import('./events')
    await workoutCompletedEvent(db, input.ownerId, session.id)
    return { sessionId: session.id, alreadyCompleted: false, records: made.map(recordView) }
  }, { timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// History and records
// ---------------------------------------------------------------------------

/** Finished workouts, newest first, a page at a time. `before` is the completedAt of the last one already shown. */
export async function workoutHistory(ownerId: string, memberId: string, opts: { before?: Date | null; take?: number } = {}) {
  const take = Math.min(50, opts.take || 15)
  const rows = await prisma.workoutSession.findMany({
    where: { ownerId, memberId, status: 'completed', ...(opts.before && { completedAt: { lt: opts.before } }) },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }], take: take + 1,
    select: { id: true, workoutId: true, workoutVersionId: true, completedAt: true, durationSec: true, programName: true, coachName: true, result: true, memberNotes: true, coachFeedback: true, _count: { select: { sets: true } } },
  })
  const page = rows.slice(0, take)
  const [versions, records] = await Promise.all([
    prisma.workoutVersion.findMany({ where: { id: { in: Array.from(new Set(page.map((r) => r.workoutVersionId))) } }, select: { id: true, name: true, version: true, type: true } }),
    prisma.personalRecord.groupBy({ by: ['sessionId'], where: { ownerId, memberId, sessionId: { in: page.map((r) => r.id) }, previousValue: { not: null } }, _count: { _all: true } }),
  ])
  return {
    items: page.map((r) => {
      const v = versions.find((x) => x.id === r.workoutVersionId)
      return { id: r.id, name: v?.name || 'Workout', type: v?.type || null, version: v?.version || 1, completedAt: r.completedAt, durationSec: r.durationSec, programName: r.programName, coachName: r.coachName, result: resultText(r.result), sets: r._count.sets, records: records.find((x) => x.sessionId === r.id)?._count._all || 0, hasNotes: !!r.memberNotes, hasFeedback: !!r.coachFeedback }
    }),
    nextBefore: rows.length > take ? page[page.length - 1].completedAt : null,
  }
}

/** A member's records: their current best for each thing, and (for one exercise) how it got there. */
export async function memberRecords(ownerId: string, memberId: string, opts: { exerciseId?: string | null; take?: number } = {}) {
  if (opts.exerciseId) {
    const rows = await prisma.personalRecord.findMany({ where: { ownerId, memberId, exerciseId: opts.exerciseId }, orderBy: [{ achievedAt: 'desc' }, { createdAt: 'desc' }], take: Math.min(200, opts.take || 100) })
    return { records: rows.map(recordView) }
  }
  // Newest first and one per thing: the newest record of a kind is the standing best.
  const rows = await prisma.personalRecord.findMany({
    where: { ownerId, memberId, type: { not: 'reps_at_weight' } },
    orderBy: [{ achievedAt: 'desc' }, { createdAt: 'desc' }], distinct: ['exerciseId', 'workoutId', 'type'], take: Math.min(300, opts.take || 150),
  })
  return { records: rows.map(recordView).sort((a, b) => a.name.localeCompare(b.name) || a.label.localeCompare(b.label)) }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const coachNoteSchema = z.object({
  /** Staff only. */
  coachNotes: z.string().trim().max(2000).nullish(),
  /** For the member to read. */
  coachFeedback: z.string().trim().max(2000).nullish(),
})

export async function saveCoachNote(db: Db, input: { ownerId: string; sessionId: string; own?: string | null; actor?: ActorRef } & z.infer<typeof coachNoteSchema>) {
  const session = await db.workoutSession.findFirst({ where: { id: input.sessionId, ownerId: input.ownerId } })
  if (!session) throw notFound('Workout')
  if (input.own) await assertCoaches(input.ownerId, input.own, session.memberId)
  const feedback = input.coachFeedback === undefined ? undefined : input.coachFeedback || null
  const updated = await db.workoutSession.update({ where: { id: session.id }, data: { ...(input.coachNotes !== undefined && { coachNotes: input.coachNotes || null }), ...(feedback !== undefined && { coachFeedback: feedback }) } })
  // Only what is written for the member reaches the member.
  if (feedback && feedback !== session.coachFeedback) {
    const version = await db.workoutVersion.findUnique({ where: { id: session.workoutVersionId }, select: { name: true } })
    await logActivity(db, { ownerId: input.ownerId, memberId: session.memberId, type: 'coach_feedback', title: `${input.actor?.name || 'Your coach'} left a note on ${version?.name || 'your workout'}`, detail: feedback.slice(0, 200), metadata: { sessionId: session.id }, actor: input.actor })
  }
  return updated
}

export const assignWorkoutSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1, 'Choose at least one member').max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  coachId: z.string().uuid().nullish(),
})

/** Give members a single workout to do on a day, outside any program. */
export async function assignWorkout(db: Db, input: { ownerId: string; workoutId: string; actor?: ActorRef } & z.infer<typeof assignWorkoutSchema>) {
  const workout = await db.workout.findFirst({ where: { id: input.workoutId, ownerId: input.ownerId, archivedAt: null }, select: { id: true, name: true, currentVersionId: true } })
  if (!workout?.currentVersionId) throw notFound('Workout')
  const ids = Array.from(new Set(input.memberIds)).sort()
  const members = await db.member.findMany({ where: { ownerId: input.ownerId, id: { in: ids }, archivedAt: null }, select: { id: true, name: true } })
  if (members.length !== ids.length) throw new ApiError(404, 'One of those members was not found.', 'not_found')
  const coach = input.coachId ? await db.staff.findFirst({ where: { id: input.coachId, ownerId: input.ownerId, active: true }, select: { id: true, name: true } }) : null
  if (input.coachId && !coach) throw notFound('Coach')
  const date = fromDay(input.date)
  const created = []
  for (const member of members.sort((a, b) => a.id.localeCompare(b.id))) {
    await lockRow(db, 'Member', member.id)
    // The same workout for the same day is one assignment, however many times it is sent.
    const existing = await db.workoutSession.findFirst({ where: { ownerId: input.ownerId, memberId: member.id, workoutId: workout.id, scheduledDate: date, assignmentId: null, classSessionId: null, appointmentId: null, status: { in: ['not_started', 'in_progress'] } }, select: { id: true } })
    if (existing) continue
    const session = await db.workoutSession.create({ data: { ownerId: input.ownerId, memberId: member.id, workoutId: workout.id, workoutVersionId: workout.currentVersionId, scheduledDate: date, coachId: coach?.id || null, coachName: coach?.name || null, assignedByName: input.actor?.name || null } })
    created.push({ session, member })
    await logActivity(db, { ownerId: input.ownerId, memberId: member.id, type: 'workout_assigned', title: `New workout: ${workout.name}`, detail: `For ${input.date}${coach ? ` from ${coach.name}` : ''}`, metadata: { sessionId: session.id, workoutId: workout.id }, actor: input.actor })
  }
  return { workout, created, skipped: members.length - created.length }
}
