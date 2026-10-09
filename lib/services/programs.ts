// Programs and who they are assigned to.
//
// A program is weeks of training days, and each day points at a reusable workout: nothing is copied.
// Assigning a program to a member records when it starts and who is coaching it. Where each training
// day falls on the calendar is worked out from the start date (lib/workouts/schedule.ts), so nothing
// has to be generated ahead of time; a WorkoutSession only comes into being when the member opens
// that day's workout.

import { programEvent } from './events'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { zonedParts } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import { DIFFICULTIES } from '@/lib/workouts/content'
import { AssignmentTiming, dateOf, fromDay, lastDate, position, toDay, daysApart } from '@/lib/workouts/schedule'
import { ActorRef, Db, SYSTEM, getGymSettings, lockRow, logActivity, notify } from './core'
import { assertMayEdit } from './workouts'
import { LIVE_STATUSES } from './memberships'

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const daySchema = z.object({ week: z.number().int().min(1).max(52), day: z.number().int().min(1).max(7), workoutId: z.string().uuid(), title: optional(80) })
const fields = {
  name: z.string().trim().min(1, 'Name the program').max(120),
  description: optional(2000),
  goals: optional(500),
  difficulty: z.enum(DIFFICULTIES),
  audience: optional(200),
  weeks: z.number().int().min(1, 'A program needs at least one week').max(52),
  days: z.array(daySchema).max(52 * 7),
}
export const programSchema = z.object({ ...fields, difficulty: fields.difficulty.default('intermediate'), days: fields.days.default([]) })
export const programUpdateSchema = z.object(fields).partial()
export const LIVE_ASSIGNMENTS = ['scheduled', 'active', 'paused']

type Days = z.infer<typeof daySchema>[]
async function checkDays(db: Db, ownerId: string, weeks: number, days: Days) {
  const slots = new Set<string>()
  for (const d of days) {
    if (d.week > weeks) throw badRequest(`Week ${d.week} is beyond the end of this ${weeks}-week program.`, 'week_out_of_range')
    const slot = `${d.week}:${d.day}`
    if (slots.has(slot)) throw badRequest('A training day can hold one workout. Combine them into one workout, or use another day.', 'day_taken')
    slots.add(slot)
  }
  const ids = Array.from(new Set(days.map((d) => d.workoutId)))
  if (ids.length === 0) return
  const found = await db.workout.findMany({ where: { ownerId, id: { in: ids }, archivedAt: null }, select: { id: true } })
  if (found.length !== ids.length) throw new ApiError(404, 'One of those workouts was not found, or has been archived.', 'not_found')
}

export async function createProgram(db: Db, ownerId: string, input: z.infer<typeof programSchema>, actor?: ActorRef) {
  const { days, ...data } = input
  await checkDays(db, ownerId, data.weeks, days)
  const program = await db.program.create({ data: { ownerId, ...data, createdById: actor?.id || null, createdByName: actor?.name || null } })
  if (days.length) await db.programDay.createMany({ data: days.map((d) => ({ ownerId, programId: program.id, ...d })) })
  return program
}

/**
 * Change a program. Training days are matched by week and weekday: a day that keeps its place keeps
 * its identity, so members part-way through keep their history against it. Shortening a program or
 * removing a day does not delete what members already did on it.
 */
export async function updateProgram(db: Db, ownerId: string, id: string, input: z.infer<typeof programUpdateSchema>, own?: string | null) {
  const program = await db.program.findFirst({ where: { id, ownerId }, include: { days: true } })
  if (!program) throw notFound('Program')
  if (program.archivedAt) throw badRequest('This program is archived. Restore it before changing it.', 'archived')
  assertMayEdit(program, own || null, 'programs')
  const { days, ...data } = input
  const weeks = data.weeks ?? program.weeks
  const next = days ?? program.days.filter((d) => d.week <= weeks).map((d) => ({ week: d.week, day: d.day, workoutId: d.workoutId, title: d.title }))
  await checkDays(db, ownerId, weeks, next)
  const updated = await db.program.update({ where: { id: program.id }, data })
  if (days || weeks < program.weeks) {
    const keep = new Set(next.map((d) => `${d.week}:${d.day}`))
    const gone = program.days.filter((d) => !keep.has(`${d.week}:${d.day}`))
    if (gone.length) await db.programDay.deleteMany({ where: { id: { in: gone.map((d) => d.id) } } })
    for (const d of next) {
      const existing = program.days.find((x) => x.week === d.week && x.day === d.day)
      if (!existing) await db.programDay.create({ data: { ownerId, programId: program.id, ...d } })
      else if (existing.workoutId !== d.workoutId || existing.title !== d.title) await db.programDay.update({ where: { id: existing.id }, data: { workoutId: d.workoutId, title: d.title } })
    }
  }
  return { before: program, program: updated }
}

