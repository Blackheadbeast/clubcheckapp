import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Created, Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { bookingOut } from '@/lib/public-api/serialize'
import { bookClass } from '@/lib/services/bookings'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const STATUSES = ['booked', 'waitlisted', 'offered', 'attended', 'no_show', 'cancelled', 'late_cancelled'] as const

// GET /api/v1/bookings?memberId=&classId=&status=&from=&to=&updatedSince=   (from/to are the class's start time)
export const GET = publicHandler({ scope: 'bookings:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const from = dateParam(query, 'from')
  const to = dateParam(query, 'to')
  const updatedSince = dateParam(query, 'updatedSince')
  const status = oneOf(query, 'status', STATUSES)
  const where: Prisma.BookingWhereInput = {
    ownerId,
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('classId') && { sessionId: query.get('classId')! }),
    ...(status && { status }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
    ...((from || to) && { session: { startsAt: { ...(from && { gte: from }), ...(to && { lt: to }) } } }),
  }
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({ where, orderBy: updatedSince ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
    prisma.booking.count({ where }),
  ])
  return new Page(rows.map(bookingOut), total, page, pageSize)
})

const schema = z.object({
  classId: z.string().uuid(),
  memberId: z.string().uuid(),
  /** If the class is full, join the waitlist instead of being refused. */
  joinWaitlist: z.boolean().optional(),
})

// POST /api/v1/bookings - book a member into a class. Capacity, membership eligibility, credits and
// clashes with the member's other bookings are enforced exactly as they are at the front desk.
export const POST = publicHandler({ scope: 'bookings:write', write: true, body: schema, idempotent: true }, async ({ ownerId, body, actor }) => {
  const result = await prisma.$transaction((db) => bookClass(db, { ownerId, memberId: body.memberId, sessionId: body.classId, joinWaitlist: body.joinWaitlist === true, source: 'staff', actor }), { timeout: 15_000 })
  await flushOutbox(ownerId)
  return new Created({ ...bookingOut(result.booking), waitlistPosition: result.waitlistPosition, usedCredit: result.usedCredit })
})
