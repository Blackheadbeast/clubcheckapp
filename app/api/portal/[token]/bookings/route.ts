import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { bookClass, classDocumentsGate } from '@/lib/services/bookings'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

// POST - the member books a class (or joins its waitlist)
export const POST = portalHandler({ write: true, body: z.object({ sessionId: z.string().uuid(), joinWaitlist: z.boolean().optional() }) }, async ({ member, ownerId, body, actor }) => {
  await classDocumentsGate(ownerId, member.id, body.sessionId)
  const result = await prisma.$transaction((db) => bookClass(db, { ownerId, memberId: member.id, sessionId: body.sessionId, joinWaitlist: body.joinWaitlist ?? false, source: 'member', actor }), { timeout: 15_000 })
  await flushOutbox(ownerId)
  return { id: result.booking.id, status: result.booking.status, waitlistPosition: result.waitlistPosition, usedCredit: result.usedCredit }
})
