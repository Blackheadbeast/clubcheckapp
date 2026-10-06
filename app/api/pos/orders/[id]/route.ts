import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { refundOrder } from '@/lib/services/pos'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: ['pos.sell', 'pos.manage'] }, async ({ ownerId, params }) => {
  const order = await prisma.order.findFirst({
    where: { id: params.id, ownerId },
    include: { items: true, member: { select: { id: true, name: true } }, location: { select: { name: true } }, invoice: { select: { id: true, number: true, refundedCents: true } } },
  })
  if (!order) throw notFound('Order')
  return order
})

// POST { action: "refund", restock, reason }
export const POST = handler(
  { permission: 'billing.refund', write: true, body: z.object({ action: z.literal('refund'), restock: z.boolean().default(true), reason: z.string().trim().max(300).nullish() }) },
  async ({ ownerId, params, body, actor, audit }) => {
    const result = await prisma.$transaction((db) => refundOrder(db, { ownerId, orderId: params.id, restock: body.restock, reason: body.reason, actor }), { timeout: 20_000 })
    await audit('order.refund', `Refunded ${result.order.number} (${formatMoney(result.refundedCents)})${body.restock ? ', items returned to stock' : ''}`, { entityType: 'order', entityId: params.id })
    return { status: result.order.status, refundedCents: result.refundedCents }
  }
)
