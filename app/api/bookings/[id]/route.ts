import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { cancelBooking, claimOffer, markAttendance } from '@/lib/services/bookings'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), waive: z.boolean().optional() }),
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('attendance'), status: z.enum(['attended', 'no_show', 'booked']) }),
])

// POST /api/bookings/:id - cancel, claim a waitlist offer, or mark attendance
export const POST = handler({ permission: ['bookings.manage', 'attendance.manage'], write: true, body: actionSchema }, async ({ ownerId, params, body, actor }) => {
  const bookingId = params.id
  const result = await prisma.$transaction(async (db) => {
    if (body.action === 'cancel') {
      const r = await cancelBooking(db, { ownerId, bookingId, by: 'staff', waive: body.waive, actor })
      return { status: r.booking.status, late: r.late, creditReturned: r.creditReturned, promoted: r.promoted }
    }
    if (body.action === 'claim') {
      const r = await claimOffer(db, { ownerId, bookingId, actor })
      return { status: r.booking.status }
    }
    const r = await markAttendance(db, { ownerId, bookingId, status: body.status, actor })
    return { status: r.booking.status }
  }, { timeout: 15_000 })
  await flushOutbox(ownerId)
  return result
})