export async function archiveProgram(db: Db, ownerId: string, id: string, archived: boolean, own?: string | null) {
  const program = await db.program.findFirst({ where: { id, ownerId } })
  if (!program) throw notFound('Program')
  assertMayEdit(program, own || null, 'programs')
  if (archived) {
    const live = await db.programAssignment.count({ where: { ownerId, programId: program.id, status: { in: LIVE_ASSIGNMENTS } } })
    if (live > 0) throw new ApiError(409, `${live} member${live === 1 ? ' is' : 's are'} still on this program. End their assignments first.`, 'program_in_use')
  }
  return db.program.update({ where: { id: program.id }, data: { archivedAt: archived ? new Date() : null } })
}

export async function listPrograms(ownerId: string, filters: { search?: string | null; archived?: boolean; skip?: number; take?: number }) {
  const search = (filters.search || '').trim()
  const where: Prisma.ProgramWhereInput = { ownerId, archivedAt: filters.archived ? { not: null } : null, ...(search && { name: { contains: search, mode: 'insensitive' } }) }
  const [rows, total] = await Promise.all([
    prisma.program.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: filters.skip || 0, take: Math.min(100, filters.take || 50), include: { _count: { select: { days: true } } } }),
    prisma.program.count({ where }),
  ])
  const assigned = await prisma.programAssignment.groupBy({ by: ['programId', 'status'], where: { ownerId, programId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
  const count = (programId: string, statuses: string[]) => assigned.filter((a) => a.programId === programId && statuses.includes(a.status)).reduce((sum, a) => sum + a._count._all, 0)
  return {
    total,
    rows: rows.map((p) => ({
      id: p.id, name: p.name, description: p.description, goals: p.goals, difficulty: p.difficulty, audience: p.audience, weeks: p.weeks, trainingDays: p._count.days,
      createdById: p.createdById, createdByName: p.createdByName, archived: !!p.archivedAt, updatedAt: p.updatedAt, activeMembers: count(p.id, LIVE_ASSIGNMENTS), completedMembers: count(p.id, ['completed']),
    })),
  }
}

export async function programDetail(ownerId: string, id: string) {
  const program = await prisma.program.findFirst({ where: { id, ownerId }, include: { days: { orderBy: [{ week: 'asc' }, { day: 'asc' }] } } })
  if (!program) throw notFound('Program')
  const workouts = await prisma.workout.findMany({ where: { ownerId, id: { in: Array.from(new Set(program.days.map((d) => d.workoutId))) } }, select: { id: true, name: true, type: true, estimatedMinutes: true, archivedAt: true } })
  return {
    id: program.id, name: program.name, description: program.description, goals: program.goals, difficulty: program.difficulty, audience: program.audience, weeks: program.weeks,
    archived: !!program.archivedAt, createdById: program.createdById, createdByName: program.createdByName,
    days: program.days.map((d) => {
      const w = workouts.find((x) => x.id === d.workoutId)
      return { id: d.id, week: d.week, day: d.day, title: d.title, workoutId: d.workoutId, workoutName: w?.name || 'Deleted workout', workoutType: w?.type || null, estimatedMinutes: w?.estimatedMinutes || null, workoutArchived: !!w?.archivedAt }
    }),
  }
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
export const assignSchema = z.object({
  /** The members to assign it to… */
  memberIds: z.array(z.string().uuid()).max(500).optional(),
  /** …or everyone with a live membership on this plan, as of now. */
  planId: z.string().uuid().optional(),
  startDate: dateOnly,
  endDate: dateOnly.nullish(),
  coachId: z.string().uuid().nullish(),
}).refine((v) => !!v.memberIds?.length !== !!v.planId, 'Choose members, or a membership plan')
  .refine((v) => !v.endDate || v.endDate >= v.startDate, 'The end date is before the start date')

export const timing = (a: { startDate: Date; endDate: Date | null; pausedDays: number; pausedAt: Date | null }, tz: string): AssignmentTiming =>
  ({ startDate: toDay(a.startDate), endDate: a.endDate ? toDay(a.endDate) : null, pausedDays: a.pausedDays, pausedOn: a.pausedAt ? zonedParts(a.pausedAt, tz).date : null })

/**
 * Assign a program to members. A member already on this program (scheduled, active or paused) is
 * left as they are and reported back, so pressing the button twice, or assigning a group that
 * overlaps one already assigned, never gives anyone the same program twice.
 */
export async function assignProgram(db: Db, input: { ownerId: string; programId: string; actor?: ActorRef } & z.infer<typeof assignSchema>) {
  const { ownerId } = input
  const program = await db.program.findFirst({ where: { id: input.programId, ownerId }, include: { _count: { select: { days: true } } } })
  if (!program) throw notFound('Program')
  if (program.archivedAt) throw badRequest('This program is archived.', 'archived')
  if (program._count.days === 0) throw badRequest('Add at least one training day before assigning this program.', 'empty_program')
  const coach = input.coachId ? await db.staff.findFirst({ where: { id: input.coachId, ownerId, active: true }, select: { id: true, name: true } }) : null
  if (input.coachId && !coach) throw notFound('Coach')

  let memberIds = input.memberIds || []
  if (input.planId) {
    const plan = await db.membershipPlan.findFirst({ where: { id: input.planId, ownerId }, select: { id: true } })
    if (!plan) throw notFound('Membership plan')
    memberIds = (await db.membership.findMany({ where: { ownerId, planId: plan.id, status: { in: LIVE_STATUSES }, member: { archivedAt: null } }, select: { memberId: true }, distinct: ['memberId'], take: 500 })).map((m) => m.memberId)
    if (memberIds.length === 0) throw badRequest('Nobody has a live membership on that plan.', 'nobody_on_plan')
  }
  memberIds = Array.from(new Set(memberIds)).sort()
  const members = await db.member.findMany({ where: { ownerId, id: { in: memberIds }, archivedAt: null }, select: { id: true, name: true } })
  if (members.length !== memberIds.length) throw new ApiError(404, 'One of those members was not found.', 'not_found')

  const settings = await getGymSettings(ownerId, db)
  const today = zonedParts(new Date(), settings.timezone).date
  const actor = input.actor || SYSTEM
  const created = []
  const already = []
  for (const member of members.sort((a, b) => a.id.localeCompare(b.id))) {
    // The member's row is the lock: two assignments of one program to one member cannot both get through.
    await lockRow(db, 'Member', member.id)
    const existing = await db.programAssignment.findFirst({ where: { ownerId, programId: program.id, memberId: member.id, status: { in: LIVE_ASSIGNMENTS } }, select: { id: true } })
    if (existing) { already.push(member); continue }
    const assignment = await db.programAssignment.create({
      data: {
        ownerId, programId: program.id, memberId: member.id, coachId: coach?.id || null, startDate: fromDay(input.startDate), endDate: input.endDate ? fromDay(input.endDate) : null,
        status: input.startDate <= today ? 'active' : 'scheduled', sourcePlanId: input.planId || null, createdByName: actor.name || null,
      },
    })
    created.push({ assignment, member })
    await programEvent(db, ownerId, 'program.assigned', assignment.id)
    await logActivity(db, {
      ownerId, memberId: member.id, type: 'program_assigned', actor,
      title: `Started on ${program.name}`, detail: `${program.weeks} week${program.weeks === 1 ? '' : 's'} from ${formatDate(fromDay(input.startDate), 'UTC')}${coach ? ` with ${coach.name}` : ''}`,
      metadata: { assignmentId: assignment.id, programId: program.id },
    })
    const { fireTrigger } = await import('./automations')
    await fireTrigger(db, ownerId, 'program_assigned', { memberId: member.id, dedupeKey: `program:${assignment.id}`, context: { program_name: program.name, coach_name: coach?.name || settings.name, date: formatDate(fromDay(input.startDate), 'UTC') } })
  }
  return { program, coach, created, already }
}

export const assignmentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('update'), coachId: z.string().uuid().nullish(), endDate: dateOnly.nullish() }),
])

