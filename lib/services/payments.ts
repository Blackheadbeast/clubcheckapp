// Member-facing billing: invoices, payments, refunds, credits and coupons.
// (lib/billing.ts is unrelated: it is the gym's own ClubCheck subscription.)

import { invoiceEvent, membershipEvent, paymentEvent } from './events'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { Db, ActorRef, SYSTEM, lockRow, logActivity, nextNumber, notify } from './core'

export const PAYMENT_METHODS = ['card', 'cash', 'check', 'ach', 'account_credit', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export interface LineItem {
  description: string
  type?: string
  quantity?: number
  unitPriceCents: number
  planId?: string | null
  productId?: string | null
  /** Tax in basis points for this line (875 = 8.75%). */
  taxRateBps?: number
}

export interface CouponResult {
  code: string
  discountCents: number
}

/** Validate a coupon and compute its discount. Does not redeem it. */
export async function quoteCoupon(
  db: Db,
  ownerId: string,
  code: string | null | undefined,
  scope: 'memberships' | 'products',
  subtotalCents: number
): Promise<CouponResult | null> {
  if (!code) return null
  const coupon = await db.coupon.findUnique({ where: { ownerId_code: { ownerId, code: code.trim().toUpperCase() } } })
  if (!coupon || !coupon.isActive) throw badRequest('That coupon code is not valid.', 'coupon_invalid')
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw badRequest('That coupon has expired.', 'coupon_expired')
  if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
    throw badRequest('That coupon has been fully redeemed.', 'coupon_exhausted')
  }
  if (coupon.appliesTo !== 'all' && coupon.appliesTo !== scope) {
    throw badRequest(`That coupon only applies to ${coupon.appliesTo}.`, 'coupon_scope')
  }
  const discount = coupon.percentOff
    ? Math.round((subtotalCents * coupon.percentOff) / 100)
    : coupon.amountOffCents || 0
  return { code: coupon.code, discountCents: Math.min(subtotalCents, Math.max(0, discount)) }
}

export interface Totals {
  subtotalCents: number
  discountCents: number
  taxCents: number
  totalCents: number
}

/** Discounts apply before tax and are spread across lines in proportion to their amount. */
export function computeTotals(items: LineItem[], discountCents = 0): Totals {
  const lines = items.map((i) => ({ amount: (i.quantity ?? 1) * i.unitPriceCents, rate: i.taxRateBps || 0 }))
  const subtotalCents = lines.reduce((sum, l) => sum + l.amount, 0)
  const discount = Math.min(Math.max(0, discountCents), Math.max(0, subtotalCents))
  let taxCents = 0
  for (const line of lines) {
    const share = subtotalCents > 0 ? (line.amount / subtotalCents) * discount : 0
    taxCents += ((line.amount - share) * line.rate) / 10_000
  }
  taxCents = Math.round(taxCents)
  return { subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents }
}

export interface CreateInvoiceInput {
  ownerId: string
  memberId?: string | null
  membershipId?: string | null
  orderId?: string | null
  items: LineItem[]
  discountCents?: number
  couponCode?: string | null
  dueDate?: Date | null
  periodStart?: Date | null
  periodEnd?: Date | null
  notes?: string | null
  status?: 'draft' | 'open'
  actor?: ActorRef
}

export async function createInvoice(db: Db, input: CreateInvoiceInput) {
  if (input.items.length === 0) throw badRequest('An invoice needs at least one line item.')
  const totals = computeTotals(input.items, input.discountCents)
  const number = await nextNumber(db, input.ownerId, 'invoice')
  const zero = totals.totalCents === 0
  const invoice = await db.invoice.create({
    data: {
      ownerId: input.ownerId,
      memberId: input.memberId || null,
      membershipId: input.membershipId || null,
      orderId: input.orderId || null,
      number,
      // Nothing to collect on a $0 invoice
      status: zero && input.status !== 'draft' ? 'paid' : input.status || 'open',
      paidAt: zero && input.status !== 'draft' ? new Date() : null,
      ...totals,
      couponCode: input.couponCode || null,
      dueDate: input.dueDate ?? new Date(),
      periodStart: input.periodStart || null,
      periodEnd: input.periodEnd || null,
      notes: input.notes || null,
      items: {
        create: input.items.map((i) => ({
          description: i.description,
          type: i.type || 'other',
          quantity: i.quantity ?? 1,
          unitPriceCents: i.unitPriceCents,
          amountCents: (i.quantity ?? 1) * i.unitPriceCents,
          planId: i.planId || null,
          productId: i.productId || null,
        })),
      },
    },
  })
  if (input.couponCode) {
    await db.coupon.updateMany({
      where: { ownerId: input.ownerId, code: input.couponCode },
      data: { timesRedeemed: { increment: 1 } },
    })
  }
  if (invoice.status !== 'draft') {
    await invoiceEvent(db, input.ownerId, 'invoice.created', invoice.id)
    if (invoice.status === 'paid') await invoiceEvent(db, input.ownerId, 'invoice.paid', invoice.id)
  }
  return invoice
}

