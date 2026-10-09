// The staff "Today" screen: everything happening at the gym (or one location)
// today, in one bounded read. Nothing here scans history: every query is
// limited to today's window in the gym's timezone.

import { prisma } from '@/lib/prisma'
import { startOfZonedDay } from '@/lib/dates'
import { normalizeMemberStatus } from '@/lib/format'
import type { Actor } from '@/lib/api'
import { getGymSettings } from './core'
import { balancesFor } from './members'
import { findMembers } from './checkin'

/**
 * Which location a staff member is limited to. Owners, admins and managers can
 * look across every location; other staff with a home location only see that one.
 * Returns null when there is no restriction.
 */
export async function lockedLocation(ownerId: string, actor: Actor): Promise<string | null> {
  if (actor.type !== 'staff' || ['admin', 'manager'].includes(actor.role)) return null
  const staff = await prisma.staff.findFirst({ where: { id: actor.id, ownerId }, select: { locationId: true } })
  return staff?.locationId || null
}

/** The location a request may read: the locked one if there is one, otherwise what was asked for. */
export async function effectiveLocation(ownerId: string, actor: Actor, requested: string | null | undefined) {
  const locked = await lockedLocation(ownerId, actor)
  if (locked) return { locationId: locked, locked: true }
  if (!requested) return { locationId: null, locked: false }
  const owned = await prisma.location.findFirst({ where: { id: requested, ownerId }, select: { id: true } })
  return { locationId: owned?.id || null, locked: false }
}

export type LocationScope = Awaited<ReturnType<typeof effectiveLocation>>

/**
 * Which members a request may list. Members belong to the whole gym and can train anywhere, so
 * looking one up by name (check-in, Today) is never limited. Lists and totals are: staff locked to
 * a location get the members whose home is that location, plus those with no home location.
 */
export function homeScope(scope: LocationScope) {
  if (!scope.locationId) return {}
  return scope.locked ? { OR: [{ homeLocationId: scope.locationId }, { homeLocationId: null }] } : { homeLocationId: scope.locationId }
}

export interface TodayOptions {
  locationId: string | null
  /** Limit classes and appointments to this staff member's own. */
  staffId?: string | null
  includeClasses: boolean
  includeAppointments: boolean
  includeCheckins: boolean
  now?: Date
}

