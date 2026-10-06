import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { cancelMembership, freezeMembership, runMembershipBilling, sellMembership, unfreezeMembership } from '@/lib/services/memberships'
import { adjustCredit, computeTotals, recordFailedPayment, recordPayment, refundTransaction } from '@/lib/services/payments'
import { DAY, createGym, createMember, createPlan, destroyGym, tx } from './helpers'

let ownerId: string
beforeAll(async () => { ownerId = await createGym() })
afterAll(async () => { await destroyGym(ownerId) })

const memberStatus = async (id: string) => (await prisma.member.findUniqueOrThrow({ where: { id } })).status

describe('totals', () => {
  it('applies discount before tax', () => {
    expect(computeTotals([{ description: 'a', unitPriceCents: 10000, taxRateBps: 1000 }], 2000)).toEqual({
      subtotalCents: 10000, discountCents: 2000, taxCents: 800, totalCents: 8800,
    })
  })
  it('never discounts below zero', () => {
    expect(computeTotals([{ description: 'a', unitPriceCents: 500 }], 9999).totalCents).toBe(0)
  })
})

describe('selling a membership', () => {
  it('creates the membership, an open invoice and activates the member', async () => {
    const member = await createMember(ownerId, { status: 'inactive' })
    const plan = await createPlan(ownerId, { enrollmentFeeCents: 5000 })
    const { membership, invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    expect(membership.status).toBe('active')
    expect(invoice?.status).toBe('open')
    expect(invoice?.totalCents).toBe(20000)
    expect(await memberStatus(member.id)).toBe('active')
  })

  it('collects payment at the desk and marks the invoice paid', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice!.id }, include: { transactions: true } })
    expect(paid.status).toBe('paid')
    expect(paid.transactions).toHaveLength(1)
    expect(paid.transactions[0].amountCents).toBe(15000)
  })

  it('starts a trial without billing, then converts and bills when the trial ends', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId, { trialDays: 7 })
    const { membership, invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    expect(membership.status).toBe('trial')
    expect(invoice).toBeNull()
    expect(await memberStatus(member.id)).toBe('trial')

    const summary = await runMembershipBilling(ownerId, new Date(Date.now() + 8 * DAY))
    expect(summary.errors).toEqual([])
    expect(summary.trialsConverted).toBe(1)
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id }, include: { invoices: true } })
    expect(after.status).toBe('active')
    expect(after.invoices).toHaveLength(1)
    expect(await memberStatus(member.id)).toBe('active')
  })

  it('refuses a second copy of the same recurring plan', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    await expect(tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))).rejects.toMatchObject({ code: 'duplicate_membership' })
  })

  it('applies a coupon once and counts the redemption', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    await prisma.coupon.create({ data: { ownerId, code: 'SAVE20', percentOff: 20 } })
    const { invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', couponCode: 'save20' }))
    expect(invoice?.discountCents).toBe(3000)
    expect(invoice?.totalCents).toBe(12000)
    expect((await prisma.coupon.findFirstOrThrow({ where: { ownerId, code: 'SAVE20' } })).timesRedeemed).toBe(1)
  })

  it("cannot use another gym's plan or member", async () => {
    const other = await createGym()
    try {
      const foreignPlan = await createPlan(other)
      const member = await createMember(ownerId)
      await expect(tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: foreignPlan.id, paymentMethod: 'cash' }))).rejects.toMatchObject({ status: 404 })
      const foreignMember = await createMember(other)
      const plan = await createPlan(ownerId)
      await expect(tx((db) => sellMembership(db, { ownerId, memberId: foreignMember.id, planId: plan.id, paymentMethod: 'cash' }))).rejects.toMatchObject({ status: 404 })
    } finally {
      await destroyGym(other)
    }
  })
})

describe('recurring billing', () => {
  it('bills each period exactly once, even when the job runs twice', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    const later = new Date(Date.now() + 32 * DAY)
    const first = await runMembershipBilling(ownerId, later)
    const second = await runMembershipBilling(ownerId, later)
    expect(first.errors).toEqual([])
    expect(second.invoicesCreated).toBe(0)
    expect(await prisma.invoice.count({ where: { membershipId: membership.id } })).toBe(2)
  })

  it('marks an unpaid membership past due after the grace period, and payment restores it', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { membership, invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    await runMembershipBilling(ownerId, new Date(Date.now() + 3 * DAY))
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('active')

    const summary = await runMembershipBilling(ownerId, new Date(Date.now() + 9 * DAY))
    expect(summary.markedPastDue).toBeGreaterThanOrEqual(1)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('past_due')
    expect(await memberStatus(member.id)).toBe('past_due')

    // dueDate is "now", so by wall-clock it is not yet overdue: back-date it as the cron would have seen it.
    await prisma.invoice.update({ where: { id: invoice!.id }, data: { dueDate: new Date(Date.now() - 9 * DAY) } })
    await tx((db) => recordPayment(db, { ownerId, invoiceId: invoice!.id, method: 'cash' }))
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('active')
    expect(await memberStatus(member.id)).toBe('active')
  })

  it('a failed payment moves the membership to past due and records the attempt', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { membership, invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'card' }))
    await tx((db) => recordFailedPayment(db, { ownerId, invoiceId: invoice!.id, method: 'card', failureReason: 'Card declined' }))
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })
    expect(after.status).toBe('past_due')
    expect(after.failedPaymentCount).toBe(1)
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice!.id } })
    expect(inv.attemptCount).toBe(1)
    expect(inv.nextAttemptAt).not.toBeNull()
    expect(await prisma.transaction.count({ where: { invoiceId: inv.id, status: 'failed' } })).toBe(1)
  })
})

