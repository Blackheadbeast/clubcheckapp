// Class types, recurring schedules and the concrete sessions generated from them.

import type { ClassSchedule, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { addDays, addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Db, GymSettings, getGymSettings, lockRow, notify } from './core'
import { assertCoachFreeForClass, coachAppointments, coachClasses } from './conflicts'

/** How far ahead recurring schedules are materialised. */
export const GENERATION_HORIZON_DAYS = 56

/** Bookings in these states hold a spot in the class. */
export const SPOT_STATUSES = ['booked', 'offered', 'attended']

/** Create sessions for a schedule up to `through` (idempotent via the unique scheduleId+startsAt). */
/**
 * `strict` is for staff saving a schedule: a clash with the coach's appointments stops the save.
 * Background generation is not strict: the class is still created, without the coach, and staff are told.
 */
export async function generateSessions(db: Db, schedule: ClassSchedule, settings: GymSettings, through: Date, now = new Date(), strict = false) {
  if (!schedule.isActive || schedule.daysOfWeek.length === 0) return 0
  const tz = settings.timezone
  const scheduleStart = zonedParts(schedule.startDate, tz).date
  const today = zonedParts(now, tz).date
  const resumeFrom = schedule.generatedThrough ? addDaysToDate(zonedParts(schedule.generatedThrough, tz).date, 1) : scheduleStart
  let date = [scheduleStart, today, resumeFrom].sort().pop()!
  const lastDate = [zonedParts(through, tz).date, schedule.endDate ? zonedParts(schedule.endDate, tz).date : '9999-12-31'].sort()[0]

  const rows: Prisma.ClassSessionCreateManyInput[] = []
  for (; date <= lastDate && rows.length < 1000; date = addDaysToDate(date, 1)) {
    const [y, m, d] = date.split('-').map(Number)
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    if (!schedule.daysOfWeek.includes(weekday)) continue
    const startsAt = zonedToUtc(date, schedule.startTime, tz)
    if (startsAt < now) continue
    rows.push({
      ownerId: schedule.ownerId,
      classTypeId: schedule.classTypeId,
      scheduleId: schedule.id,
      locationId: schedule.locationId,
      coachId: schedule.coachId,
      room: schedule.room,
      startsAt,
      endsAt: new Date(startsAt.getTime() + schedule.durationMin * 60_000),
      capacity: schedule.capacity,
      waitlistCapacity: schedule.waitlistCapacity,
    })
  }
  if (schedule.coachId && rows.length) {
    // A coach cannot teach a class during one of their appointments, or during another class.
    if (strict) await lockRow(db, 'Staff', schedule.coachId)
    const first = rows[0].startsAt as Date
    const last = rows[rows.length - 1].endsAt as Date
    const teaching = await coachClasses(db, schedule.ownerId, schedule.coachId, first, last)
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      const hit = teaching.find((c) => c.startsAt < (row.endsAt as Date) && (row.startsAt as Date) < c.endsAt)
      if (!hit) continue
      if (hit.scheduleId === schedule.id) {
        // This schedule's own class is already there that day: the same one (left alone below), or one
        // that kept its old time because people are booked into it. Either way it stands in for this one.
        if (hit.startsAt.getTime() !== (row.startsAt as Date).getTime()) rows.splice(i, 1)
        continue
      }
      const other = hit.title || hit.classType.name
      if (strict) {
        throw new ApiError(409, `${hit.coach?.name || 'That coach'} is already teaching ${other} at ${formatDateTime(hit.startsAt, tz)}. Choose another coach or time.`, 'coach_has_class', { sessionId: hit.id })
      }
      row.coachId = null
      await notify(db, { ownerId: schedule.ownerId, type: 'schedule', title: 'A class needs a coach', body: `${hit.coach?.name || 'The coach'} is already teaching ${other} at ${formatDateTime(row.startsAt as Date, tz)}, so the class then was scheduled without a coach.`, href: '/schedule' })
    }
    const taken = await coachAppointments(db, schedule.ownerId, schedule.coachId, first, last)
    for (const row of rows) {
      if (!row.coachId) continue
      const hit = taken.find((a) => a.startsAt < (row.endsAt as Date) && (row.startsAt as Date) < a.endsAt)
      if (!hit) continue
      if (strict) {
        throw new ApiError(409, `${hit.staff.name} has an appointment during this class on ${formatDateTime(hit.startsAt, tz)} (${hit.type.name} with ${hit.member.name}). Move the appointment or choose another coach or time.`, 'coach_has_appointment', { appointmentId: hit.id })
      }
      row.coachId = null
      await notify(db, { ownerId: schedule.ownerId, type: 'schedule', title: 'A class needs a coach', body: `${hit.staff.name} has an appointment during the class on ${formatDateTime(row.startsAt as Date, tz)}, so it was scheduled without a coach.`, href: '/schedule' })
    }
  }
  const result = rows.length ? await db.classSession.createMany({ data: rows, skipDuplicates: true }) : { count: 0 }
  await db.classSchedule.update({ where: { id: schedule.id }, data: { generatedThrough: through } })
  return result.count
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/**
 * Refuse a recurring class that would put its coach in two places every week. Checking the
 * generated classes catches the next eight weeks; this catches a schedule that starts later
 * than that, or one whose classes have not been generated yet.
 */
export async function assertCoachFreeForSchedule(db: Db, schedule: ClassSchedule) {
  if (!schedule.coachId || !schedule.isActive) return
  await lockRow(db, 'Staff', schedule.coachId)
  const others = await db.classSchedule.findMany({
    where: { ownerId: schedule.ownerId, coachId: schedule.coachId, isActive: true, id: { not: schedule.id }, daysOfWeek: { hasSome: schedule.daysOfWeek } },
    include: { classType: { select: { name: true } }, coach: { select: { name: true } } },
  })
  const start = minutes(schedule.startTime)
  for (const other of others) {
    const otherStart = minutes(other.startTime)
    if (!(start < otherStart + other.durationMin && otherStart < start + schedule.durationMin)) continue
    // Two runs that never share a date do not clash.
    if (other.endDate && other.endDate < schedule.startDate) continue
    if (schedule.endDate && schedule.endDate < other.startDate) continue
    throw new ApiError(409, `${other.coach?.name || 'That coach'} already teaches ${other.classType.name} at ${other.startTime} on one of those days. Choose another coach or time.`, 'coach_has_class', { scheduleId: other.id })
  }
}

/** Make sure every active schedule has sessions through `through` (capped at the horizon). */
/**
 * `exact` generates all the way to `through` even past the usual horizon. Appointment
 * availability uses it so that a class always exists before a time on that date can be offered.
 */
export async function ensureSessions(ownerId: string, through?: Date, now = new Date(), exact = false) {
  const horizon = exact && through && through > addDays(now, GENERATION_HORIZON_DAYS) ? through : addDays(now, GENERATION_HORIZON_DAYS)
  const target = through && through < horizon ? through : horizon
  const stale = await prisma.classSchedule.findMany({
    where: { ownerId, isActive: true, OR: [{ generatedThrough: null }, { generatedThrough: { lt: target } }] },
  })
  if (stale.length === 0) return 0
  const settings = await getGymSettings(ownerId)
  let created = 0
  for (const schedule of stale) created += await generateSessions(prisma, schedule, settings, horizon, now)
  return created
}

/**
 * Apply an edited schedule to its future sessions. Sessions nobody has booked
 * are regenerated from the template; sessions with bookings keep their time
 * (so members are not silently moved) but take the new coach, room and capacity.
 */
export async function resyncSchedule(db: Db, schedule: ClassSchedule, settings: GymSettings, now = new Date()) {
  const future = await db.classSession.findMany({
    where: { scheduleId: schedule.id, startsAt: { gt: now }, status: 'scheduled' },
    select: { id: true, _count: { select: { bookings: { where: { status: { in: [...SPOT_STATUSES, 'waitlisted'] } } } } } },
  })
  const empty = future.filter((s) => s._count.bookings === 0).map((s) => s.id)
  const kept = future.filter((s) => s._count.bookings > 0).map((s) => s.id)
  if (empty.length) await db.classSession.deleteMany({ where: { id: { in: empty } } })
  if (kept.length) {
    if (schedule.coachId) {
      // Classes that keep their time take the schedule's coach, who must be free for each of them.
      const staying = await db.classSession.findMany({ where: { id: { in: kept }, NOT: { coachId: schedule.coachId } }, select: { id: true, startsAt: true, endsAt: true } })
      for (const s of staying) await assertCoachFreeForClass(db, { ownerId: schedule.ownerId, coachId: schedule.coachId, startsAt: s.startsAt, endsAt: s.endsAt, tz: settings.timezone, ignoreSessionId: s.id })
    }
    await db.classSession.updateMany({
      where: { id: { in: kept } },
      data: { coachId: schedule.coachId, room: schedule.room, locationId: schedule.locationId, classTypeId: schedule.classTypeId, waitlistCapacity: schedule.waitlistCapacity },
    })
    // Never shrink below what is already booked.
    for (const s of future.filter((f) => f._count.bookings > 0)) {
      await db.classSession.update({ where: { id: s.id }, data: { capacity: Math.max(schedule.capacity, s._count.bookings) } })
    }
  }
  const reset = await db.classSchedule.update({ where: { id: schedule.id }, data: { generatedThrough: null } })
  const created = schedule.isActive ? await generateSessions(db, reset, settings, addDays(now, GENERATION_HORIZON_DAYS), now, true) : 0
  return { regenerated: created, keptWithBookings: kept.length }
}

export interface SessionFilters {
  from: Date
  to: Date
  locationId?: string | null
  coachId?: string | null
  classTypeId?: string | null
  includeCancelled?: boolean
}

export async function listSessions(ownerId: string, filters: SessionFilters) {
  const sessions = await prisma.classSession.findMany({
    where: {
      ownerId,
      startsAt: { gte: filters.from, lt: filters.to },
      ...(filters.locationId && { locationId: filters.locationId }),
      ...(filters.coachId && { coachId: filters.coachId }),
      ...(filters.classTypeId && { classTypeId: filters.classTypeId }),
      ...(!filters.includeCancelled && { status: 'scheduled' }),
    },
    orderBy: { startsAt: 'asc' },
    take: 1500,
    include: {
      classType: { select: { id: true, name: true, color: true, category: true } },
      coach: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
  })
  if (sessions.length === 0) return []
  const counts = await prisma.booking.groupBy({
    by: ['sessionId', 'status'],
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    _count: { _all: true },
  })
  const bySession = new Map<string, Record<string, number>>()
  for (const row of counts) {
    const entry = bySession.get(row.sessionId) || {}
    entry[row.status] = row._count._all
    bySession.set(row.sessionId, entry)
  }
  return sessions.map((s) => {
    const c = bySession.get(s.id) || {}
    const booked = (c.booked || 0) + (c.offered || 0) + (c.attended || 0)
    return {
      id: s.id,
      title: s.title || s.classType.name,
      classType: s.classType,
      coach: s.coach,
      location: s.location,
      room: s.room,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      status: s.status,
      cancelReason: s.cancelReason,
      scheduleId: s.scheduleId,
      capacity: s.capacity,
      waitlistCapacity: s.waitlistCapacity,
      booked,
      spotsLeft: Math.max(0, s.capacity - booked),
      waitlisted: c.waitlisted || 0,
      attended: c.attended || 0,
      noShow: c.no_show || 0,
    }
  })
}

export type SessionSummary = Awaited<ReturnType<typeof listSessions>>[number]