export function invoiceBalance(invoice: { totalCents: number; amountPaidCents: number }) {
  return Math.max(0, invoice.totalCents - invoice.amountPaidCents)
}

export interface PaymentInput {
  ownerId: string
  invoiceId: string
  amountCents?: number
  method: PaymentMethod
  note?: string | null
  locationId?: string | null
  provider?: string
  providerReference?: string | null
  cardLast4?: string | null
  /** Saved payment method (PaymentMethod.id) that was charged, if any. */
  paymentMethodId?: string | null
  /** Whose money it was, when it was not the invoice's own member (a household payer). */
  payerMemberId?: string | null
  /** Account credit only: whose credit to spend. The invoice's member by default; their household payer is the only other choice. */
  creditMemberId?: string | null
  /** Account credit only: spend only credit marked for automatic use. */
  creditAutoOnly?: boolean
  actor?: ActorRef
  at?: Date
}

/** Record a successful payment against an invoice (partial payments allowed). */
export async function recordPayment(db: Db, input: PaymentInput) {
  await lockRow(db, 'Invoice', input.invoiceId)
  const invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, ownerId: input.ownerId } })
  if (!invoice) throw notFound('Invoice')
  if (invoice.status === 'void') throw badRequest('This invoice has been voided.', 'invoice_void')
  if (invoice.status === 'draft') throw badRequest('Finalize this draft invoice before taking payment.', 'invoice_draft')
  const balance = invoiceBalance(invoice)
  if (balance === 0) throw badRequest('This invoice is already paid.', 'invoice_paid')
  const amount = input.amountCents ?? balance
  if (amount <= 0) throw badRequest('Payment amount must be greater than zero.')
  if (amount > balance) throw badRequest(`Payment exceeds the balance due (${formatMoney(balance)}).`, 'overpayment')
  const actor = input.actor || SYSTEM
  const at = input.at || new Date()

  let creditFrom: string | null = null
  if (input.method === 'account_credit') {
    if (!invoice.memberId) throw badRequest('Account credit needs a member on the invoice.')
    creditFrom = input.creditMemberId || invoice.memberId
    if (creditFrom !== invoice.memberId) {
      // Someone else's credit may only pay this invoice if they are the member's household payer.
      const { billingPayer } = await import('./households')
      const payer = await billingPayer(db, input.ownerId, invoice.memberId)
      if (payer.payerId !== creditFrom) throw badRequest('That credit belongs to someone who does not pay for this member.', 'not_payer')
    }
    const { creditAvailable } = await import('./account-credit')
    const { totalCents } = await creditAvailable(db, input.ownerId, creditFrom)
    if (totalCents < amount) throw badRequest(`Only ${formatMoney(totalCents)} of account credit is available.`, 'insufficient_credit')
  }
  const payerMemberId = (creditFrom && creditFrom !== invoice.memberId ? creditFrom : input.payerMemberId) || null

  const transaction = await db.transaction.create({
    data: {
      ownerId: input.ownerId,
      memberId: invoice.memberId,
      invoiceId: invoice.id,
      locationId: input.locationId || null,
      type: 'payment',
      status: 'succeeded',
      amountCents: amount,
      method: input.method,
      provider: input.provider || 'manual',
      providerReference: input.providerReference || null,
      cardLast4: input.cardLast4 || null,
      paymentMethodId: input.paymentMethodId || null,
      payerMemberId: payerMemberId && payerMemberId !== invoice.memberId ? payerMemberId : null,
      note: input.note || null,
      staffId: actor.type === 'staff' || actor.type === 'owner' ? actor.id : null,
      staffName: actor.name || null,
      createdAt: at,
    },
  })
  if (creditFrom) {
    const { drawCredit } = await import('./account-credit')
    await drawCredit(db, { ownerId: input.ownerId, memberId: creditFrom, amountCents: amount, kind: 'applied', invoiceId: invoice.id, transactionId: transaction.id, note: input.note, autoOnly: input.creditAutoOnly, actor })
  }

  const paid = invoice.amountPaidCents + amount
  const fullyPaid = paid >= invoice.totalCents
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaidCents: paid,
      status: fullyPaid ? 'paid' : 'open',
      paidAt: fullyPaid ? at : null,
      nextAttemptAt: fullyPaid ? null : invoice.nextAttemptAt,
    },
  })
  await paymentEvent(db, input.ownerId, 'payment.succeeded', transaction.id)
  if (fullyPaid) await invoiceEvent(db, input.ownerId, 'invoice.paid', invoice.id)

  if (invoice.memberId) {
    await db.member.update({ where: { id: invoice.memberId }, data: { lastPaidAt: at } })
    await logActivity(db, {
      ownerId: input.ownerId,
      memberId: invoice.memberId,
      type: 'payment',
      title: `Payment of ${formatMoney(amount)} received`,
      detail: `${invoice.number} · ${input.method.replace('_', ' ')}`,
      metadata: { transactionId: transaction.id, invoiceId: invoice.id },
      actor,
      createdAt: at,
    })
  }

  // Clearing the last overdue invoice brings a past-due membership back to active.
  if (fullyPaid && invoice.membershipId) {
    const stillOwing = await db.invoice.count({
      where: { membershipId: invoice.membershipId, status: 'open', id: { not: invoice.id }, dueDate: { lt: new Date() } },
    })
    if (stillOwing === 0) {
      const membership = await db.membership.findUnique({ where: { id: invoice.membershipId } })
      if (membership?.status === 'past_due') {
        await db.membership.update({ where: { id: membership.id }, data: { status: 'active', failedPaymentCount: 0 } })
        await membershipEvent(db, input.ownerId, 'membership.updated', membership.id)
        const { syncMemberStatus } = await import('./memberships')
        await syncMemberStatus(db, membership.memberId)
      }
    }
  }
  return transaction
}

