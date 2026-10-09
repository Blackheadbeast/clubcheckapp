// What a coach looks at: who is training today, who has done it, who has not, and how one member
// is getting on. Managers and above see the whole gym; a coach or trainer sees the members they
// coach. Every list here is bounded and built from a fixed number of queries.

import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { zonedParts } from '@/lib/dates'
import { dateOf, fromDay, toDay } from '@/lib/workouts/schedule'
import { getGymSettings } from './core'
import { LIVE_ASSIGNMENTS, refreshAssignments, timing } from './programs'
import { assertCoaches, memberRecords, memberWorkouts, workoutHistory } from './workout-sessions'
import { recordValue } from '@/lib/workouts/records'

const score = (result: unknown) => {
  const r = (result || {}) as { timeSec?: number; rounds?: number; reps?: number }
  return r.timeSec ? recordValue('fastest_time', r.timeSec, 'sec') : r.rounds != null ? recordValue('most_rounds', r.rounds + (r.reps || 0) / 1000, 'rounds') : null
}

/** One day across the gym (or across a coach's members): everything that was due and what became of it. */
export async function coachingDay(ownerId: string, opts: { own?: string | null; date?: string | null }) {
  await refreshAssignments(ownerId)
  const settings = await getGymSettings(ownerId)
  const today = zonedParts(new Date(), settings.timezone).date
  const date = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : today
  const coach = opts.own ? { coachId: opts.own } : {}

  const assignments = await prisma.programAssignment.findMany({ where: { ownerId, status: { in: LIVE_ASSIGNMENTS }, ...coach }, take: 1000 })
  const programIds = Array.from(new Set(assignments.map((a) => a.programId)))
  const [programs, days, direct, recent, counts] = await Promise.all([
    prisma.program.findMany({ where: { ownerId, id: { in: programIds } }, select: { id: true, name: true, weeks: true } }),
    prisma.programDay.findMany({ where: { ownerId, programId: { in: programIds } }, select: { id: true, programId: true, week: true, day: true, workoutId: true, title: true } }),
    // Workouts given for this day outside a program, and class or session workouts members opened.
    prisma.workoutSession.findMany({ where: { ownerId, assignmentId: null, scheduledDate: fromDay(date), ...coach }, take: 500, select: { id: true, memberId: true, workoutId: true, status: true, completedAt: true, result: true, memberNotes: true, classSessionId: true, appointmentId: true } }),
    prisma.workoutSession.findMany({
      where: { ownerId, status: 'completed', ...coach }, orderBy: { completedAt: 'desc' }, take: 15,
      select: { id: true, memberId: true, workoutVersionId: true, completedAt: true, result: true, memberNotes: true, programName: true, coachFeedback: true },
    }),
    prisma.programAssignment.groupBy({ by: ['status'], where: { ownerId, ...coach }, _count: { _all: true } }),
  ])
  const due = assignments.filter((a) => a.status !== 'paused').flatMap((a) => {
    const t = timing(a, settings.timezone)
    return days.filter((d) => d.programId === a.programId && dateOf(t, d.week, d.day, today) === date).map((d) => ({ a, d }))
  })
  const sessions = due.length ? await prisma.workoutSession.findMany({
    where: { ownerId, assignmentId: { in: Array.from(new Set(due.map((x) => x.a.id))) }, programDayId: { in: Array.from(new Set(due.map((x) => x.d.id))) } },
    select: { id: true, assignmentId: true, programDayId: true, status: true, completedAt: true, result: true, memberNotes: true },
  }) : []
  const sessionIds = [...sessions.map((s) => s.id), ...direct.map((s) => s.id), ...recent.map((s) => s.id)]
  const memberIds = Array.from(new Set([...due.map((x) => x.a.memberId), ...direct.map((s) => s.memberId), ...recent.map((s) => s.memberId)]))
  const [members, workouts, versions, records] = await Promise.all([
    prisma.member.findMany({ where: { ownerId, id: { in: memberIds } }, select: { id: true, name: true, photoUrl: true } }),
    prisma.workout.findMany({ where: { ownerId, id: { in: Array.from(new Set([...due.map((x) => x.d.workoutId), ...direct.map((s) => s.workoutId)])) } }, select: { id: true, name: true } }),
    prisma.workoutVersion.findMany({ where: { id: { in: recent.map((r) => r.workoutVersionId) } }, select: { id: true, name: true } }),
    prisma.personalRecord.groupBy({ by: ['sessionId'], where: { ownerId, sessionId: { in: sessionIds }, previousValue: { not: null } }, _count: { _all: true } }),
  ])
  const member = (id: string) => members.find((m) => m.id === id) || { id, name: 'Former member', photoUrl: null }
  const prs = (id?: string | null) => (id ? records.find((r) => r.sessionId === id)?._count._all || 0 : 0)
  const state = (status?: string | null) => (status === 'completed' || status === 'skipped' || status === 'in_progress' ? status : date < today ? 'missed' : 'not_started')
  const rows = [
    ...due.map(({ a, d }) => {
      const s = sessions.find((x) => x.assignmentId === a.id && x.programDayId === d.id)
      const program = programs.find((p) => p.id === a.programId)
      return { key: `${a.id}:${d.id}`, member: member(a.memberId), workout: d.title || workouts.find((w) => w.id === d.workoutId)?.name || 'Workout', context: `${program?.name || 'Program'} · week ${d.week}`, status: state(s?.status), sessionId: s?.id || null, completedAt: s?.completedAt || null, result: score(s?.result), records: prs(s?.id), note: s?.memberNotes || null }
    }),
    ...direct.map((s) => ({ key: s.id, member: member(s.memberId), workout: workouts.find((w) => w.id === s.workoutId)?.name || 'Workout', context: s.classSessionId ? 'Class workout' : s.appointmentId ? 'Appointment' : 'Assigned workout', status: state(s.status), sessionId: s.id, completedAt: s.completedAt, result: score(s.result), records: prs(s.id), note: s.memberNotes })),
  ].sort((x, y) => x.member.name.localeCompare(y.member.name) || x.workout.localeCompare(y.workout))
  const tally = (status: string) => rows.filter((r) => r.status === status).length
  return {
    date, today, isToday: date === today,
    summary: { due: rows.length, completed: tally('completed'), inProgress: tally('in_progress'), notStarted: tally('not_started'), missed: tally('missed'), skipped: tally('skipped') },
    assignments: { active: counts.filter((c) => c.status === 'active').reduce((n, c) => n + c._count._all, 0), scheduled: counts.find((c) => c.status === 'scheduled')?._count._all || 0, paused: counts.find((c) => c.status === 'paused')?._count._all || 0 },
    rows,
    recent: recent.map((r) => ({ id: r.id, member: member(r.memberId), workout: versions.find((v) => v.id === r.workoutVersionId)?.name || 'Workout', programName: r.programName, completedAt: r.completedAt, result: score(r.result), records: prs(r.id), note: r.memberNotes, hasFeedback: !!r.coachFeedback })),
  }
}

