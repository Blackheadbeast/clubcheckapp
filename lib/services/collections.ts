// Collecting money for invoices through the gym's payment processor: charging
// saved cards and bank accounts, retrying failures, settling asynchronous
// results reported by webhooks, and refunds.
//
// Rule of the file: the processor is never called inside a database
// transaction. We call it first with an idempotency key, then record the
// outcome. Recording is itself idempotent on the processor's reference, so the
// direct path and the webhook path can both run for the same payment.

import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { getPaymentProvider } from '@/lib/payments/provider'
import { ActorRef, SYSTEM, getGymSettings, lockRow, logActivity, notify } from './core'
import { PaymentMethod as Method, invoiceBalance, recordFailedPayment, recordPayment, refundTransaction, settleRefund } from './payments'
import { flushOutbox } from './automations'
import { billingPayer } from './households'
import { previousResult, requestHash, withIdempotency } from './idempotency'

export type CollectStatus = 'succeeded' | 'processing' | 'failed' | 'no_method' | 'not_connected' | 'skipped'

export interface CollectResult {
  status: CollectStatus
  transactionId?: string
  amountCents?: number
  message?: string
}

const methodFor = (type: string): Method => (type === 'us_bank_account' ? 'ach' : 'card')

export interface SettleInput {
  ownerId: string
  invoiceId: string
  /** The processor's id for the payment (Stripe PaymentIntent). */
  reference: string
  outcome: 'succeeded' | 'processing' | 'failed'
  amountCents: number
  method: Method
  provider: string
  cardLast4?: string | null
  paymentMethodId?: string | null
  /** The household payer whose card or bank account this is, when it is not the invoice's own member. */
  payerMemberId?: string | null
  failureReason?: string
  actor?: ActorRef
}

/**
 * Record what the processor says happened to one payment. Safe to call any
 * number of times, from the request that made the charge and from webhooks:
 * a reference is only ever applied to the invoice once.
 */
export async function settlePayment(input: SettleInput) {
  const transaction = await prisma.$transaction(async (db) => {
    await lockRow(db, 'Invoice', input.invoiceId)
    const invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, ownerId: input.ownerId } })
    if (!invoice) return null
    const existing = await db.transaction.findFirst({
      where: { ownerId: input.ownerId, type: 'payment', provider: input.provider, providerReference: input.reference },
    })
    // A final state is never rewritten (an out-of-order "processing" cannot undo "succeeded").
    if (existing && existing.status !== 'pending') return existing
    if (input.outcome === 'processing') {
      if (existing) return existing
      return db.transaction.create({
        data: {
          ownerId: input.ownerId, memberId: invoice.memberId, invoiceId: invoice.id, type: 'payment', status: 'pending',
          amountCents: input.amountCents, method: input.method, provider: input.provider, providerReference: input.reference,
          cardLast4: input.cardLast4 || null, paymentMethodId: input.paymentMethodId || null, payerMemberId: input.payerMemberId || null, staffName: input.actor?.name || null,
        },
      })
    }
    const paymentMethodId = input.paymentMethodId ?? existing?.paymentMethodId ?? null
    const cardLast4 = input.cardLast4 ?? existing?.cardLast4 ?? null
    // A webhook does not say who the payer was; the pending record made when the charge started does.
    const payerMemberId = input.payerMemberId ?? existing?.payerMemberId ?? null
    if (existing) await db.transaction.delete({ where: { id: existing.id } })

    if (input.outcome === 'failed') {
      if (invoice.status !== 'open' || invoiceBalance(invoice) === 0) {
        // Nothing is owed any more (paid another way while this was in flight): just keep the record.
        return db.transaction.create({
          data: {
            ownerId: input.ownerId, memberId: invoice.memberId, invoiceId: invoice.id, type: 'payment', status: 'failed', amountCents: input.amountCents,
            method: input.method, provider: input.provider, providerReference: input.reference, cardLast4, paymentMethodId, payerMemberId, failureReason: input.failureReason || 'Payment failed',
          },
        })
      }
      return recordFailedPayment(db, {
        ownerId: input.ownerId, invoiceId: invoice.id, method: input.method, failureReason: input.failureReason || 'Payment failed',
        provider: input.provider, providerReference: input.reference, cardLast4, paymentMethodId, payerMemberId, actor: input.actor,
      })
    }

    const balance = invoice.status === 'open' ? invoiceBalance(invoice) : 0
    const applied = Math.min(balance, input.amountCents)
    const surplus = input.amountCents - applied
    let payment = null
    if (applied > 0) {
      payment = await recordPayment(db, {
        ownerId: input.ownerId, invoiceId: invoice.id, amountCents: applied, method: input.method, provider: input.provider,
        providerReference: input.reference, cardLast4, paymentMethodId, payerMemberId, actor: input.actor,
      })
    }
    if (surplus > 0) {
      // The money arrived but the invoice no longer needs it (for example staff took cash
      // while a bank debit was clearing). Keep it for the member as account credit.
      const extra = await db.transaction.create({
        data: {
          ownerId: input.ownerId, memberId: invoice.memberId, invoiceId: payment ? null : invoice.id, type: 'payment', status: 'succeeded', amountCents: surplus,
          method: input.method, provider: input.provider, providerReference: payment ? `${input.reference}:surplus` : input.reference, cardLast4, paymentMethodId, payerMemberId,
          note: `Overpayment on ${invoice.number}, added to account credit`,
        },
      })
      if (invoice.memberId) {
        // The credit belongs to whoever's money it was.
        const { grantCredit } = await import('./account-credit')
        await grantCredit(db, {
          ownerId: input.ownerId, memberId: payerMemberId || invoice.memberId, amountCents: surplus, source: 'overpayment',
          reason: `${invoice.number} was already paid when this payment arrived`, sourceInvoiceId: invoice.id, sourceTransactionId: extra.id, recordTransaction: false,
        })
        await notify(db, {
          ownerId: input.ownerId, type: 'overpayment', title: `Overpayment on ${invoice.number}`,
          body: `${formatMoney(surplus)} was added to the member's account credit. Refund it if they would rather have the money back.`,
          href: `/members/${invoice.memberId}?tab=billing`,
        })
      }
      payment = payment || extra
    }
    return payment
  }, { timeout: 20_000 })
  await flushOutbox(input.ownerId)
  return transaction
}

