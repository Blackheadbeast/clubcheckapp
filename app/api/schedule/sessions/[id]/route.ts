import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, assertAllOwned, assertOwned, badRequest, handler, notFound } from '@/lib/api'
import { zonedParts, zonedToUtc } from '@/lib/dates'
import { formatDateTime } from '@/lib/format'
import { sessionSchema } from '@/lib/schemas'
import { SPOT_STATUSES } from '@/lib/services/classes'
import { cancelSession, promoteWaitlist } from '@/lib/services/bookings'
import { getGymSettings, lockRow } from '@/lib/services/core'
import { queueMessage } from '@/lib/services/messaging'
import { flushOutbox } from '@/lib/services/automations'
import { assertCoachFreeForClass } from '@/lib/services/conflicts'

export const dynamic = 'force-dynamic'

// GET - one session with its roster and waitlist
export const GET = handler({ permission: 'classes.view' }, async ({ ownerId, params }) => {
  const session = await prisma.classSession.findFirst({
    where: { id: params.id, ownerId },
    include: {
      classType: { select: { id: true, name: true, color: true, category: true } },
      coach: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      bookings: {
        where: { status: { notIn: ['cancelled'] } },
        orderBy: [{ waitlistedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
        select: {
          id: true, status: true, creditUsed: true, source: true, createdAt: true, waitlistedAt: true, offerExpiresAt: true, checkedInAt: true,
          member: { select: { id: true, name: true, photoUrl: true, status: true, medicalNotes: true } },
          membership: { select: { plan: { select: { name: true } } } },
        },
      },
    },
  })
  if (!session) throw notFound('Class')
  const settings = await getGymSettings(ownerId)
  const local = zonedParts(session.startsAt, settings.timezone)
  const workout = session.workoutId ? await prisma.workout.findFirst({ where: { id: session.workoutId, ownerId }, select: { id: true, name: true } }) : null
  const roster = session.bookings.filter((b) => !['waitlisted', 'offered', 'late_cancelled'].includes(b.status))
  return {
    ...session,
    title: session.title || session.classType.name,
    customTitle: session.title,
    // The programmed workout for this class, if one is attached. Doing it is separate from attending.
    workout,
    date: local.date,
    startTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
    durationMin: Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000),
    bookings: undefined,
    roster: roster.map(({ member, ...b }) => ({ ...b, member: { ...member, medicalNotes: undefined, hasMedicalNotes: !!member.medicalNotes } })),
    waitlist: session.bookings.filter((b) => ['waitlisted', 'offered'].includes(b.status)).map(({ member, ...b }, i) => ({ ...b, position: i + 1, member: { ...member, medicalNotes: undefined } })),
    lateCancels: session.bookings.filter((b) => b.status === 'late_cancelled').length,
    booked: session.bookings.filter((b) => SPOT_STATUSES.includes(b.status)).length,
  }
})

const patchSchema = sessionSchema.partial().extend({ notifyMembers: z.boolean().optional() })

// PATCH - edit or reschedule (also used by drag-and-drop on the calendar)
export const PATCH = handler({ permission: 'classes.manage', write: true, body: patchSchema }, async ({ ownerId, params, body, audit }) => {
  await assertOwned(ownerId, 'classType', body.classTypeId, 'Class')
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  await assertOwned(ownerId, 'staff', body.coachId, 'Coach')
  await assertAllOwned(ownerId, 'membershipPlan', body.allowedPlanIds, 'Membership plan')
  const settings = await getGymSettings(ownerId)

  const result = await prisma.$transaction(async (db) => {
    await lockRow(db, 'ClassSession', params.id)
    const before = await db.classSession.findFirst({ where: { id: params.id, ownerId }, include: { classType: { select: { name: true, category: true } } } })
    if (!before) throw notFound('Class')
    if (before.status === 'cancelled') throw badRequest('A cancelled class cannot be edited.', 'class_cancelled')
    const { date, startTime, durationMin, notifyMembers, ...rest } = body

    const local = zonedParts(before.startsAt, settings.timezone)
    const currentTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
    const startsAt = date || startTime ? zonedToUtc(date || local.date, startTime || currentTime, settings.timezone) : before.startsAt
    const duration = durationMin ?? Math.round((before.endsAt.getTime() - before.startsAt.getTime()) / 60_000)
    const moved = startsAt.getTime() !== before.startsAt.getTime()

    const taken = await db.booking.count({ where: { sessionId: before.id, status: { in: SPOT_STATUSES } } })
    if (rest.capacity !== undefined && rest.capacity < taken) {
      throw new ApiError(409, `${taken} people are already booked. Capacity can't go below that.`, 'capacity_below_booked')
    }

    const endsAt = new Date(startsAt.getTime() + duration * 60_000)
    const coachId = rest.coachId === undefined ? before.coachId : rest.coachId
    // Moving the class, lengthening it or changing its coach must not land it on that coach's appointments or other classes.
    if (coachId && (moved || coachId !== before.coachId || endsAt.getTime() !== before.endsAt.getTime())) {
      await assertCoachFreeForClass(db, { ownerId, coachId, startsAt, endsAt, tz: settings.timezone, ignoreSessionId: before.id })
    }

    const session = await db.classSession.update({
      where: { id: before.id },
      data: {
        ...rest,
        startsAt,
        endsAt: new Date(startsAt.getTime() + duration * 60_000),
        // A session moved by hand no longer follows its recurring template.
        ...(moved && { scheduleId: null }),
      },
      include: { classType: { select: { name: true, category: true } } },
    })

    let notified = 0
    if (moved && notifyMembers !== false && startsAt > new Date()) {
      const bookings = await db.booking.findMany({ where: { sessionId: session.id, status: { in: ['booked', 'offered', 'waitlisted'] } }, select: { memberId: true } })
      const name = session.title || session.classType.name
      for (const b of bookings) {
        await queueMessage(db, {
          ownerId, channel: 'email', memberId: b.memberId, transactional: true,
          subject: `Time change: ${name}`,
          body: `Hi {{first_name}},\n\n${name} has moved from ${formatDateTime(before.startsAt, settings.timezone)} to ${formatDateTime(startsAt, settings.timezone)}.\n\nIf the new time doesn't work you can cancel here:\n{{portal_link}}`,
        })
        notified++
      }
    }
    // Extra capacity may let people off the waitlist.
    if (rest.capacity !== undefined && rest.capacity > before.capacity) await promoteWaitlist(db, session, settings)
    return { before, session, moved, notified }
  }, { timeout: 20_000 })

  await audit(result.moved ? 'session.reschedule' : 'session.update', result.moved ? `Moved ${result.session.title || result.session.classType.name} to ${formatDateTime(result.session.startsAt, settings.timezone)}` : `Updated ${result.session.title || result.session.classType.name}`, {
    entityType: 'classSession', entityId: params.id,
    before: { startsAt: result.before.startsAt, coachId: result.before.coachId, capacity: result.before.capacity },
    after: { startsAt: result.session.startsAt, coachId: result.session.coachId, capacity: result.session.capacity },
  })
  await flushOutbox(ownerId)
  return { id: params.id, moved: result.moved, notified: result.notified }
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal('duplicate'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/).optional() }),
])

