import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { refundTransaction } from '@/lib/services/payments'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

const refundSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000).optional(),
  reason: z.string().trim().max(300).nullish(),
})

// POST /api/billing/transactions/:id/refund - full or partial refund
export const POST = handler({ permission: 'billing.refund', write: true, body: refundSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const { refund, fullyRefunded } = await prisma.$transaction((db) => refundTransaction(db, { ownerId, transactionId: params.id, ...body, actor }))
  await audit('payment.refund', `Refunded ${formatMoney(refund.amountCents)}${body.reason ? `: ${body.reason}` : ''}`, {
    entityType: 'transaction', entityId: params.id, metadata: { refundTransactionId: refund.id, memberId: refund.memberId, fullyRefunded },
  })
  return { refundId: refund.id, amountCents: refund.amountCents, fullyRefunded }
})