/** Who is on a program, and how far each has got. */
export async function programMembers(ownerId: string, programId: string, own?: string | null) {
  const program = await prisma.program.findFirst({ where: { id: programId, ownerId }, select: { id: true, weeks: true } })
  if (!program) throw notFound('Program')
  const settings = await getGymSettings(ownerId)
  const today = zonedParts(new Date(), settings.timezone).date
  const assignments = await prisma.programAssignment.findMany({ where: { ownerId, programId, ...(own && { coachId: own }) }, orderBy: [{ status: 'asc' }, { startDate: 'desc' }], take: 300 })
  const [members, coaches, done, days] = await Promise.all([
    prisma.member.findMany({ where: { ownerId, id: { in: assignments.map((a) => a.memberId) } }, select: { id: true, name: true, photoUrl: true } }),
    prisma.staff.findMany({ where: { ownerId, id: { in: assignments.map((a) => a.coachId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    prisma.workoutSession.groupBy({ by: ['assignmentId'], where: { ownerId, assignmentId: { in: assignments.map((a) => a.id) }, status: 'completed' }, _count: { _all: true }, _max: { completedAt: true } }),
    prisma.programDay.findMany({ where: { ownerId, programId }, select: { week: true, day: true } }),
  ])
  return assignments.map((a) => {
    const t = timing(a, settings.timezone)
    const total = days.filter((d) => dateOf(t, d.week, d.day, today)).length
    const mine = done.find((d) => d.assignmentId === a.id)
    const due = days.filter((d) => { const on = dateOf(t, d.week, d.day, today); return on && on <= today }).length
    return {
      id: a.id, status: a.status, startDate: t.startDate, endDate: t.endDate, member: members.find((m) => m.id === a.memberId) || { id: a.memberId, name: 'Former member', photoUrl: null },
      coach: coaches.find((c) => c.id === a.coachId) || null, completed: mine?._count._all || 0, total, dueSoFar: a.status === 'paused' ? null : due,
      lastCompletedAt: mine?._max.completedAt || null, week: Math.min(program.weeks, Math.max(1, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${t.startDate}T00:00:00Z`).getTime()) / (7 * 86_400_000)) + 1)),
    }
  })
}

/** One member's training, for the coach: programs, what is due, recent results, records. */
export async function memberProgress(ownerId: string, memberId: string, own?: string | null) {
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId }, select: { id: true, name: true } })
  if (!member) throw notFound('Member')
  if (own) await assertCoaches(ownerId, own, memberId)
  const [overview, history, records, past, coachNotes] = await Promise.all([
    memberWorkouts(ownerId, memberId),
    workoutHistory(ownerId, memberId, { take: 10 }),
    memberRecords(ownerId, memberId, { take: 60 }),
    prisma.programAssignment.findMany({ where: { ownerId, memberId, status: { in: ['completed', 'cancelled'] } }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, programId: true, status: true, startDate: true, completedAt: true } }),
    prisma.workoutSession.findMany({ where: { ownerId, memberId, coachNotes: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, coachNotes: true, updatedAt: true, workoutVersionId: true } }),
  ])
  const [programs, versions] = await Promise.all([
    prisma.program.findMany({ where: { ownerId, id: { in: past.map((p) => p.programId) } }, select: { id: true, name: true } }),
    prisma.workoutVersion.findMany({ where: { id: { in: coachNotes.map((n) => n.workoutVersionId) } }, select: { id: true, name: true } }),
  ])
  return {
    member, today: overview.today, todays: overview.todays, upcoming: overview.upcoming, missed: overview.missed, programs: overview.programs, totals: overview.totals,
    history: history.items, nextBefore: history.nextBefore, records: records.records,
    pastPrograms: past.map((p) => ({ id: p.id, name: programs.find((x) => x.id === p.programId)?.name || 'Program', status: p.status, startDate: toDay(p.startDate), endedAt: p.completedAt })),
    /** Private to staff. Never part of anything sent to the member. */
    coachNotes: coachNotes.map((n) => ({ sessionId: n.id, workout: versions.find((v) => v.id === n.workoutVersionId)?.name || 'Workout', note: n.coachNotes, at: n.updatedAt })),
  }
}
