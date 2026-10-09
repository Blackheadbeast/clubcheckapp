// Account credit: money the gym holds for a member, to be spent on their invoices.
//
// Every credit is a row (AccountCredit) recording how much it was for, how much is left, where it
// came from and who created it. Every time some is spent or taken back there is a CreditApplication
// row saying how much, when, and on which invoice. Member.creditBalanceCents is kept equal to the sum
// of what is left, so older screens that read the balance stay right. Nothing here changes a balance
// without leaving a row behind.

import { ApiError, badRequest, notFound } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { ActorRef, Db, SYSTEM, lockRow, logActivity } from './core'

export const CREDIT_SOURCES = ['proration', 'staff', 'refund', 'overpayment', 'opening_balance'] as const
export type CreditSource = (typeof CREDIT_SOURCES)[number]

export const CREDIT_SOURCE_LABELS: Record<string, string> = {
  proration: 'Plan change',
  staff: 'Added by staff',
  refund: 'Refund kept as credit',
  overpayment: 'Overpayment',
  opening_balance: 'Balance carried over',
}

/**
 * Lock the member and make sure their credit rows add up to their balance. A balance that predates
 * the ledger becomes one "carried over" credit, so it can be spent and traced like any other.
 */
async function lockLedger(db: Db, ownerId: string, memberId: string) {
  await lockRow(db, 'Member', memberId)
  const member = await db.member.findFirst({ where: { id: memberId, ownerId }, select: { id: true, name: true, creditBalanceCents: true } })
  if (!member) throw notFound('Member')
  const held = await db.accountCredit.aggregate({ where: { ownerId, memberId }, _sum: { remainingCents: true } })
  const inLedger = held._sum.remainingCents || 0
  if (member.creditBalanceCents > inLedger) {
    const amount = member.creditBalanceCents - inLedger
    // Held back from automatic use: before the ledger, credit was only ever spent when staff chose to.
    await db.accountCredit.create({ data: { ownerId, memberId, originalCents: amount, remainingCents: amount, source: 'opening_balance', reason: 'Credit on the account before credits were itemised', autoApply: false } })
  } else if (member.creditBalanceCents < inLedger) {
    await db.member.update({ where: { id: memberId }, data: { creditBalanceCents: inLedger } })
    member.creditBalanceCents = inLedger
  }
  return member
}

export interface GrantInput {
  ownerId: string
  memberId: string
  amountCents: number
  source: CreditSource
  reason?: string | null
  autoApply?: boolean
  membershipId?: string | null
  sourceInvoiceId?: string | null
  sourceTransactionId?: string | null
  actor?: ActorRef
  /** Write a "credit" line to the member's transactions. Off when another transaction already tells the story. */
  recordTransaction?: boolean
}

/** Put credit on a member's account. */
export async function grantCredit(db: Db, input: GrantInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw badRequest('Credit must be more than zero.')
  await lockLedger(db, input.ownerId, input.memberId)
  const actor = input.actor || SYSTEM
  const credit = await db.accountCredit.create({
    data: {
      ownerId: input.ownerId, memberId: input.memberId, originalCents: input.amountCents, remainingCents: input.amountCents,
      source: input.source, reason: input.reason || null, autoApply: input.autoApply ?? true,
      membershipId: input.membershipId || null, sourceInvoiceId: input.sourceInvoiceId || null, sourceTransactionId: input.sourceTransactionId || null,
      createdById: actor.type === 'staff' || actor.type === 'owner' ? actor.id : null, createdByName: actor.name || null,
    },
  })
  await db.member.update({ where: { id: input.memberId }, data: { creditBalanceCents: { increment: input.amountCents } } })
  let transaction = null
  if (input.recordTransaction !== false) {
    transaction = await db.transaction.create({
      data: {
        ownerId: input.ownerId, memberId: input.memberId, type: 'credit', status: 'succeeded', amountCents: input.amountCents, method: 'account_credit',
        note: input.reason || 'Credit added', staffName: actor.name || null, invoiceId: null,
      },
    })
  }
  await logActivity(db, {
    ownerId: input.ownerId, memberId: input.memberId, type: 'credit',
    title: `${formatMoney(input.amountCents)} account credit added`,
    detail: [CREDIT_SOURCE_LABELS[input.source], input.reason].filter(Boolean).join(' · ') || undefined,
    metadata: { creditId: credit.id, source: input.source }, actor,
  })
  return { credit, transaction }
}

/** Credit a member has, in total and the part that is spent automatically. */
export async function creditAvailable(db: Db, ownerId: string, memberId: string) {
  const [member, rows] = await Promise.all([
    db.member.findFirst({ where: { id: memberId, ownerId }, select: { creditBalanceCents: true } }),
    db.accountCredit.findMany({ where: { ownerId, memberId, remainingCents: { gt: 0 } }, select: { remainingCents: true, autoApply: true } }),
  ])
  if (!member) return { totalCents: 0, autoCents: 0 }
  const inLedger = rows.reduce((sum, r) => sum + r.remainingCents, 0)
  return { totalCents: Math.max(member.creditBalanceCents, inLedger), autoCents: rows.filter((r) => r.autoApply).reduce((sum, r) => sum + r.remainingCents, 0) }
}

/**
 * Take credit off a member's account, oldest first, leaving a row for each credit it came from.
 * `kind` says why: spent on an invoice, or taken back by staff.
 */
