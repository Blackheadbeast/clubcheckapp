import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { refundPayment } from '@/lib/services/collections'
import { REFUND_REASONS, REFUND_REASON_LABELS } from '@/lib/services/payments'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

// GET /api/billing/transactions/:id/refund - what can still be refunded on a payment, and what already has been
export const GET = handler({ permission: ['billing.view', 'billing.refund'] }, async ({ ownerId, params, can }) => {
  const payment = await prisma.transaction.findFirst({
    where: { id: params.id, ownerId, type: 'payment' },
    select: {
      id: true, status: true, amountCents: true, refundedCents: true, method: true, provider: true, cardLast4: true, createdAt: true,
      member: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true, orderId: true } },
      refunds: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, amountCents: true, method: true, note: true, refundReason: true, failureReason: true, staffName: true, createdAt: true } },
    },
  })
  if (!payment) throw notFound('Payment')
  return {
    id: payment.id, status: payment.status, method: payment.method, cardLast4: payment.cardLast4, at: payment.createdAt, member: payment.member, invoice: payment.invoice,
    originalCents: payment.amountCents, refundedCents: payment.refundedCents, refundableCents: payment.status === 'succeeded' ? payment.amountCents - payment.refundedCents : 0,
    // Returned through the processor (card, bank debit) or only recorded (cash, check, terminal).
    throughProcessor: payment.provider !== 'manual', canRefund: can('billing.refund'), canKeepAsCredit: !!payment.member,
    reasons: REFUND_REASONS.map((key) => ({ key, label: REFUND_REASON_LABELS[key] })),
    refunds: payment.refunds.map((r) => ({ id: r.id, status: r.status, amountCents: r.amountCents, toCredit: r.method === 'account_credit' && payment.method !== 'account_credit', reason: r.refundReason, reasonLabel: r.refundReason ? REFUND_REASON_LABELS[r.refundReason] : null, note: r.note, failureReason: r.failureReason, by: r.staffName, at: r.createdAt })),
  }
})

const refundSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000).optional(),
  /** Why (one of the listed reasons). */
  refundReason: z.enum(REFUND_REASONS).optional(),
  /** Optional note. `reason` is the older name for the same field. */
  note: z.string().trim().max(300).nullish(),
  reason: z.string().trim().max(300).nullish(),
  destination: z.enum(['original', 'credit']).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
})

// POST /api/billing/transactions/:id/refund - full or partial refund
export const POST = handler({ permission: 'billing.refund', write: true, body: refundSchema, rateLimit: { key: 'refund', windowMs: 60_000, maxRequests: 30 } }, async ({ ownerId, params, body, actor, audit }) => {
  const note = body.note ?? body.reason ?? null
  // Card and bank payments are returned through Stripe; desk payments are only recorded.
  const result = await refundPayment({ ownerId, transactionId: params.id, amountCents: body.amountCents, reason: note, refundReason: body.refundReason, destination: body.destination, idempotencyKey: body.idempotencyKey, actor })
  if (!result.replayed) {
    const refund = await prisma.transaction.findUnique({ where: { id: result.refundId }, select: { memberId: true, invoiceId: true } })
    await audit('payment.refund', `Refunded ${formatMoney(result.amountCents)}${result.destination === 'credit' ? ' to account credit' : ''}${body.refundReason ? ` (${REFUND_REASON_LABELS[body.refundReason]})` : ''}${note ? `: ${note}` : ''}`, {
      entityType: 'transaction', entityId: params.id,
      before: { refundedCents: result.previouslyRefundedCents, refundableCents: result.originalCents - result.previouslyRefundedCents },
      after: { refundedCents: result.totalRefundedCents, refundableCents: result.remainingRefundableCents },
      metadata: { refundTransactionId: result.refundId, memberId: refund?.memberId, invoiceId: refund?.invoiceId, amountCents: result.amountCents, destination: result.destination, reason: body.refundReason, note, status: result.status, creditId: result.creditId, idempotencyKey: body.idempotencyKey, fullyRefunded: result.fullyRefunded },
    })
  }
  return result
})