/** Record a declined/failed attempt and move the membership to past due. */
export async function recordFailedPayment(
  db: Db,
  input: {
    ownerId: string; invoiceId: string; method: PaymentMethod; failureReason: string; actor?: ActorRef; retryInDays?: number
    provider?: string; providerReference?: string | null; cardLast4?: string | null; paymentMethodId?: string | null
    /** The household payer whose card or bank account was tried. */
    payerMemberId?: string | null
  }
) {
  const invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, ownerId: input.ownerId } })
  if (!invoice) throw notFound('Invoice')
  const balance = invoiceBalance(invoice)
  if (balance === 0) throw badRequest('This invoice is already paid.')
  const actor = input.actor || SYSTEM
  const attempt = invoice.attemptCount + 1
  // Retry on day 3, day 5 and day 7 after the first failure (gaps of 3, 2 and 2 days),
  // then give up after the fourth attempt and leave the invoice for staff.
  const retryDays = input.retryInDays ?? [3, 2, 2][attempt - 1]
  const transaction = await db.transaction.create({
    data: {
      ownerId: input.ownerId,
      memberId: invoice.memberId,
      invoiceId: invoice.id,
      type: 'payment',
      status: 'failed',
      amountCents: balance,
      method: input.method,
      provider: input.provider || 'manual',
      providerReference: input.providerReference || null,
      cardLast4: input.cardLast4 || null,
      paymentMethodId: input.paymentMethodId || null,
      payerMemberId: input.payerMemberId && input.payerMemberId !== invoice.memberId ? input.payerMemberId : null,
      failureReason: input.failureReason,
      staffName: actor.name || null,
    },
  })
  const payer = input.payerMemberId && input.payerMemberId !== invoice.memberId ? await db.member.findUnique({ where: { id: input.payerMemberId }, select: { name: true } }) : null
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      attemptCount: attempt,
      nextAttemptAt: retryDays ? new Date(Date.now() + retryDays * 86_400_000) : null,
    },
  })
  await paymentEvent(db, input.ownerId, 'payment.failed', transaction.id)
  await invoiceEvent(db, input.ownerId, 'invoice.failed', invoice.id)
  if (invoice.memberId) {
    await logActivity(db, {
      ownerId: input.ownerId,
      memberId: invoice.memberId,
      type: 'payment_failed',
      title: `Payment of ${formatMoney(balance)} failed`,
      detail: `${invoice.number} · ${input.failureReason}${payer ? ` · billed to ${payer.name}` : ''}`,
      metadata: { transactionId: transaction.id, invoiceId: invoice.id, payerMemberId: input.payerMemberId || undefined },
      actor,
    })
    const member = await db.member.findUnique({ where: { id: invoice.memberId }, select: { name: true } })
    await notify(db, {
      ownerId: input.ownerId,
      type: 'payment_failed',
      title: `Payment failed for ${member?.name || 'a member'}`,
      body: `${formatMoney(balance)} on ${invoice.number}${payer ? `, billed to ${payer.name}` : ''}: ${input.failureReason}`,
      href: `/members/${invoice.memberId}?tab=billing`,
    })
  }
  if (invoice.membershipId) {
    const membership = await db.membership.update({
      where: { id: invoice.membershipId },
      data: { failedPaymentCount: { increment: 1 } },
      include: { plan: { select: { name: true } } },
    })
    const { fireTrigger } = await import('./automations')
    await fireTrigger(db, input.ownerId, 'payment_failed', {
      memberId: membership.memberId, dedupeKey: `failed:${transaction.id}`,
      context: { amount: formatMoney(balance), membership_name: membership.plan.name },
    })
    if (membership.status === 'active') {
      await db.membership.update({ where: { id: membership.id }, data: { status: 'past_due' } })
      await membershipEvent(db, input.ownerId, 'membership.updated', membership.id)
      const { syncMemberStatus } = await import('./memberships')
      await syncMemberStatus(db, membership.memberId)
    }
  }
  return transaction
}