describe('freeze and cancel', () => {
  it('freezing pauses billing and unfreezing pushes the billing date out', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    await tx((db) => freezeMembership(db, { ownerId, membershipId: membership.id, until: new Date(Date.now() + 60 * DAY) }))
    expect(await memberStatus(member.id)).toBe('frozen')

    await runMembershipBilling(ownerId, new Date(Date.now() + 40 * DAY))
    // Only the invoice from the sale: nothing is billed while frozen
    expect(await prisma.invoice.count({ where: { membershipId: membership.id } })).toBe(1)

    await prisma.membership.update({ where: { id: membership.id }, data: { frozenAt: new Date(Date.now() - 10 * DAY) } })
    await tx((db) => unfreezeMembership(db, { ownerId, membershipId: membership.id }))
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })
    expect(after.status).toBe('active')
    const shiftDays = (after.currentPeriodEnd!.getTime() - membership.currentPeriodEnd!.getTime()) / DAY
    expect(Math.round(shiftDays)).toBe(10)
  })

  it('enforces plan freeze rules', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId, { freezeAllowed: false })
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    await expect(tx((db) => freezeMembership(db, { ownerId, membershipId: membership.id }))).rejects.toMatchObject({ code: 'freeze_not_allowed' })
  })

  it('blocks early cancellation under contract unless overridden', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId, { contractMonths: 12 })
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    await expect(tx((db) => cancelMembership(db, { ownerId, membershipId: membership.id, when: 'now' }))).rejects.toMatchObject({ code: 'under_contract' })
    const result = await tx((db) => cancelMembership(db, { ownerId, membershipId: membership.id, when: 'now', override: true }))
    expect(result.immediate).toBe(true)
    expect(await memberStatus(member.id)).toBe('cancelled')
  })

  it('cancelling at period end keeps access until then, then the billing job ends it', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { membership } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    const result = await tx((db) => cancelMembership(db, { ownerId, membershipId: membership.id, when: 'period_end', reason: 'Moving away' }))
    expect(result.immediate).toBe(false)
    expect(await memberStatus(member.id)).toBe('active')

    const summary = await runMembershipBilling(ownerId, new Date(Date.now() + 32 * DAY))
    expect(summary.cancelled).toBeGreaterThanOrEqual(1)
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })
    expect(after.status).toBe('cancelled')
    expect(await prisma.invoice.count({ where: { membershipId: membership.id } })).toBe(1)
  })
})

describe('refunds and credit', () => {
  it('allows partial refunds up to the amount paid and no further', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    const payment = await prisma.transaction.findFirstOrThrow({ where: { invoiceId: invoice!.id, type: 'payment' } })
    await tx((db) => refundTransaction(db, { ownerId, transactionId: payment.id, amountCents: 5000, reason: 'Goodwill' }))
    await expect(tx((db) => refundTransaction(db, { ownerId, transactionId: payment.id, amountCents: 10001 }))).rejects.toMatchObject({ code: 'refund_too_large' })
    const { fullyRefunded } = await tx((db) => refundTransaction(db, { ownerId, transactionId: payment.id }))
    expect(fullyRefunded).toBe(true)
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } })).refundedCents).toBe(15000)
    await expect(tx((db) => refundTransaction(db, { ownerId, transactionId: payment.id }))).rejects.toMatchObject({ code: 'already_refunded' })
  })

  it('pays an invoice from account credit and cannot overspend it', async () => {
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    const { invoice } = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    await tx((db) => adjustCredit(db, { ownerId, memberId: member.id, amountCents: 10000 }))
    await expect(tx((db) => recordPayment(db, { ownerId, invoiceId: invoice!.id, method: 'account_credit' }))).rejects.toMatchObject({ code: 'insufficient_credit' })
    await tx((db) => recordPayment(db, { ownerId, invoiceId: invoice!.id, method: 'account_credit', amountCents: 10000 }))
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).creditBalanceCents).toBe(0)
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice!.id } })
    expect(inv.status).toBe('open')
    expect(inv.amountPaidCents).toBe(10000)
    await expect(tx((db) => recordPayment(db, { ownerId, invoiceId: invoice!.id, method: 'cash', amountCents: 5001 }))).rejects.toMatchObject({ code: 'overpayment' })
  })
})
