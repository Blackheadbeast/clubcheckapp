// Member-facing billing: invoices, payments, refunds, credits and coupons.
// (lib/billing.ts is unrelated: it is the gym's own ClubCheck subscription.)

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

  if (input.method === 'account_credit') {
    if (!invoice.memberId) throw badRequest('Account credit needs a member on the invoice.')
    await lockRow(db, 'Member', invoice.memberId)
    const member = await db.member.findUniqueOrThrow({ where: { id: invoice.memberId }, select: { creditBalanceCents: true } })
    if (member.creditBalanceCents < amount) {
      throw badRequest(`Only ${formatMoney(member.creditBalanceCents)} of account credit is available.`, 'insufficient_credit')
    }
    await db.member.update({ where: { id: invoice.memberId }, data: { creditBalanceCents: { decrement: amount } } })
  }

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
      note: input.note || null,
      staffId: actor.type === 'staff' || actor.type === 'owner' ? actor.id : null,
      staffName: actor.name || null,
      createdAt: at,
    },
  })

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
  input: { ownerId: string; invoiceId: string; method: PaymentMethod; failureReason: string; actor?: ActorRef; retryInDays?: number }
) {
  const invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, ownerId: input.ownerId } })
  if (!invoice) throw notFound('Invoice')
  const balance = invoiceBalance(invoice)
  if (balance === 0) throw badRequest('This invoice is already paid.')
  const actor = input.actor || SYSTEM
  const attempt = invoice.attemptCount + 1
  // Retry schedule: 3 days, then 5, then 7; give up after the fourth attempt.
  const retryDays = input.retryInDays ?? [3, 5, 7][attempt - 1]
  const transaction = await db.transaction.create({
    data: {
      ownerId: input.ownerId,
      memberId: invoice.memberId,
      invoiceId: invoice.id,
      type: 'payment',
      status: 'failed',
      amountCents: balance,
      method: input.method,
      failureReason: input.failureReason,
      staffName: actor.name || null,
    },
  })
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      attemptCount: attempt,
      nextAttemptAt: retryDays ? new Date(Date.now() + retryDays * 86_400_000) : null,
    },
  })
  if (invoice.memberId) {
    await logActivity(db, {
      ownerId: input.ownerId,
      memberId: invoice.memberId,
      type: 'payment_failed',
      title: `Payment of ${formatMoney(balance)} failed`,
      detail: `${invoice.number} · ${input.failureReason}`,
      metadata: { transactionId: transaction.id, invoiceId: invoice.id },
      actor,
    })
    const member = await db.member.findUnique({ where: { id: invoice.memberId }, select: { name: true } })
    await notify(db, {
      ownerId: input.ownerId,
      type: 'payment_failed',
      title: `Payment failed for ${member?.name || 'a member'}`,
      body: `${formatMoney(balance)} on ${invoice.number}: ${input.failureReason}`,
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
      const { syncMemberStatus } = await import('./memberships')
      await syncMemberStatus(db, membership.memberId)
    }
  }
  return transaction
}

/** Refund all or part of a succeeded payment. */
export async function refundTransaction(
  db: Db,
  input: { ownerId: string; transactionId: string; amountCents?: number; reason?: string | null; actor?: ActorRef }
) {
  await lockRow(db, 'Transaction', input.transactionId)
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

  const refund = await db.transaction.create({
    data: {
      ownerId: input.ownerId,
      memberId: original.memberId,
      invoiceId: original.invoiceId,
      locationId: original.locationId,
      type: 'refund',
      status: 'succeeded',
      amountCents: amount,
      method: original.method,
      provider: original.provider,
      note: input.reason || null,
      parentTransactionId: original.id,
      staffId: actor.type === 'staff' || actor.type === 'owner' ? actor.id : null,
      staffName: actor.name || null,
    },
  })
  await db.transaction.update({ where: { id: original.id }, data: { refundedCents: { increment: amount } } })
  if (original.invoiceId) {
    await db.invoice.update({ where: { id: original.invoiceId }, data: { refundedCents: { increment: amount } } })
  }
  // Refunds of account-credit payments go back to the member's credit balance.
  if (original.method === 'account_credit' && original.memberId) {
    await db.member.update({ where: { id: original.memberId }, data: { creditBalanceCents: { increment: amount } } })
  }
  if (original.memberId) {
    await logActivity(db, {
      ownerId: input.ownerId,
      memberId: original.memberId,
      type: 'refund',
      title: `Refund of ${formatMoney(amount)} issued`,
      detail: input.reason || undefined,
      metadata: { transactionId: refund.id, originalTransactionId: original.id },
      actor,
    })
  }
  return { refund, fullyRefunded: amount === refundable }
}

/** Add (or with a negative amount, remove) account credit for a member. */
export async function adjustCredit(
  db: Db,
  input: { ownerId: string; memberId: string; amountCents: number; note?: string | null; actor?: ActorRef }
) {
  if (input.amountCents === 0) throw badRequest('Credit amount cannot be zero.')
  await lockRow(db, 'Member', input.memberId)
  const member = await db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } })
  if (!member) throw notFound('Member')
  if (member.creditBalanceCents + input.amountCents < 0) {
    throw badRequest(`That would take the credit balance below zero (${formatMoney(member.creditBalanceCents)} available).`)
  }
  const actor = input.actor || SYSTEM
  await db.member.update({ where: { id: member.id }, data: { creditBalanceCents: { increment: input.amountCents } } })
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