/** Refund all or part of a succeeded payment. */
export async function refundTransaction(
  db: Db,
  input: {
    ownerId: string; transactionId: string; amountCents?: number; reason?: string | null; actor?: ActorRef
    /** The processor's id for this refund. Recording the same one twice is a no-op. */
    providerReference?: string | null
    /** Why, from REFUND_REASONS. `reason` is the free-text note that goes with it. */
    refundReason?: string | null
    /** Pending: the processor has accepted the refund but the money has not moved yet (bank debits). */
    status?: 'succeeded' | 'pending'
    /** Keep the money on the member's account as credit instead of sending it back. */
    toCredit?: boolean
  }
) {
  await lockRow(db, 'Transaction', input.transactionId)
  if (input.providerReference) {
    const already = await db.transaction.findFirst({
      where: { ownerId: input.ownerId, type: 'refund', parentTransactionId: input.transactionId, providerReference: input.providerReference },
    })
    if (already) return { refund: already, fullyRefunded: false, duplicate: true }
  }
  const original = await db.transaction.findFirst({ where: { id: input.transactionId, ownerId: input.ownerId } })
  if (!original) throw notFound('Transaction')
  if (original.type !== 'payment' || original.status !== 'succeeded') {
    throw badRequest('Only successful payments can be refunded.', 'not_refundable')
  }
  const refundable = original.amountCents - original.refundedCents
  if (refundable <= 0) throw badRequest('This payment has already been fully refunded.', 'already_refunded')
  const amount = input.amountCents ?? refundable
  if (amount <= 0) throw badRequest('Refund amount must be greater than zero.')
  if (amount > refundable) {
    throw badRequest(`You can refund at most ${formatMoney(refundable)} of this payment.`, 'refund_too_large')
  }
  const actor = input.actor || SYSTEM
  if (input.toCredit && !original.memberId) throw badRequest('There is no member on this payment to hold the credit.', 'no_member')
  // Money that was paid from account credit goes back to account credit, to whoever's credit it was.
  const backToCredit = input.toCredit || original.method === 'account_credit'
  const creditTo = original.method === 'account_credit' ? original.payerMemberId || original.memberId : original.memberId

  const refund = await db.transaction.create({
    data: {
      ownerId: input.ownerId,
      memberId: original.memberId,
      invoiceId: original.invoiceId,
      locationId: original.locationId,
      type: 'refund',
      status: input.status || 'succeeded',
      amountCents: amount,
      // A refund kept as credit never left the gym, so it is recorded against account credit, not the card.
      method: input.toCredit ? 'account_credit' : original.method,
      provider: input.toCredit ? 'manual' : original.provider,
      providerReference: input.providerReference || null,
      cardLast4: input.toCredit ? null : original.cardLast4,
      note: input.reason || null,
      refundReason: input.refundReason || null,
      payerMemberId: original.payerMemberId,
      parentTransactionId: original.id,
      staffId: actor.type === 'staff' || actor.type === 'owner' ? actor.id : null,
      staffName: actor.name || null,
    },
  })
  await db.transaction.update({ where: { id: original.id }, data: { refundedCents: { increment: amount } } })
  if (original.invoiceId) {
    await db.invoice.update({ where: { id: original.invoiceId }, data: { refundedCents: { increment: amount } } })
  }
  if (original.invoiceId) await syncOrderRefundState(db, original.invoiceId)
  let credit = null
  if (backToCredit && creditTo) {
    const { grantCredit } = await import('./account-credit')
    const invoice = original.invoiceId ? await db.invoice.findUnique({ where: { id: original.invoiceId }, select: { number: true } }) : null
    credit = (await grantCredit(db, {
      ownerId: input.ownerId, memberId: creditTo, amountCents: amount, source: 'refund',
      reason: [invoice ? `Refund of ${invoice.number}` : 'Refund', input.reason].filter(Boolean).join(': '),
      sourceInvoiceId: original.invoiceId, sourceTransactionId: refund.id, actor, recordTransaction: false,
    })).credit
  }
  if (original.memberId) {
    await logActivity(db, {
      ownerId: input.ownerId,
      memberId: original.memberId,
      type: 'refund',
      title: `Refund of ${formatMoney(amount)} ${input.toCredit ? 'kept as account credit' : input.status === 'pending' ? 'started' : 'issued'}`,
      detail: [input.refundReason && REFUND_REASON_LABELS[input.refundReason], input.reason].filter(Boolean).join(' · ') || undefined,
      metadata: { transactionId: refund.id, originalTransactionId: original.id, creditId: credit?.id },
      actor,
    })
  }
  // A refund the bank has not confirmed yet is announced when it settles, not before.
  if (refund.status === 'succeeded') await paymentEvent(db, input.ownerId, 'payment.refunded', original.id, refund.id)
  return { refund, credit, fullyRefunded: amount === refundable, duplicate: false }
}

