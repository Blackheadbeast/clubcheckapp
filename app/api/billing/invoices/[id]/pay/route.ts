import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { recordFailedPayment, recordPayment } from '@/lib/services/payments'
import { flushOutbox } from '@/lib/services/automations'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

const paySchema = z.object({
  method: z.enum(['card', 'cash', 'check', 'ach', 'account_credit', 'other']),
  amountCents: z.number().int().min(1).max(100_000_000).optional(),
  note: z.string().trim().max(300).nullish(),
  locationId: z.string().uuid().nullish(),
  /** Record a declined attempt instead of a payment. */
  failed: z.boolean().optional(),
  failureReason: z.string().trim().max(200).optional(),
})

// POST /api/billing/invoices/:id/pay - record a payment (or a failed attempt)
export const POST = handler({ permission: 'billing.manage', write: true, body: paySchema }, async ({ ownerId, params, body, actor, audit }) => {
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const transaction = await prisma.$transaction(
    (db) =>
      body.failed
        ? recordFailedPayment(db, { ownerId, invoiceId: params.id, method: body.method, failureReason: body.failureReason || 'Payment declined', actor })
        : recordPayment(db, { ownerId, invoiceId: params.id, method: body.method, amountCents: body.amountCents, note: body.note, locationId: body.locationId, actor }),
    { timeout: 15_000 }
  )
  await audit(
    body.failed ? 'payment.failed' : 'payment.record',
    body.failed ? `Recorded failed payment of ${formatMoney(transaction.amountCents)}` : `Recorded ${body.method.replace('_', ' ')} payment of ${formatMoney(transaction.amountCents)}`,
    { entityType: 'transaction', entityId: transaction.id, metadata: { invoiceId: params.id, memberId: transaction.memberId } }
  )
  await flushOutbox(ownerId)
  return { transactionId: transaction.id, status: transaction.status, amountCents: transaction.amountCents }
})