export async function getToday(ownerId: string, options: TodayOptions) {
  const settings = await getGymSettings(ownerId)
  const now = options.now || new Date()
  const dayStart = startOfZonedDay(now, settings.timezone)
  // Tomorrow's local midnight, found by asking for the start of the day 30 hours on (a day can be 23 or 25 hours long).
  const dayEnd = startOfZonedDay(new Date(dayStart.getTime() + 30 * 3_600_000), settings.timezone)
  const location = options.locationId ? { locationId: options.locationId } : {}

  const [sessions, appointments, checkins, checkinCount, locationRow] = await Promise.all([
    options.includeClasses
      ? prisma.classSession.findMany({
          where: { ownerId, startsAt: { gte: dayStart, lt: dayEnd }, status: 'scheduled', ...location, ...(options.staffId && { coachId: options.staffId }) },
          orderBy: { startsAt: 'asc' },
          take: 200,
          select: { id: true, title: true, startsAt: true, endsAt: true, capacity: true, room: true, classType: { select: { name: true, color: true } }, coach: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
        })
      : [],
    options.includeAppointments
      ? prisma.appointment.findMany({
          where: { ownerId, startsAt: { gte: dayStart, lt: dayEnd }, status: { in: ['booked', 'completed', 'no_show'] }, ...location, ...(options.staffId && { staffId: options.staffId }) },
          orderBy: { startsAt: 'asc' },
          take: 300,
          select: { id: true, status: true, startsAt: true, endsAt: true, type: { select: { name: true, color: true, durationMin: true } }, staff: { select: { id: true, name: true } }, member: { select: { id: true, name: true, photoUrl: true } }, location: { select: { id: true, name: true } } },
        })
      : [],
    options.includeCheckins
      ? prisma.checkin.findMany({
          where: { ownerId, timestamp: { gte: dayStart, lt: dayEnd }, ...location },
          orderBy: { timestamp: 'desc' },
          take: 12,
          select: { id: true, timestamp: true, type: true, source: true, member: { select: { id: true, name: true, photoUrl: true, currentStreak: true } }, session: { select: { title: true, classType: { select: { name: true } } } } },
        })
      : [],
    options.includeCheckins ? prisma.checkin.count({ where: { ownerId, timestamp: { gte: dayStart, lt: dayEnd }, ...location } }) : 0,
    options.locationId ? prisma.location.findFirst({ where: { id: options.locationId, ownerId }, select: { id: true, name: true } }) : null,
  ])

  // One grouped count for every class today, rather than a query per class.
  const counts = sessions.length
    ? await prisma.booking.groupBy({ by: ['sessionId', 'status'], where: { sessionId: { in: sessions.map((s) => s.id) } }, _count: { _all: true } })
    : []
  const bySession = new Map<string, Record<string, number>>()
  for (const row of counts) bySession.set(row.sessionId, { ...(bySession.get(row.sessionId) || {}), [row.status]: row._count._all })

  const classes = sessions.map((s) => {
    const c = bySession.get(s.id) || {}
    const booked = (c.booked || 0) + (c.offered || 0) + (c.attended || 0)
    return {
      id: s.id, name: s.title || s.classType.name, color: s.classType.color, startsAt: s.startsAt, endsAt: s.endsAt,
      coach: s.coach, location: s.location?.name || null, room: s.room, capacity: s.capacity,
      booked, checkedIn: c.attended || 0, noShows: c.no_show || 0, waitlisted: (c.waitlisted || 0) + (c.offered || 0), spotsLeft: Math.max(0, s.capacity - booked),
    }
  })
  const live = <T extends { startsAt: Date; endsAt: Date }>(items: T[]) => items.filter((i) => i.startsAt <= now && i.endsAt > now)

  return {
    date: dayStart,
    serverTime: now,
    timezone: settings.timezone,
    location: locationRow,
    classes,
    appointments: appointments.map((a) => ({ id: a.id, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, type: a.type, staff: a.staff, member: a.member, location: a.location?.name || null })),
    recentCheckins: checkins.map((c) => ({ id: c.id, at: c.timestamp, source: c.source, member: c.member, label: c.session ? c.session.title || c.session.classType.name : c.type === 'personal_training' ? 'Personal training' : 'Open gym' })),
    summary: {
      checkins: checkinCount,
      classes: classes.length,
      classesRemaining: classes.filter((c) => c.endsAt > now).length,
      appointments: appointments.filter((a) => a.status !== 'no_show').length,
      appointmentsRemaining: appointments.filter((a) => a.status === 'booked' && a.endsAt > now).length,
      booked: classes.filter((c) => c.endsAt > now).reduce((sum, c) => sum + c.booked - c.checkedIn, 0),
      toRecord: appointments.filter((a) => a.status === 'booked' && a.endsAt <= now).length,
      inNow: live(classes).reduce((sum, c) => sum + c.checkedIn, 0),
    },
  }
}

/** Member lookup for the front desk: who they are, and what matters about them today. */
export async function lookupMembers(ownerId: string, query: string, options: { withBalance: boolean }) {
  const q = query.trim()
  let found = await findMembers(ownerId, q, 8)
  // A pasted member id is an exact match too.
  if (found.length === 0 && /^[0-9a-f-]{36}$/i.test(q)) {
    const byId = await prisma.member.findFirst({ where: { id: q, ownerId, archivedAt: null }, select: { id: true, name: true, email: true, phone: true, photoUrl: true, status: true, lastCheckInAt: true } })
    if (byId) found = [{ ...byId, exact: true }]
  }
  if (found.length === 0) return []
  const settings = await getGymSettings(ownerId)
  const now = new Date()
  const dayStart = startOfZonedDay(now, settings.timezone)
  const dayEnd = startOfZonedDay(new Date(dayStart.getTime() + 30 * 3_600_000), settings.timezone)
  const ids = found.map((m) => m.id)
  const [bookings, appointments, checkins, balances, memberships] = await Promise.all([
    prisma.booking.findMany({ where: { ownerId, memberId: { in: ids }, status: { in: ['booked', 'attended', 'waitlisted', 'offered'] }, session: { status: 'scheduled', startsAt: { gte: dayStart, lt: dayEnd } } }, orderBy: { session: { startsAt: 'asc' } }, select: { memberId: true, status: true, session: { select: { title: true, startsAt: true, classType: { select: { name: true } } } } } }),
    prisma.appointment.findMany({ where: { ownerId, memberId: { in: ids }, status: { in: ['booked', 'completed'] }, startsAt: { gte: dayStart, lt: dayEnd } }, orderBy: { startsAt: 'asc' }, select: { memberId: true, status: true, startsAt: true, type: { select: { name: true } } } }),
    prisma.checkin.findMany({ where: { ownerId, memberId: { in: ids }, timestamp: { gte: dayStart } }, orderBy: { timestamp: 'desc' }, select: { memberId: true, timestamp: true } }),
    options.withBalance ? balancesFor(ownerId, ids) : new Map<string, number>(),
    prisma.membership.findMany({ where: { ownerId, memberId: { in: ids }, status: { in: ['active', 'trial', 'past_due', 'frozen'] } }, orderBy: { createdAt: 'desc' }, select: { memberId: true, status: true, plan: { select: { name: true } } } }),
  ])
  return found.map((m) => {
    const booking = bookings.find((b) => b.memberId === m.id)
    const appointment = appointments.find((a) => a.memberId === m.id)
    const checkin = checkins.find((c) => c.memberId === m.id)
    const membership = memberships.find((x) => x.memberId === m.id)
    return {
      id: m.id, name: m.name, email: m.email, phone: m.phone, photoUrl: m.photoUrl, status: normalizeMemberStatus(m.status), exact: m.exact,
      membership: membership ? membership.plan.name : null,
      today: booking ? { kind: 'class' as const, name: booking.session.title || booking.session.classType.name, startsAt: booking.session.startsAt, status: booking.status }
        : appointment ? { kind: 'appointment' as const, name: appointment.type.name, startsAt: appointment.startsAt, status: appointment.status } : null,
      checkedInAt: checkin?.timestamp || null,
      balanceCents: options.withBalance ? balances.get(m.id) || 0 : null,
    }
  })
}