/**
 * Charge an open invoice to the member's saved card or bank account.
 * Returns a status rather than throwing for ordinary outcomes (declined, no
 * card on file, processor not connected) so batch jobs can keep going.
 */
export async function collectInvoice(input: { ownerId: string; invoiceId: string; paymentMethodId?: string | null; actor?: ActorRef }): Promise<CollectResult> {
  const { ownerId } = input
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, ownerId },
    include: { member: true, transactions: { where: { status: 'pending' }, select: { id: true } } },
  })
  if (!invoice) throw notFound('Invoice')
  const balance = invoiceBalance(invoice)
  if (invoice.status !== 'open' || balance === 0) return { status: 'skipped', message: 'This invoice has nothing left to collect.' }
  if (!invoice.member) return { status: 'skipped', message: 'This invoice is not attached to a member.' }
  if (invoice.transactions.length > 0) return { status: 'processing', message: 'A payment for this invoice is already processing.' }

  const provider = await getPaymentProvider(ownerId)
  if (!provider.canAutoCharge) return { status: 'not_connected', message: 'Connect Stripe in Settings → Payments to charge cards and bank accounts.' }

  // In a household the payer's card or bank account is charged. The invoice stays the member's own.
  const { payerId, viaHousehold } = await billingPayer(prisma, ownerId, invoice.member.id)
  const payer = viaHousehold ? await prisma.member.findFirst({ where: { id: payerId, ownerId }, select: { id: true, name: true, email: true, connectCustomerId: true } }) : invoice.member
  if (!payer) return { status: 'no_method', message: `${invoice.member.name}'s household has no payer.` }
  // A method named in the request must be the payer's (or, outside a household, the member's own). Nobody else's card can be used.
  const method = input.paymentMethodId
    ? await prisma.paymentMethod.findFirst({ where: { id: input.paymentMethodId, ownerId, memberId: payer.id } })
    : await prisma.paymentMethod.findFirst({ where: { ownerId, memberId: payer.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] })
  if (input.paymentMethodId && !method) throw notFound('Payment method')
  if (!method || !payer.connectCustomerId) {
    return { status: 'no_method', message: viaHousehold ? `${payer.name}, who pays for ${invoice.member.name}, has no card or bank account on file.` : `${invoice.member.name} has no card or bank account on file.` }
  }

  const settings = await getGymSettings(ownerId)
  const result = await provider.charge({
    ownerId,
    invoiceId: invoice.id,
    memberId: invoice.member.id,
    amountCents: balance,
    currency: settings.currency,
    description: `${settings.name} ${invoice.number}`,
    customerRef: payer.connectCustomerId,
    paymentMethodRef: method.providerId,
    paymentMethodType: method.type,
    // One key per invoice, attempt and amount, deliberately not per payment method: two people
    // charging the same invoice with different cards at the same moment must not both go through.
    // The processor rejects the second, and a repeat of the first returns the same payment.
    idempotencyKey: `invoice:${invoice.id}:${invoice.attemptCount}:${balance}`,
    receiptEmail: payer.email,
  })
  if (result.status === 'requires_manual') return { status: 'not_connected', message: 'This payment has to be taken by staff.' }

  const base = {
    ownerId, invoiceId: invoice.id, amountCents: balance, method: methodFor(method.type), provider: provider.name,
    cardLast4: method.last4, paymentMethodId: method.id, payerMemberId: viaHousehold ? payer.id : null, actor: input.actor,
  }
  if (result.status === 'failed') {
    if (!result.reference) {
      // The processor refused before creating a payment, so there is no reference to key on.
      const failed = await prisma.$transaction((db) => recordFailedPayment(db, { ...base, failureReason: result.failureReason }), { timeout: 20_000 })
      await flushOutbox(ownerId)
      return { status: 'failed', transactionId: failed.id, amountCents: balance, message: result.failureReason }
    }
    const failed = await settlePayment({ ...base, reference: result.reference, outcome: 'failed', failureReason: result.failureReason })
    return { status: 'failed', transactionId: failed?.id, amountCents: balance, message: result.failureReason }
  }
  const settled = await settlePayment({ ...base, reference: result.reference, outcome: result.status })
  return {
    status: result.status,
    transactionId: settled?.id,
    amountCents: balance,
    message: result.status === 'processing' ? 'The bank payment has started and usually clears in a few business days.' : undefined,
  }
}