/** Staff may act on any assignment; a coach or trainer only on the ones they coach. */
export async function loadAssignment(db: Db, ownerId: string, id: string, own?: string | null) {
  const found = await db.programAssignment.findFirst({ where: { id, ownerId, ...(own && { coachId: own }) }, select: { id: true } })
  if (!found) throw notFound('Assignment')
  await lockRow(db, 'ProgramAssignment', found.id)
  return db.programAssignment.findUniqueOrThrow({ where: { id: found.id } })
}

export async function changeAssignment(db: Db, input: { ownerId: string; id: string; own?: string | null; actor?: ActorRef } & z.infer<typeof assignmentActionSchema>) {
  const a = await loadAssignment(db, input.ownerId, input.id, input.own)
  const [program, settings] = await Promise.all([db.program.findUniqueOrThrow({ where: { id: a.programId }, select: { name: true } }), getGymSettings(input.ownerId, db)])
  const today = zonedParts(new Date(), settings.timezone).date
  const over = ['completed', 'cancelled'].includes(a.status)
  const say = (type: string, title: string, detail?: string) => logActivity(db, { ownerId: input.ownerId, memberId: a.memberId, type, title, detail, actor: input.actor, metadata: { assignmentId: a.id, programId: a.programId } })
  switch (input.action) {
    case 'pause': {
      if (over) throw badRequest('This program has already ended for this member.', 'assignment_over')
      if (a.status === 'paused') return a
      await say('program_paused', `${program.name} paused`, 'The rest of the program moves back by however long it is paused.')
      return db.programAssignment.update({ where: { id: a.id }, data: { status: 'paused', pausedAt: new Date() } })
    }
    case 'resume': {
      if (a.status !== 'paused') throw badRequest('This program is not paused.', 'not_paused')
      const days = a.pausedAt ? Math.max(0, daysApart(zonedParts(a.pausedAt, settings.timezone).date, today)) : 0
      await say('program_resumed', `${program.name} resumed`, days ? `Everything left moves back ${days} day${days === 1 ? '' : 's'}.` : undefined)
      return db.programAssignment.update({ where: { id: a.id }, data: { status: toDay(a.startDate) <= today ? 'active' : 'scheduled', pausedAt: null, pausedDays: a.pausedDays + days } })
    }
    case 'cancel': {
      if (over) return a
      // Bank the pause so the dates of what was done stay where they were.
      return db.programAssignment.update({ where: { id: a.id }, data: { status: 'cancelled', pausedAt: null, completedAt: new Date() } })
    }
    case 'complete': {
      if (over) return a
      return finishAssignment(db, a, program.name)
    }
    case 'update': {
      if (input.coachId) {
        const coach = await db.staff.findFirst({ where: { id: input.coachId, ownerId: input.ownerId, active: true }, select: { id: true } })
        if (!coach) throw notFound('Coach')
      }
      if (input.endDate && input.endDate < toDay(a.startDate)) throw badRequest('The end date is before the start date.', 'bad_dates')
      return db.programAssignment.update({ where: { id: a.id }, data: { ...(input.coachId !== undefined && { coachId: input.coachId }), ...(input.endDate !== undefined && { endDate: input.endDate ? fromDay(input.endDate) : null }) } })
    }
  }
}

