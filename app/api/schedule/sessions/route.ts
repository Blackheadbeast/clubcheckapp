import { prisma } from '@/lib/prisma'
import { assertAllOwned, assertOwned, badRequest, handler } from '@/lib/api'
import { addDays, zonedToUtc } from '@/lib/dates'
import { sessionSchema } from '@/lib/schemas'
import { ensureSessions, listSessions } from '@/lib/services/classes'
import { expireOffers } from '@/lib/services/bookings'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/schedule/sessions?from=&to=&locationId=&coachId=&classTypeId=
export const GET = handler({ permission: 'classes.view' }, async ({ ownerId, query }) => {
  const now = new Date()
  const from = query.get('from') ? new Date(query.get('from')!) : now
  const to = query.get('to') ? new Date(query.get('to')!) : addDays(from, 7)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw badRequest('Invalid date range')
  if (to.getTime() - from.getTime() > 100 * 86_400_000) throw badRequest('Choose a range of 100 days or less')
  // Recurring classes are materialised lazily as the calendar looks further ahead.
  await ensureSessions(ownerId, to, now)
  await expireOffers(ownerId, now)
  return listSessions(ownerId, {
    from, to,
    locationId: query.get('locationId'),
    coachId: query.get('coachId'),
    classTypeId: query.get('classTypeId'),
    includeCancelled: query.get('cancelled') === '1',
  })
})

// POST - a one-off class, workshop, event or PT session
export const POST = handler({ permission: 'classes.manage', write: true, body: sessionSchema }, async ({ ownerId, body, audit }) => {
  await assertOwned(ownerId, 'classType', body.classTypeId, 'Class')
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  await assertOwned(ownerId, 'staff', body.coachId, 'Coach')
  await assertAllOwned(ownerId, 'membershipPlan', body.allowedPlanIds, 'Membership plan')
  const settings = await getGymSettings(ownerId)
  const { date, startTime, durationMin, ...rest } = body
  const startsAt = zonedToUtc(date, startTime, settings.timezone)
  const session = await prisma.classSession.create({
    data: { ownerId, ...rest, startsAt, endsAt: new Date(startsAt.getTime() + durationMin * 60_000) },
  })
  await audit('session.create', 'Scheduled a class', { entityType: 'classSession', entityId: session.id, after: { startsAt, classTypeId: body.classTypeId } })
  return { id: session.id }
})