// POST - cancel the class or copy it to another day
export const POST = handler({ permission: 'classes.manage', write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  if (body.action === 'cancel') {
    const result = await prisma.$transaction((db) => cancelSession(db, { ownerId, sessionId: params.id, reason: body.reason, actor }), { timeout: 30_000 })
    await audit('session.cancel', `Cancelled ${result.name}${body.reason ? `: ${body.reason}` : ''}`, { entityType: 'classSession', entityId: params.id, metadata: { affected: result.affected } })
    await flushOutbox(ownerId)
    return { cancelled: true, affected: result.affected }
  }
  const source = await prisma.classSession.findFirst({ where: { id: params.id, ownerId } })
  if (!source) throw notFound('Class')
  const settings = await getGymSettings(ownerId)
  const local = zonedParts(source.startsAt, settings.timezone)
  const time = body.startTime || `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
  const startsAt = zonedToUtc(body.date, time, settings.timezone)
  const endsAt = new Date(startsAt.getTime() + (source.endsAt.getTime() - source.startsAt.getTime()))
  const copy = await prisma.$transaction(async (db) => {
    if (source.coachId) await assertCoachFreeForClass(db, { ownerId, coachId: source.coachId, startsAt, endsAt, tz: settings.timezone })
    return db.classSession.create({
      data: {
        ownerId, classTypeId: source.classTypeId, locationId: source.locationId, coachId: source.coachId, title: source.title, room: source.room,
        capacity: source.capacity, waitlistCapacity: source.waitlistCapacity, allowedPlanIds: source.allowedPlanIds, notes: source.notes, startsAt, endsAt,
      },
    })
  }, { timeout: 15_000 })
  await audit('session.duplicate', 'Duplicated a class', { entityType: 'classSession', entityId: copy.id, metadata: { from: source.id } })
  return { id: copy.id }
})