async function finishAssignment(db: Db, a: { id: string; ownerId: string; memberId: string; programId: string; coachId: string | null }, programName: string) {
  // Claim the ending first, so two things noticing at once announce it once.
  const claimed = await db.programAssignment.updateMany({ where: { id: a.id, status: { in: LIVE_ASSIGNMENTS } }, data: { status: 'completed', completedAt: new Date(), pausedAt: null } })
  const row = await db.programAssignment.findUniqueOrThrow({ where: { id: a.id } })
  if (claimed.count === 0) return row
  await programEvent(db, a.ownerId, 'program.completed', a.id)
  const done = await db.workoutSession.count({ where: { assignmentId: a.id, status: 'completed' } })
  await logActivity(db, { ownerId: a.ownerId, memberId: a.memberId, type: 'program_completed', title: `Finished ${programName}`, detail: `${done} workout${done === 1 ? '' : 's'} completed`, metadata: { assignmentId: a.id, programId: a.programId } })
  const member = await db.member.findUnique({ where: { id: a.memberId }, select: { name: true } })
  await notify(db, { ownerId: a.ownerId, type: 'program_completed', title: `${member?.name || 'A member'} finished ${programName}`, body: `${done} workout${done === 1 ? '' : 's'} completed. Time to plan what comes next.`, href: `/members/${a.memberId}?tab=workouts`, staffId: a.coachId })
  const { fireTrigger } = await import('./automations')
  await fireTrigger(db, a.ownerId, 'program_completed', { memberId: a.memberId, dedupeKey: `program_done:${a.id}`, context: { program_name: programName } })
  return row
}