export const REFUND_REASONS = ['requested', 'duplicate', 'billing_error', 'service_issue', 'cancelled', 'fraudulent', 'other'] as const
export const REFUND_REASON_LABELS: Record<string, string> = {
  requested: 'Member asked', duplicate: 'Charged twice', billing_error: 'Billing mistake', service_issue: 'Problem with the service',
  cancelled: 'Cancelled', fraudulent: 'Fraud', other: 'Other',
}

/** Keep a shop order's status in step with how much of it has been refunded. */
export async function syncOrderRefundState(db: Db, invoiceId: string) {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, select: { orderId: true, refundedCents: true, amountPaidCents: true } })
  if (!invoice?.orderId) return
  const status = invoice.refundedCents <= 0 ? 'completed' : invoice.refundedCents >= invoice.amountPaidCents ? 'refunded' : 'partially_refunded'
  await db.order.updateMany({ where: { id: invoice.orderId, status: { not: status } }, data: { status } })
}

/**
 * The processor's final word on a refund that was pending. Succeeded settles it. Failed puts the
 * money back on the original payment (it never left) and tells staff. Safe to call repeatedly.
 */
export async function settleRefund(db: Db, input: { ownerId: string; refundId: string; outcome: 'succeeded' | 'failed'; failureReason?: string | null }) {
  const found = await db.transaction.findFirst({ where: { id: input.refundId, ownerId: input.ownerId, type: 'refund' }, select: { parentTransactionId: true } })
  if (!found) return null
  if (found.parentTransactionId) await lockRow(db, 'Transaction', found.parentTransactionId)
  const refund = await db.transaction.findUniqueOrThrow({ where: { id: input.refundId } })
  // A failure is final. So is a success, except that the processor can still fail a refund it had first reported as done.
  if (refund.status === 'failed' || refund.status === input.outcome) return refund
  if (input.outcome === 'succeeded') {
    const settled = await db.transaction.update({ where: { id: refund.id }, data: { status: 'succeeded' } })
    if (refund.parentTransactionId) await paymentEvent(db, input.ownerId, 'payment.refunded', refund.parentTransactionId, refund.id)
    return settled
  }
  const updated = await db.transaction.update({ where: { id: refund.id }, data: { status: 'failed', failureReason: input.failureReason || 'The refund failed' } })
  if (refund.parentTransactionId) await db.transaction.update({ where: { id: refund.parentTransactionId }, data: { refundedCents: { decrement: refund.amountCents } } })
  if (refund.invoiceId) {
    await db.invoice.update({ where: { id: refund.invoiceId }, data: { refundedCents: { decrement: refund.amountCents } } })
    await syncOrderRefundState(db, refund.invoiceId)
  }
  if (refund.memberId) {
    await logActivity(db, {
      ownerId: input.ownerId, memberId: refund.memberId, type: 'refund', title: `Refund of ${formatMoney(refund.amountCents)} failed`,
      detail: input.failureReason || 'The money was not returned', metadata: { transactionId: refund.id, originalTransactionId: refund.parentTransactionId },
    })
  }
  await notify(db, {
    ownerId: input.ownerId, type: 'refund_failed', title: `A refund of ${formatMoney(refund.amountCents)} failed`,
    body: `${input.failureReason || 'The processor could not return the money.'} It has not been refunded; try again or refund another way.`,
    href: refund.memberId ? `/members/${refund.memberId}?tab=billing` : '/billing',
  })
  return updated
}

