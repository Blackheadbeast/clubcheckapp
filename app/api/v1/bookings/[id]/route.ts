import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { bookingOut } from '@/lib/public-api/serialize'
import { cancelBooking } from '@/lib/services/bookings'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'bookings:read' }, async ({ ownerId, params }) => {
  const booking = await prisma.booking.findFirst({ where: { id: params.id, ownerId } })
  if (!booking) throw notFound('Booking')
  return bookingOut(booking)
})

// DELETE /api/v1/bookings/:id - cancel. The gym's late-cancellation rule applies; it cannot be waived from here.
export const DELETE = publicHandler({ scope: 'bookings:write', write: true }, async ({ ownerId, params, actor }) => {
  const result = await prisma.$transaction((db) => cancelBooking(db, { ownerId, bookingId: params.id, by: 'staff', actor }), { timeout: 15_000 })
  await flushOutbox(ownerId)
  return { ...bookingOut(result.booking), late: result.late, creditReturned: result.creditReturned }
})
