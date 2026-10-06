import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const mine = (ownerId: string, actor: { type: string; id: string }) => ({
  ownerId,
  OR: [{ staffId: null }, ...(actor.type === 'staff' ? [{ staffId: actor.id }] : [])],
})

export const GET = handler({ permission: null }, async ({ ownerId, actor }) => {
  return prisma.notification.findMany({ where: mine(ownerId, actor), orderBy: { createdAt: 'desc' }, take: 30 })
})

// Mark one notification, or all of them, as read.
export const POST = handler({ permission: null, body: z.object({ id: z.string().uuid().optional() }) }, async ({ ownerId, actor, body }) => {
  const result = await prisma.notification.updateMany({
    where: { ...mine(ownerId, actor), readAt: null, ...(body.id && { id: body.id }) },
    data: { readAt: new Date() },
  })
  return { marked: result.count }
})