export interface CollectionRunSummary {
  attempted: number
  collected: number
  processing: number
  failed: number
  errors: string[]
}

/**
 * The automatic part of billing for one account: charge renewal invoices that
 * have come due and retry failed payments whose next attempt is due.
 * recordFailedPayment schedules the retries (day 3, 5 and 7 after the first
 * failure) and gives up after the fourth attempt, leaving the invoice for staff.
 */
export async function runCollections(ownerId: string, now = new Date()): Promise<CollectionRunSummary> {
  const summary: CollectionRunSummary = { attempted: 0, collected: 0, processing: 0, failed: 0, errors: [] }
  const provider = await getPaymentProvider(ownerId)
  if (!provider.canAutoCharge) return summary
  const due = await prisma.invoice.findMany({
    where: {
      ownerId,
      status: 'open',
      memberId: { not: null },
      dueDate: { lte: now },
      transactions: { none: { status: 'pending' } },
      // Whether there is a card to charge is decided per invoice: it may be the household payer's.
      OR: [
        { nextAttemptAt: { lte: now } },
        // First attempt: memberships set to pay by card or bank debit.
        { attemptCount: 0, membership: { paymentMethod: { in: ['card', 'ach'] }, status: { in: ['active', 'trial', 'past_due'] } } },
      ],
    },
    select: { id: true },
    orderBy: { dueDate: 'asc' },
    take: 500,
  })
  for (const { id } of due) {
    try {
      const result = await collectInvoice({ ownerId, invoiceId: id })
      if (result.status === 'skipped' || result.status === 'no_method' || result.status === 'not_connected') continue
      summary.attempted++
      if (result.status === 'succeeded') summary.collected++
      else if (result.status === 'processing') summary.processing++
      else summary.failed++
    } catch (error) {
      summary.errors.push(`invoice ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return summary
}

export interface RefundInput {
  ownerId: string
  transactionId: string
  amountCents?: number
  /** Free-text note. */
  reason?: string | null
  /** One of REFUND_REASONS. */
  refundReason?: string | null
  /** "original" sends the money back the way it came. "credit" keeps it on the member's account. */
  destination?: 'original' | 'credit'
  /** Sent by the caller with each attempt: repeating a key returns the first refund instead of making another. */
  idempotencyKey?: string | null
  actor?: ActorRef
}

export interface RefundOutcome {
  refundId: string
  amountCents: number
  status: string
  destination: 'original' | 'credit'
  originalCents: number
  previouslyRefundedCents: number
  totalRefundedCents: number
  remainingRefundableCents: number
  fullyRefunded: boolean
  creditId: string | null
  replayed?: boolean
}

/**
 * Refund all or part of a payment. Card and bank payments are returned through the processor; desk
 * payments are only recorded. The total refunded can never pass what was captured: the payment row
 * is locked while it is checked, and the processor refuses anything beyond what it holds.
 */
export async function refundPayment(input: RefundInput): Promise<RefundOutcome> {
  const original = await prisma.transaction.findFirst({ where: { id: input.transactionId, ownerId: input.ownerId } })
  if (!original) throw notFound('Transaction')
  const destination = input.destination || 'original'
  const hash = requestHash({ t: input.transactionId, a: input.amountCents ?? null, d: destination })
  const earlier = await previousResult<RefundOutcome>(prisma, input.ownerId, 'refund', input.idempotencyKey, hash)
  if (earlier) return { ...earlier, replayed: true }
  if (original.type !== 'payment' || original.status !== 'succeeded') throw badRequest('Only successful payments can be refunded.', 'not_refundable')
  const refundable = original.amountCents - original.refundedCents
  const amount = input.amountCents ?? refundable
  if (refundable <= 0) throw badRequest('This payment has already been fully refunded.', 'already_refunded')
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Refund amount must be greater than zero.')
  if (amount > refundable) throw badRequest(`You can refund at most ${formatMoney(refundable)} of this payment.`, 'refund_too_large')

  let providerReference: string | null = null
  let status: 'succeeded' | 'pending' = 'succeeded'
  if (destination === 'original' && original.provider !== 'manual' && original.providerReference) {
    const provider = await getPaymentProvider(input.ownerId)
    if (provider.name !== original.provider) {
      throw new ApiError(409, 'This payment was taken through Stripe, which is not connected right now. Reconnect it or refund from your Stripe dashboard.', 'payments_not_connected')
    }
    const result = await provider.refund({
      reference: original.providerReference.replace(/:surplus$/, ''),
      amountCents: amount,
      // With a caller's key, a repeat is the same refund at the processor too. Without one, the key
      // describes the refund itself, so the same amount cannot be sent twice from the same starting point.
      idempotencyKey: input.idempotencyKey ? `refund:${original.id}:${input.idempotencyKey}` : `refund:${original.id}:${original.refundedCents}:${amount}`,
    })
    if (result.status === 'failed' || !result.reference) throw new ApiError(502, result.failureReason || 'The refund could not be processed.', 'refund_failed')
    providerReference = result.reference
    status = result.status === 'pending' ? 'pending' : 'succeeded'
  }
  return prisma.$transaction(async (db) => {
    await lockRow(db, 'Transaction', original.id)
    const { result, replayed } = await withIdempotency(db, { ownerId: input.ownerId, scope: 'refund', key: input.idempotencyKey, hash }, async () => {
      const before = await db.transaction.findUniqueOrThrow({ where: { id: original.id }, select: { amountCents: true, refundedCents: true } })
      const done = await refundTransaction(db, {
        ownerId: input.ownerId, transactionId: original.id, amountCents: amount, reason: input.reason, refundReason: input.refundReason,
        providerReference, status, toCredit: destination === 'credit', actor: input.actor || SYSTEM,
      })
      // The processor handed back a refund we already hold (a repeat without a key): report it as it stands.
      const total = done.duplicate ? before.refundedCents : before.refundedCents + done.refund.amountCents
      return {
        refundId: done.refund.id, amountCents: done.refund.amountCents, status: done.refund.status, destination,
        originalCents: before.amountCents, previouslyRefundedCents: total - done.refund.amountCents, totalRefundedCents: total,
        remainingRefundableCents: before.amountCents - total, fullyRefunded: total >= before.amountCents, creditId: done.credit?.id || null,
      }
    })
    return { ...result, replayed }
  }, { timeout: 20_000 })
}

/** A refund made outside ClubCheck (in the Stripe dashboard) reported by webhook. */
export async function recordExternalRefund(input: { ownerId: string; paymentReference: string; refundReference: string; amountCents: number; reason?: string | null; status?: 'succeeded' | 'pending' }) {
  const original = await prisma.transaction.findFirst({
    where: { ownerId: input.ownerId, type: 'payment', status: 'succeeded', provider: 'stripe', providerReference: input.paymentReference },
  })
  if (!original) return null
  return prisma.$transaction(async (db) => {
    await lockRow(db, 'Transaction', original.id)
    const fresh = await db.transaction.findUniqueOrThrow({ where: { id: original.id } })
    const refundable = fresh.amountCents - fresh.refundedCents
    const already = await db.transaction.findFirst({ where: { ownerId: input.ownerId, type: 'refund', parentTransactionId: original.id, providerReference: input.refundReference } })
    if (already) {
      // We made this refund; the webhook is telling us how it turned out.
      if (already.status === 'pending' && input.status === 'succeeded') return settleRefund(db, { ownerId: input.ownerId, refundId: already.id, outcome: 'succeeded' })
      return already
    }
    if (refundable <= 0) return already
    const { refund } = await refundTransaction(db, {
      ownerId: input.ownerId, transactionId: original.id, amountCents: Math.min(input.amountCents, refundable),
      reason: input.reason || 'Refunded in Stripe', providerReference: input.refundReference, status: input.status === 'pending' ? 'pending' : 'succeeded',
    })
    return refund
  }, { timeout: 20_000 })
}

/** A cardholder disputed a payment with their bank. Staff need to respond in Stripe. */
export async function recordDispute(input: { ownerId: string; paymentReference: string; disputeReference: string; status: string; reason?: string | null; amountCents: number }) {
  const original = await prisma.transaction.findFirst({
    where: { ownerId: input.ownerId, type: 'payment', provider: 'stripe', providerReference: input.paymentReference },
  })
  if (!original) return null
  const status = input.status === 'won' || input.status === 'lost' ? input.status : input.status === 'under_review' ? 'under_review' : 'needs_response'
  if (original.disputeStatus === status) return original
  const first = !original.disputeStatus
  const updated = await prisma.$transaction(async (db) => {
    const row = await db.transaction.update({
      where: { id: original.id },
      data: { disputeStatus: status, disputeReason: input.reason || original.disputeReason, disputedAt: original.disputedAt || new Date() },
    })
    if (first || status === 'won' || status === 'lost') {
      const title = status === 'won' ? 'Payment dispute won' : status === 'lost' ? 'Payment dispute lost' : `Payment of ${formatMoney(original.amountCents)} disputed`
      if (original.memberId) {
        await logActivity(db, {
          ownerId: input.ownerId, memberId: original.memberId, type: 'dispute', title,
          detail: input.reason ? input.reason.replace(/_/g, ' ') : undefined, metadata: { transactionId: original.id, disputeId: input.disputeReference },
        })
      }
      await notify(db, {
        ownerId: input.ownerId, type: 'dispute', title,
        body: status === 'lost' ? 'The bank returned the money to the cardholder.' : status === 'won' ? 'The payment stands.' : 'Respond with evidence in your Stripe dashboard before the deadline.',
        href: original.memberId ? `/members/${original.memberId}?tab=billing` : '/billing',
      })
    }
    return row
  })
  // A lost dispute is money gone: show it as a refund so revenue reports stay honest.
  if (status === 'lost') {
    await recordExternalRefund({
      ownerId: input.ownerId, paymentReference: input.paymentReference, refundReference: input.disputeReference,
      amountCents: input.amountCents, reason: 'Dispute lost',
    })
  }
  return updated
}

/** The processor says a refund failed or was cancelled after we recorded it: put the money back on the payment. */
export async function recordRefundFailure(input: { ownerId: string; refundReference: string; failureReason?: string | null }) {
  const refund = await prisma.transaction.findFirst({ where: { ownerId: input.ownerId, type: 'refund', provider: 'stripe', providerReference: input.refundReference }, select: { id: true } })
  if (!refund) return null
  return prisma.$transaction((db) => settleRefund(db, { ownerId: input.ownerId, refundId: refund.id, outcome: 'failed', failureReason: input.failureReason }), { timeout: 20_000 })
}
