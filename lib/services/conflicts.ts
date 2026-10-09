// One place that answers "is this person already doing something then?".
//
// Classes and appointments are different tables, so nothing in the database
// relates them. These checks do, and they are safe under concurrency because
// each takes a row lock first: every path that gives a member a place locks
// that member's row, and every path that puts something in a coach's diary
// locks that staff row. Two simultaneous conflicting requests therefore run
// one after the other, and the second sees what the first did.
//
// Lock order is always: class session, then staff, then member.

import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Db, lockRow } from './core'

const clash = (code: string, message: string, details?: unknown) => new ApiError(409, message, code, details)

/** Appointments that occupy a coach's or member's time (attended ones are in the past but still theirs). */
const HOLDING = ['booked', 'completed']

export interface Busy {
  start: number
  end: number
  name: string
}

/** What a member already has on between two instants: appointments and booked classes. */
export async function memberBusy(db: Db, ownerId: string, memberId: string, from: Date, to: Date, ignore: { appointmentId?: string; bookingId?: string } = {}) {
  const [appointments, bookings] = await Promise.all([
    db.appointment.findMany({
      where: { ownerId, memberId, status: { in: HOLDING }, startsAt: { lt: to }, endsAt: { gt: from }, ...(ignore.appointmentId && { id: { not: ignore.appointmentId } }) },
      select: { startsAt: true, endsAt: true, type: { select: { name: true } } },
    }),
    db.booking.findMany({
      where: { ownerId, memberId, status: 'booked', ...(ignore.bookingId && { id: { not: ignore.bookingId } }), session: { status: 'scheduled', startsAt: { lt: to }, endsAt: { gt: from } } },
      select: { session: { select: { startsAt: true, endsAt: true, title: true, classType: { select: { name: true } } } } },
    }),
  ])
  return {
    appointments: appointments.map((a): Busy => ({ start: a.startsAt.getTime(), end: a.endsAt.getTime(), name: a.type.name })),
    classes: bookings.map((b): Busy => ({ start: b.session.startsAt.getTime(), end: b.session.endsAt.getTime(), name: b.session.title || b.session.classType.name })),
  }
}

/**
 * Refuse to give a member a place that overlaps something they already have.
 * Locks the member row, so of two simultaneous overlapping bookings one waits
 * and is then refused. Back-to-back is fine: ending at 10:00 does not clash
 * with starting at 10:00.
 */
export async function assertMemberFree(db: Db, input: { ownerId: string; memberId: string; memberName: string; startsAt: Date; endsAt: Date; ignore?: { appointmentId?: string; bookingId?: string }; viaStaff: boolean; tz: string }) {
  await lockRow(db, 'Member', input.memberId)
  const busy = await memberBusy(db, input.ownerId, input.memberId, input.startsAt, input.endsAt, input.ignore)
  const who = input.viaStaff ? `${input.memberName} is` : 'You are'
  const has = input.viaStaff ? `${input.memberName} has` : 'You have'
  if (busy.classes.length) {
    const c = busy.classes[0]
    throw clash('member_in_class', `${who} already booked into ${c.name} at ${formatDateTime(new Date(c.start), input.tz)}.`, { clashesWith: c.name })
  }
  if (busy.appointments.length) {
    const a = busy.appointments[0]
    throw clash('member_busy', `${has} ${a.name} booked at ${formatDateTime(new Date(a.start), input.tz)}.`, { clashesWith: a.name })
  }
}

/** Appointments in a coach's diary between two instants. */
export async function coachAppointments(db: Db, ownerId: string, coachId: string, from: Date, to: Date) {
  return db.appointment.findMany({
    where: { ownerId, staffId: coachId, status: 'booked', startsAt: { lt: to }, endsAt: { gt: from } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, endsAt: true, type: { select: { name: true } }, member: { select: { name: true } }, staff: { select: { name: true } } },
  })
}

/** Classes a coach is down to teach between two instants. */
export async function coachClasses(db: Db, ownerId: string, coachId: string, from: Date, to: Date, ignoreSessionId?: string | null) {
  return db.classSession.findMany({
    where: { ownerId, coachId, status: 'scheduled', startsAt: { lt: to }, endsAt: { gt: from }, ...(ignoreSessionId && { id: { not: ignoreSessionId } }) },
    orderBy: { startsAt: 'asc' },
    select: { id: true, scheduleId: true, startsAt: true, endsAt: true, title: true, classType: { select: { name: true } }, coach: { select: { name: true } } },
  })
}

/**
 * Refuse to put a class in a coach's diary on top of an appointment or another
 * class. Locks the staff row, which booking an appointment and every other
 * class change also do, so two things created at the same moment cannot both
 * land. Back-to-back is fine. `ignoreSessionId` is the class being edited.
 */
export async function assertCoachFreeForClass(db: Db, input: { ownerId: string; coachId: string; startsAt: Date; endsAt: Date; tz: string; ignoreSessionId?: string | null }) {
  await lockRow(db, 'Staff', input.coachId)
  const [other] = await coachClasses(db, input.ownerId, input.coachId, input.startsAt, input.endsAt, input.ignoreSessionId)
  if (other) {
    throw clash('coach_has_class', `${other.coach?.name || 'That coach'} is already teaching ${other.title || other.classType.name} at ${formatDateTime(other.startsAt, input.tz)}. Choose another coach or time.`, { sessionId: other.id })
  }
  const [first] = await coachAppointments(db, input.ownerId, input.coachId, input.startsAt, input.endsAt)
  if (first) {
    throw clash('coach_has_appointment', `${first.staff.name} has an appointment then (${first.type.name} with ${first.member.name}, ${formatDateTime(first.startsAt, input.tz)}). Move the appointment or choose another coach or time.`, { appointmentId: first.id })
  }
}