/** Add (or with a negative amount, remove) account credit for a member. */
export async function adjustCredit(
  db: Db,
  input: { ownerId: string; memberId: string; amountCents: number; note?: string | null; autoApply?: boolean; actor?: ActorRef }
) {
  if (input.amountCents === 0) throw badRequest('Credit amount cannot be zero.')
  await lockRow(db, 'Member', input.memberId)
  const member = await db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } })
  if (!member) throw notFound('Member')
  const actor = input.actor || SYSTEM
  const { creditAvailable, drawCredit, grantCredit } = await import('./account-credit')
  if (input.amountCents > 0) {
    const granted = await grantCredit(db, { ownerId: input.ownerId, memberId: member.id, amountCents: input.amountCents, source: 'staff', reason: input.note, autoApply: input.autoApply, actor })
    return granted.transaction!
  }
  const { totalCents } = await creditAvailable(db, input.ownerId, member.id)
  if (totalCents + input.amountCents < 0) {
    throw badRequest(`That would take the credit balance below zero (${formatMoney(totalCents)} available).`)
  }
  await drawCredit(db, { ownerId: input.ownerId, memberId: member.id, amountCents: -input.amountCents, kind: 'removed', note: input.note, actor })
  const transaction = await db.transaction.create({
    data: {
      ownerId: input.ownerId,
      memberId: member.id,
      type: 'credit',
      status: 'succeeded',
      amountCents: Math.abs(input.amountCents),
      method: 'account_credit',
      note: input.note || (input.amountCents > 0 ? 'Credit added' : 'Credit removed'),
      staffName: actor.name || null,
    },
  })
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: member.id,
    type: 'credit',
    title: `${formatMoney(Math.abs(input.amountCents))} account credit ${input.amountCents > 0 ? 'added' : 'removed'}`,
    detail: input.note || undefined,
    actor,
  })
  return transaction
}

export async function voidInvoice(db: Db, ownerId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, ownerId } })
  if (!invoice) throw notFound('Invoice')
  if (invoice.amountPaidCents > 0) {
    throw new ApiError(409, 'This invoice has payments. Refund them instead of voiding.', 'invoice_has_payments')
  }
  if (invoice.status === 'void') return invoice
  return db.invoice.update({ where: { id: invoice.id }, data: { status: 'void', nextAttemptAt: null } })
}

/** Total owed across a member's open invoices. */
export async function memberBalance(ownerId: string, memberId: string, db: Db = prisma) {
  const open = await db.invoice.findMany({
    where: { ownerId, memberId, status: 'open' },
    select: { totalCents: true, amountPaidCents: true, dueDate: true },
  })
  const now = Date.now()
  let balanceCents = 0
  let overdueCents = 0
  for (const inv of open) {
    const due = invoiceBalance(inv)
    balanceCents += due
    if (inv.dueDate && inv.dueDate.getTime() < now) overdueCents += due
  }
  return { balanceCents, overdueCents, openInvoices: open.length }
}
