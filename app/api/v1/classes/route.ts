import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { classOut } from '@/lib/public-api/serialize'
import { ensureSessions } from '@/lib/services/classes'

export const dynamic = 'force-dynamic'

const MAX_RANGE_DAYS = 62

// GET /api/v1/classes?from=&to=&locationId=&classTypeId=&coachId=&status=
// The schedule between two moments. Defaults to the next seven days.
export const GET = publicHandler({ scope: 'classes:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const from = dateParam(query, 'from') || new Date()
  const to = dateParam(query, 'to') || new Date(from.getTime() + 7 * 86_400_000)
  if (to <= from) throw new ApiError(400, 'to must be after from.', 'invalid_parameter')
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new ApiError(400, `Ask for at most ${MAX_RANGE_DAYS} days of classes at a time.`, 'range_too_large')
  const status = oneOf(query, 'status', ['scheduled', 'cancelled', 'all'] as const) || 'scheduled'
  // Recurring classes are created as the calendar looks ahead; make sure this window has them.
  await ensureSessions(ownerId, to)
  const where: Prisma.ClassSessionWhereInput = {
    ownerId, startsAt: { gte: from, lt: to },
    ...(status !== 'all' && { status }),
    ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    ...(query.get('classTypeId') && { classTypeId: query.get('classTypeId')! }),
    ...(query.get('coachId') && { coachId: query.get('coachId')! }),
  }
  const [rows, total] = await Promise.all([
    prisma.classSession.findMany({ where, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], skip, take, include: { classType: { select: { name: true, category: true } }, coach: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } } }),
    prisma.classSession.count({ where }),
  ])
  const counts = rows.length ? await prisma.booking.groupBy({ by: ['sessionId', 'status'], where: { ownerId, sessionId: { in: rows.map((r) => r.id) }, status: { in: ['booked', 'offered', 'attended', 'waitlisted'] } }, _count: { _all: true } }) : []
  const of = (id: string, statuses: string[]) => counts.filter((c) => c.sessionId === id && statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0)
  return new Page(rows.map((r) => classOut(r, { booked: of(r.id, ['booked', 'offered', 'attended']), waitlisted: of(r.id, ['waitlisted']) })), total, page, pageSize)
})