export async function drawCredit(db: Db, input: { ownerId: string; memberId: string; amountCents: number; kind: 'applied' | 'removed'; invoiceId?: string | null; transactionId?: string | null; note?: string | null; autoOnly?: boolean; actor?: ActorRef }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw badRequest('Credit amount must be more than zero.')
  await lockLedger(db, input.ownerId, input.memberId)
  const rows = await db.accountCredit.findMany({
    where: { ownerId: input.ownerId, memberId: input.memberId, remainingCents: { gt: 0 }, ...(input.autoOnly && { autoApply: true }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const available = rows.reduce((sum, r) => sum + r.remainingCents, 0)
  if (available < input.amountCents) throw new ApiError(400, `Only ${formatMoney(available)} of account credit is available.`, 'insufficient_credit')
  let left = input.amountCents
  const uses = []
  for (const row of rows) {
    if (left === 0) break
    const take = Math.min(left, row.remainingCents)
    await db.accountCredit.update({ where: { id: row.id }, data: { remainingCents: { decrement: take } } })
    uses.push(await db.creditApplication.create({
      data: { ownerId: input.ownerId, creditId: row.id, kind: input.kind, amountCents: take, invoiceId: input.invoiceId || null, transactionId: input.transactionId || null, note: input.note || null, byName: input.actor?.name || null },
    }))
    left -= take
  }
  await db.member.update({ where: { id: input.memberId }, data: { creditBalanceCents: { decrement: input.amountCents } } })
  return uses
}

/** Hold a credit back from automatic use, or release it. */
export async function setCreditAutoApply(db: Db, input: { ownerId: string; creditId: string; autoApply: boolean }) {
  const result = await db.accountCredit.updateMany({ where: { id: input.creditId, ownerId: input.ownerId }, data: { autoApply: input.autoApply } })
  if (result.count === 0) throw notFound('Credit')
}

/** A member's credits with everything that has happened to each, newest first. */
export async function listCredits(db: Db, ownerId: string, memberId: string) {
  const [member, credits] = await Promise.all([
    db.member.findFirst({ where: { id: memberId, ownerId }, select: { creditBalanceCents: true } }),
    db.accountCredit.findMany({ where: { ownerId, memberId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200, include: { uses: { orderBy: { createdAt: 'asc' } } } }),
  ])
  if (!member) throw notFound('Member')
  const invoiceIds = Array.from(new Set(credits.flatMap((c) => [c.sourceInvoiceId, ...c.uses.map((u) => u.invoiceId)]).filter(Boolean))) as string[]
  const invoices = invoiceIds.length ? await db.invoice.findMany({ where: { ownerId, id: { in: invoiceIds } }, select: { id: true, number: true } }) : []
  const number = (id: string | null) => invoices.find((i) => i.id === id)?.number || null
  const inLedger = credits.reduce((sum, c) => sum + c.remainingCents, 0)
  return {
    balanceCents: Math.max(member.creditBalanceCents, inLedger),
    /** A balance from before credits were itemised that has not been touched yet. */
    unitemisedCents: Math.max(0, member.creditBalanceCents - inLedger),
    autoApplyCents: credits.filter((c) => c.autoApply).reduce((sum, c) => sum + c.remainingCents, 0),
    credits: credits.map((c) => ({
      id: c.id, originalCents: c.originalCents, remainingCents: c.remainingCents, usedCents: c.originalCents - c.remainingCents,
      source: c.source, sourceLabel: CREDIT_SOURCE_LABELS[c.source] || c.source, reason: c.reason, autoApply: c.autoApply,
      createdByName: c.createdByName, createdAt: c.createdAt, sourceInvoiceNumber: number(c.sourceInvoiceId),
      uses: c.uses.map((u) => ({ id: u.id, kind: u.kind, amountCents: u.amountCents, invoiceId: u.invoiceId, invoiceNumber: number(u.invoiceId), note: u.note, byName: u.byName, at: u.createdAt })),
    })),
  }
}

/**
 * Spend credit that is marked for automatic use on an open invoice: the member's own first, then
 * their household payer's. Each use is an ordinary account-credit payment with its own rows.
 */
export async function applyCreditsToInvoice(db: Db, input: { ownerId: string; invoiceId: string; actor?: ActorRef }) {
  const { recordPayment, invoiceBalance } = await import('./payments')
  const { billingPayer } = await import('./households')
  let invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, ownerId: input.ownerId } })
  if (!invoice || invoice.status !== 'open' || !invoice.memberId) return 0
  const payer = await billingPayer(db, input.ownerId, invoice.memberId)
  const holders = payer.viaHousehold ? [invoice.memberId, payer.payerId] : [invoice.memberId]
  let applied = 0
  for (const holder of holders) {
    const balance = invoiceBalance(invoice)
    if (balance === 0) break
    const { autoCents } = await creditAvailable(db, input.ownerId, holder)
    const amount = Math.min(autoCents, balance)
    if (amount <= 0) continue
    await recordPayment(db, { ownerId: input.ownerId, invoiceId: invoice.id, amountCents: amount, method: 'account_credit', creditMemberId: holder, creditAutoOnly: true, note: 'Account credit applied automatically', actor: input.actor })
    applied += amount
    invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
  }
  return applied
}
