import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { cancelBooking, claimOffer } from '@/lib/services/bookings'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

// POST { action: "cancel" | "claim" } - only ever on the member's own booking
export const POST = portalHandler({ write: true, body: z.object({ action: z.enum(['cancel', 'claim']) }) }, async ({ member, ownerId, body, params, actor }) => {
  const owned = await prisma.booking.findFirst({ where: { id: params.id, memberId: member.id, ownerId }, select: { id: true } })
  if (!owned) throw notFound('Booking')
  const result = await prisma.$transaction(async (db) => {
    if (body.action === 'claim') {
      const r = await claimOffer(db, { ownerId, bookingId: owned.id, actor })
      return { status: r.booking.status, late: false, creditReturned: false }
    }
    const r = await cancelBooking(db, { ownerId, bookingId: owned.id, by: 'member', actor })
    return { status: r.booking.status, late: r.late, creditReturned: r.creditReturned }
  }, { timeout: 15_000 })
  await flushOutbox(ownerId)
  return result
})