/**
 * Bring assignments up to date with the calendar: scheduled ones whose start date has come become
 * active, and active ones whose last training day has passed are completed. Runs when someone looks
 * (a member opening their workouts, a coach opening progress) and from the daily job.
 */
export async function refreshAssignments(ownerId: string, where: { memberId?: string } = {}, now = new Date()) {
  const settings = await getGymSettings(ownerId)
  const today = zonedParts(now, settings.timezone).date
  await prisma.programAssignment.updateMany({ where: { ownerId, ...where, status: 'scheduled', startDate: { lte: fromDay(today) } }, data: { status: 'active' } })
  const active = await prisma.programAssignment.findMany({ where: { ownerId, ...where, status: 'active' }, take: 500 })
  if (active.length === 0) return 0
  const programs = await prisma.program.findMany({ where: { id: { in: Array.from(new Set(active.map((a) => a.programId))) } }, select: { id: true, name: true, weeks: true } })
  let finished = 0
  for (const a of active) {
    const program = programs.find((p) => p.id === a.programId)
    if (!program) continue
    if (lastDate(timing(a, settings.timezone), program.weeks, today) >= today) continue
    await prisma.$transaction((db) => finishAssignment(db, a, program.name))
    finished++
  }
  return finished
}

/** Programmed workouts that were due yesterday and were not done, for the "missed workout" automation. */
export async function missedYesterday(ownerId: string, now = new Date()) {
  const settings = await getGymSettings(ownerId)
  const today = zonedParts(now, settings.timezone).date
  const yesterday = toDay(new Date(fromDay(today).getTime() - 86_400_000))
  const active = await prisma.programAssignment.findMany({ where: { ownerId, status: 'active', startDate: { lte: fromDay(yesterday) } }, take: 2000 })
  if (active.length === 0) return []
  const programIds = Array.from(new Set(active.map((a) => a.programId)))
  const [programs, days] = await Promise.all([
    prisma.program.findMany({ where: { id: { in: programIds } }, select: { id: true, name: true, weeks: true } }),
    prisma.programDay.findMany({ where: { programId: { in: programIds } }, select: { id: true, programId: true, week: true, day: true, workoutId: true, title: true } }),
  ])
  const due = active.flatMap((a) => {
    const t = timing(a, settings.timezone)
    return days.filter((d) => d.programId === a.programId && dateOf(t, d.week, d.day, today) === yesterday).map((d) => ({ a, d }))
  })
  if (due.length === 0) return []
  const [sessions, workouts] = await Promise.all([
    prisma.workoutSession.findMany({ where: { ownerId, assignmentId: { in: due.map((x) => x.a.id) }, programDayId: { in: due.map((x) => x.d.id) }, status: { in: ['completed', 'skipped'] } }, select: { assignmentId: true, programDayId: true } }),
    prisma.workout.findMany({ where: { id: { in: Array.from(new Set(due.map((x) => x.d.workoutId))) } }, select: { id: true, name: true } }),
  ])
  return due
    .filter((x) => !sessions.some((s) => s.assignmentId === x.a.id && s.programDayId === x.d.id))
    .map((x) => ({ memberId: x.a.memberId, assignmentId: x.a.id, programDayId: x.d.id, workoutName: x.d.title || workouts.find((w) => w.id === x.d.workoutId)?.name || 'Your workout', programName: programs.find((p) => p.id === x.a.programId)?.name || 'your program' }))
}

export { position }
