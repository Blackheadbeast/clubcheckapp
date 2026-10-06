import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { bookClass } from '@/lib/services/bookings'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

// GET /api/bookings?status=&when=upcoming|past&search=&classTypeId=
export const GET = handler({ permission: 'classes.view' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = paging(query)
  const status = query.get('status')
  const when = query.get('when') || 'upcoming'
  const search = (query.get('search') || '').trim()
  const now = new Date()
  const where: Prisma.BookingWhereInput = {
    ownerId,
    ...(status === 'waitlisted' ? { status: { in: ['waitlisted', 'offered'] } } : status ? { status } : {}),
    session: {
      ...(when === 'upcoming' ? { endsAt: { gte: now } } : when === 'past' ? { endsAt: { lt: now } } : {}),
      ...(query.get('classTypeId') && { classTypeId: query.get('classTypeId')! }),
      ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    },
    ...(search && { member: { name: { contains: search, mode: 'insensitive' } } }),
  }
  const [bookings, total, counts] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: [{ session: { startsAt: when === 'past' ? 'desc' : 'asc' } }, { waitlistedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      skip,
      take,
      select: {
        id: true, status: true, source: true, creditUsed: true, createdAt: true, waitlistedAt: true, offerExpiresAt: true,
        member: { select: { id: true, name: true, photoUrl: true } },
        session: { select: { id: true, title: true, startsAt: true, capacity: true, classType: { select: { name: true, color: true } }, coach: { select: { name: true } } } },
      },
    }),
    prisma.booking.count({ where }),
    prisma.booking.groupBy({ by: ['status'], where: { ownerId, session: { endsAt: { gte: now } } }, _count: { _all: true } }),
  ])
  const upcoming: Record<string, number> = {}
  for (const c of counts) upcoming[c.status] = c._count._all
  return new Paginated(bookings, total, page, pageSize, { upcoming })
})

const bookSchema = z.object({
  memberId: z.string().uuid(),
  sessionId: z.string().uuid(),
  /** false = fail with class_full instead of joining the waitlist */
  joinWaitlist: z.boolean().optional(),
})

// POST /api/bookings - staff books a member into a class
export const POST = handler({ permission: 'bookings.manage', write: true, body: bookSchema }, async ({ ownerId, body, actor }) => {
  const result = await prisma.$transaction((db) => bookClass(db, { ownerId, ...body, source: 'staff', actor }), { timeout: 15_000 })
  await flushOutbox(ownerId)
  return { id: result.booking.id, status: result.booking.status, waitlistPosition: result.waitlistPosition, usedCredit: result.usedCredit }
})
