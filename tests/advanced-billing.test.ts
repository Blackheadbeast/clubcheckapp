// Priority 7: proration and plan changes, account credit, partial refunds and household billing.
//
// The service tests swap in a stand-in for Stripe that behaves like it where it matters here:
// the same idempotency key returns the same payment or refund, and it never refunds more than a
// payment holds. The HTTP tests need `npm run dev` against the same local database.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { calculateProration, calculateScheduledChange, daysBetween, prorate, taxOn } from '@/lib/billing/proration'
import { setPaymentProviderForTests, type ChargeRequest, type ChargeResult, type PaymentProvider, type RefundRequest } from '@/lib/payments/provider'
import { collectInvoice, recordExternalRefund, recordRefundFailure, refundPayment, runCollections, settlePayment } from '@/lib/services/collections'
import { runMembershipBilling, sellMembership } from '@/lib/services/memberships'
import { adjustCredit, computeTotals, recordPayment } from '@/lib/services/payments'
import { applyPlanChange, cancelScheduledPlanChange, previewPlanChange, type ApplyInput } from '@/lib/services/plan-change'
import { applyCreditsToInvoice, creditAvailable, drawCredit, grantCredit, listCredits, setCreditAutoApply } from '@/lib/services/account-credit'
import { addHouseholdMember, billingPayer, createHousehold, getHousehold, removeHouseholdMember, setHouseholdPayer } from '@/lib/services/households'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { DAY, createGym, createMember, createPlan, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

class FakeProcessor implements PaymentProvider {
  name = 'stripe'
  canAutoCharge = true
  charges: ChargeRequest[] = []
  refunds: RefundRequest[] = []
  next: ChargeResult['status'][] = []
  refundStatus: 'succeeded' | 'pending' = 'succeeded'
  private seen = new Map<string, ChargeResult>()
  private refundSeen = new Map<string, { status: 'succeeded' | 'pending'; reference: string }>()
  /** What each payment still holds, so a refund beyond it is refused the way Stripe refuses it. */
  held = new Map<string, number>()

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const repeat = this.seen.get(request.idempotencyKey)
    if (repeat) return repeat
    this.charges.push(request)
    const outcome = this.next.shift() || 'succeeded'
    const reference = `pi_${randomUUID()}`
    const result: ChargeResult = outcome === 'failed' ? { status: 'failed', reference, failureReason: 'Your card was declined.' } : outcome === 'processing' ? { status: 'processing', reference } : outcome === 'requires_manual' ? { status: 'requires_manual' } : { status: 'succeeded', reference }
    this.seen.set(request.idempotencyKey, result)
    if (result.status === 'succeeded') this.held.set(reference, request.amountCents)
    return result
  }

  async refund(input: RefundRequest) {
    const repeat = this.refundSeen.get(input.idempotencyKey)
    if (repeat) return repeat
    // Like Stripe: a refund beyond what the payment still holds is refused.
    const left = this.held.get(input.reference) ?? Infinity
    if (input.amountCents > left) return { status: 'failed' as const, failureReason: 'Refund amount is greater than the unrefunded amount on the charge.' }
    this.held.set(input.reference, left - input.amountCents)
    this.refunds.push(input)
    const result = { status: this.refundStatus, reference: `re_${randomUUID()}` }
    this.refundSeen.set(input.idempotencyKey, result)
    return result
  }
}

let gym: string
let other: string
let processor: FakeProcessor
beforeAll(async () => {
  // UTC keeps "days" exact in these tests whatever week of the year they run in.
  gym = await createGym({ timezone: 'UTC' })
  other = await createGym({ timezone: 'UTC' })
})
afterAll(async () => { setPaymentProviderForTests(null); await destroyGym(gym); await destroyGym(other) })
beforeEach(() => { processor = new FakeProcessor(); setPaymentProviderForTests(processor) })
afterEach(() => setPaymentProviderForTests(null))

const key = () => randomUUID()
const noon = () => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); return d }
const plans: Record<string, Awaited<ReturnType<typeof createPlan>>> = {}
async function planAt(priceCents: number, extra: Record<string, unknown> = {}, ownerId = gym) {
  const id = `${ownerId}:${priceCents}:${JSON.stringify(extra)}`
  return (plans[id] ||= await createPlan(ownerId, { name: `Plan ${priceCents / 100}${extra.billingInterval ? ` ${extra.billingInterval}` : ''}${extra.taxRateBps ? ' taxed' : ''} ${randomUUID().slice(0, 4)}`, priceCents, ...extra }))
}

async function withCard(ownerId = gym, data: Record<string, unknown> = {}) {
  const member = await createMember(ownerId, { connectCustomerId: `cus_${randomUUID()}`, ...data })
  const method = await prisma.paymentMethod.create({ data: { ownerId, memberId: member.id, providerId: `pm_${randomUUID()}`, type: 'card', brand: 'visa', last4: '4242', isDefault: true } })
  return { member, method }
}

/**
 * A member some days into a paid period of a known length. The membership, its period and the
 * invoice that paid for it are all moved so "now" is exactly `daysIn` days into `totalDays`.
 */
async function midPeriod(opts: { priceCents?: number; daysIn?: number; totalDays?: number; method?: 'cash' | 'card'; paid?: boolean; ownerId?: string; member?: { id: string }; planExtra?: Record<string, unknown>; discountPercent?: number } = {}) {
  const ownerId = opts.ownerId || gym
  const { priceCents = 10_000, daysIn = 15, totalDays = 30, method = 'cash', paid = true } = opts
  const plan = await planAt(priceCents, opts.planExtra, ownerId)
  const member = opts.member || (method === 'card' ? (await withCard(ownerId)).member : await createMember(ownerId))
  const at = noon()
  const start = new Date(at.getTime() - daysIn * DAY)
  const end = new Date(start.getTime() + totalDays * DAY)
  const sale = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: method, startDate: start, discountPercent: opts.discountPercent }))
  await prisma.membership.update({ where: { id: sale.membership.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } })
  await prisma.invoice.update({ where: { id: sale.invoice!.id }, data: { periodStart: start, periodEnd: end } })
  if (paid) {
    if (method === 'card') await collectInvoice({ ownerId, invoiceId: sale.invoice!.id })
    else await tx((db) => recordPayment(db, { ownerId, invoiceId: sale.invoice!.id, method: 'cash' }))
  }
  return { ownerId, member, plan, membershipId: sale.membership.id, invoiceId: sale.invoice!.id, at, start, end }
}

/** Preview, then confirm exactly what the preview showed: the way every screen does it. */
async function change(setup: { ownerId: string; membershipId: string; at: Date }, toPlanId: string, extra: Partial<ApplyInput> = {}) {
  const base = { ownerId: setup.ownerId, membershipId: setup.membershipId, planId: toPlanId, effective: 'now' as const, source: 'staff' as const, at: setup.at, ...extra }
  const preview = await previewPlanChange(base)
  const result = await applyPlanChange({ ...base, expected: { fromPlanId: preview.from.id, amountDueNowCents: preview.calc.amountDueNowCents, creditCents: preview.calc.creditCents }, idempotencyKey: key(), ...extra })
  return { preview, result }
}
const membershipOf = (id: string) => prisma.membership.findUniqueOrThrow({ where: { id }, include: { plan: true } })
const invoiceOf = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id }, include: { items: true, transactions: { orderBy: { createdAt: 'asc' } } } })
const balanceOf = async (memberId: string) => (await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).creditBalanceCents

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

describe('proration calculation', () => {
  const at = new Date('2026-06-16T12:00:00Z')
  const base = { tz: 'UTC', at, periodStart: new Date('2026-06-01T12:00:00Z'), periodEnd: new Date('2026-07-01T12:00:00Z'), newTaxRateBps: 0, sameCycle: true, newPeriodEnd: new Date('2026-07-16T12:00:00Z') }
  const on = (dayOfPeriod: number) => new Date(base.periodStart.getTime() + dayOfPeriod * DAY)

  it('charges only the difference for the days that are left: halfway through $100 moving to $150 is $25', () => {
    const c = calculateProration({ ...base, oldPaidCents: 10_000, newPriceCents: 15_000 })
    expect(c).toMatchObject({ mode: 'keep_billing_date', totalDays: 30, usedDays: 15, remainingDays: 15, oldUnusedCents: 5000, newChargeBaseCents: 7500, newChargeCents: 7500, netCents: 2500, dueBeforeCreditCents: 2500, amountDueNowCents: 2500, creditCents: 0, nextBillingCents: 15_000 })
    expect(c.nextBillingDate).toBe(base.periodEnd.toISOString())
    expect(c.effectiveAt).toBe(at.toISOString())
  })

  it('turns a downgrade into credit, never a negative charge', () => {
    const c = calculateProration({ ...base, oldPaidCents: 15_000, newPriceCents: 10_000 })
    expect(c).toMatchObject({ oldUnusedCents: 7500, newChargeCents: 5000, netCents: -2500, dueBeforeCreditCents: 0, amountDueNowCents: 0, creditCents: 2500, creditCarriedCents: 2500, nextBillingCents: 10_000, nextBillingAfterCreditCents: 7500 })
  })

  it('handles the edges of the period', () => {
    // The same day it started: the whole period is still ahead.
    expect(calculateProration({ ...base, at: on(0), oldPaidCents: 10_000, newPriceCents: 15_000 })).toMatchObject({ usedDays: 0, remainingDays: 30, oldUnusedCents: 10_000, newChargeCents: 15_000, amountDueNowCents: 5000 })
    // One day in.
    expect(calculateProration({ ...base, at: on(1), oldPaidCents: 10_000, newPriceCents: 15_000 })).toMatchObject({ usedDays: 1, remainingDays: 29, oldUnusedCents: 9667, newChargeCents: 14_500, amountDueNowCents: 4833 })
    // One day left.
    expect(calculateProration({ ...base, at: on(29), oldPaidCents: 10_000, newPriceCents: 15_000 })).toMatchObject({ remainingDays: 1, oldUnusedCents: 333, newChargeCents: 500, amountDueNowCents: 167 })
    // On the billing date itself there is nothing left to prorate.
    expect(calculateProration({ ...base, at: on(30), oldPaidCents: 10_000, newPriceCents: 15_000 })).toMatchObject({ remainingDays: 0, oldUnusedCents: 0, newChargeCents: 0, amountDueNowCents: 0, creditCents: 0, nextBillingCents: 15_000 })
    // Late at night or early in the morning, a day is a day.
    for (const hour of ['00:00:01', '23:59:59']) expect(calculateProration({ ...base, at: new Date(`2026-06-16T${hour}Z`), oldPaidCents: 10_000, newPriceCents: 15_000 }).remainingDays).toBe(15)
    expect(daysBetween(new Date('2026-03-07T12:00:00Z'), new Date('2026-03-09T12:00:00Z'), 'America/New_York')).toBe(2)
  })

  it('comes out at exactly zero for tiny differences and equal prices', () => {
    expect(calculateProration({ ...base, at: on(29), oldPaidCents: 10_000, newPriceCents: 10_001 })).toMatchObject({ oldUnusedCents: 333, newChargeCents: 333, netCents: 0, amountDueNowCents: 0, creditCents: 0 })
    expect(calculateProration({ ...base, oldPaidCents: 10_000, newPriceCents: 10_000 })).toMatchObject({ netCents: 0, amountDueNowCents: 0, creditCents: 0 })
    expect(calculateProration({ ...base, oldPaidCents: 10_000, newPriceCents: 10_001 })).toMatchObject({ oldUnusedCents: 5000, newChargeCents: 5001, amountDueNowCents: 1 })
    expect(calculateProration({ ...base, oldPaidCents: 1, newPriceCents: 2 })).toMatchObject({ oldUnusedCents: 1, newChargeCents: 1, amountDueNowCents: 0 })
  })

  it('adds tax to the new plan and credits what was paid, tax included', () => {
    const c = calculateProration({ ...base, oldPaidCents: 10_825, newPriceCents: 15_000, newTaxRateBps: 825 })
    expect(c).toMatchObject({ oldUnusedCents: 5413, newChargeBaseCents: 7500, newChargeTaxCents: 619, newChargeCents: 8119, amountDueNowCents: 2706, nextBillingBaseCents: 15_000, nextBillingTaxCents: 1238, nextBillingCents: 16_238 })
    expect(taxOn(7500, 825)).toBe(computeTotals([{ description: 'x', unitPriceCents: 7500, taxRateBps: 825 }]).taxCents)
  })

  it('starts a new period when the new plan bills on a different cycle', () => {
    const c = calculateProration({ ...base, sameCycle: false, oldPaidCents: 10_000, newPriceCents: 100_000, newPeriodEnd: new Date('2027-06-16T12:00:00Z') })
    expect(c).toMatchObject({ mode: 'restart_period', oldUnusedCents: 5000, newChargeCents: 100_000, amountDueNowCents: 95_000, nextBillingCents: 100_000 })
    expect(c.nextBillingDate).toBe('2027-06-16T12:00:00.000Z')
    // Yearly down to monthly: the unused months come back as credit.
    const down = calculateProration({ ...base, sameCycle: false, periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2027-01-01T00:00:00Z'), at: new Date('2026-07-02T00:00:00Z'), oldPaidCents: 120_000, newPriceCents: 12_000, newPeriodEnd: new Date('2026-08-02T00:00:00Z') })
    expect(down).toMatchObject({ totalDays: 365, usedDays: 182, remainingDays: 183, oldUnusedCents: 60_164, newChargeCents: 12_000, amountDueNowCents: 0, creditCents: 48_164 })
  })

  it('uses account credit before charging, and carries what is left', () => {
    expect(calculateProration({ ...base, oldPaidCents: 10_000, newPriceCents: 15_000, availableCreditCents: 1000 })).toMatchObject({ dueBeforeCreditCents: 2500, accountCreditAppliedCents: 1000, amountDueNowCents: 1500, creditCarriedCents: 0 })
    expect(calculateProration({ ...base, oldPaidCents: 10_000, newPriceCents: 15_000, availableCreditCents: 40_000 })).toMatchObject({ accountCreditAppliedCents: 2500, amountDueNowCents: 0, creditCarriedCents: 37_500, nextBillingAfterCreditCents: 0 })
    expect(calculateProration({ ...base, oldPaidCents: 15_000, newPriceCents: 10_000, availableCreditCents: 300 })).toMatchObject({ accountCreditAppliedCents: 0, creditCents: 2500, creditCarriedCents: 2800 })
  })

  it('charges nothing during a free trial, and nothing now when the change waits for the billing date', () => {
    expect(calculateProration({ ...base, inTrial: true, oldPaidCents: 0, newPriceCents: 15_000 })).toMatchObject({ mode: 'trial', oldUnusedCents: 0, newChargeCents: 0, amountDueNowCents: 0, creditCents: 0, nextBillingCents: 15_000 })
    expect(calculateScheduledChange({ at, tz: 'UTC', periodStart: base.periodStart, periodEnd: base.periodEnd, newPriceCents: 15_000, newTaxRateBps: 1000, availableCreditCents: 500 })).toMatchObject({ mode: 'next_period', amountDueNowCents: 0, creditCents: 0, nextBillingCents: 16_500, nextBillingAfterCreditCents: 16_000, effectiveAt: base.periodEnd.toISOString() })
  })

  it('spreads a second change in one period over the days the first one paid for', () => {
    // $100 to $150 on day 15 cost $75 for days 15 to 30. Back to $100 on day 20: 10 of those 15 days are unused.
    const c = calculateProration({ ...base, at: on(20), paidFrom: on(15), oldPaidCents: 7500, newPriceCents: 10_000 })
    expect(c).toMatchObject({ totalDays: 30, remainingDays: 10, oldUnusedCents: 5000, newChargeCents: 3333, creditCents: 1667, amountDueNowCents: 0 })
  })

  it('never produces a fraction of a cent, a negative amount, or figures that do not add up', () => {
    let seed = 20261007
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 4000; i++) {
      const total = 1 + rand(366)
      const c = calculateProration({
        tz: 'UTC', at: new Date(base.periodStart.getTime() + rand(total + 2) * DAY), periodStart: base.periodStart, periodEnd: new Date(base.periodStart.getTime() + total * DAY),
        oldPaidCents: rand(500_000), newPriceCents: rand(500_000), newTaxRateBps: rand(2500), sameCycle: rand(2) === 0, newPeriodEnd: base.newPeriodEnd, availableCreditCents: rand(3) ? 0 : rand(100_000),
      })
      for (const [name, value] of Object.entries(c)) if (typeof value === 'number') { expect(Number.isInteger(value), `${name} ${value}`).toBe(true); if (name !== 'netCents') expect(value, name).toBeGreaterThanOrEqual(0) }
      expect(c.dueBeforeCreditCents - c.creditCents).toBe(c.newChargeCents - c.oldUnusedCents)
      expect(c.dueBeforeCreditCents === 0 || c.creditCents === 0).toBe(true)
      expect(c.amountDueNowCents).toBe(c.dueBeforeCreditCents - c.accountCreditAppliedCents)
      expect(c.newChargeCents).toBe(c.newChargeBaseCents + c.newChargeTaxCents)
      expect(c.usedDays + c.remainingDays).toBe(c.totalDays)
    }
    for (const [amount, part, whole] of [[10_000, 1, 3], [1, 1, 2], [99, 364, 365], [7, 0, 30], [7, 30, 30], [7, 40, 30]] as const) {
      const p = prorate(amount, part, whole)
      expect(Number.isInteger(p) && p >= 0 && p <= amount).toBe(true)
    }
    expect([prorate(10_000, 1, 3), prorate(1, 1, 2), prorate(7, 0, 30), prorate(7, 40, 30)]).toEqual([3333, 1, 0, 7])
  })
})

// ---------------------------------------------------------------------------
// Plan changes
// ---------------------------------------------------------------------------

describe('changing plan', () => {
  it('upgrades mid-cycle: one invoice for the net amount, the billing date unchanged, and the preview matches what happens', async () => {
    const s = await midPeriod()
    const to = await planAt(15_000)
    const { preview, result } = await change(s, to.id)
    expect(preview).toMatchObject({ allowed: true, effective: 'now', from: { priceCents: 10_000 }, to: { priceCents: 15_000 }, basis: { from: 'invoice', paidCents: 10_000, assumed: false } })
    expect(preview.calc).toMatchObject({ remainingDays: 15, oldUnusedCents: 5000, newChargeCents: 7500, amountDueNowCents: 2500, creditCents: 0 })
    expect(result).toMatchObject({ status: 'applied', amountDueNowCents: 2500, creditCents: 0, nextBillingCents: 15_000, collect: false })
    expect(result.calc).toEqual(preview.calc)

    const m = await membershipOf(s.membershipId)
    expect(m).toMatchObject({ planId: to.id, priceCents: 15_000, status: 'active' })
    expect(m.currentPeriodEnd!.getTime()).toBe(s.end.getTime())
    expect(m.currentPeriodStart!.getTime()).toBe(s.start.getTime())
    const invoice = await invoiceOf(result.invoiceId!)
    expect(invoice).toMatchObject({ totalCents: 2500, status: 'open', membershipId: s.membershipId, memberId: s.member.id, periodStart: null })
    expect(invoice.items.map((i) => [i.type, i.amountCents])).toEqual([['membership', 7500], ['credit', -5000]])
    expect(invoice.items[0].description).toContain('15 of 30 days')
    // Exactly one live membership, the original paid invoice untouched, and a record of the change.
    expect(await prisma.membership.count({ where: { memberId: s.member.id, status: { in: ['active', 'trial', 'past_due', 'frozen'] } } })).toBe(1)
    expect(await invoiceOf(s.invoiceId)).toMatchObject({ status: 'paid', amountPaidCents: 10_000, refundedCents: 0 })
    const record = await prisma.planChange.findUniqueOrThrow({ where: { id: result.planChangeId } })
    expect(record).toMatchObject({ status: 'applied', effective: 'now', fromPlanId: s.plan.id, toPlanId: to.id, invoiceId: invoice.id, source: 'staff' })
    expect(record.calculation).toMatchObject({ amountDueNowCents: 2500, oldUnusedCents: 5000, newChargeCents: 7500 })
    expect(await prisma.activity.findFirst({ where: { memberId: s.member.id, type: 'membership_changed' } })).toBeTruthy()
  })

  it('charges the saved card exactly the amount the preview showed', async () => {
    const s = await midPeriod({ method: 'card' })
    const before = processor.charges.length
    const to = await planAt(15_000)
    const { preview, result } = await change(s, to.id)
    expect(result.collect).toBe(true)
    expect(preview.collection).toMatchObject({ automatic: true })
    expect((await collectInvoice({ ownerId: gym, invoiceId: result.invoiceId! })).status).toBe('succeeded')
    const charges = processor.charges.slice(before)
    expect(charges).toHaveLength(1)
    expect(charges[0].amountCents).toBe(preview.calc.amountDueNowCents)
    expect(charges[0].amountCents).toBe(2500)
    expect(await invoiceOf(result.invoiceId!)).toMatchObject({ status: 'paid', amountPaidCents: 2500 })
  })

  it('downgrades into account credit with no refund, and spends it on the next renewal', async () => {
    const s = await midPeriod({ priceCents: 15_000, method: 'card' })
    const to = await planAt(10_000)
    const { preview, result } = await change(s, to.id)
    expect(preview.calc).toMatchObject({ oldUnusedCents: 7500, newChargeCents: 5000, amountDueNowCents: 0, creditCents: 2500, nextBillingAfterCreditCents: 7500 })
    expect(result).toMatchObject({ amountDueNowCents: 0, creditCents: 2500, collect: false })
    // No cash moved: no refund at the processor, no refund recorded.
    expect(processor.refunds).toHaveLength(0)
    expect(await prisma.transaction.count({ where: { memberId: s.member.id, type: 'refund' } })).toBe(0)
    expect(await invoiceOf(result.invoiceId!)).toMatchObject({ totalCents: 0, status: 'paid' })
    expect(await balanceOf(s.member.id)).toBe(2500)
    const credit = await prisma.accountCredit.findUniqueOrThrow({ where: { id: result.creditId! } })
    expect(credit).toMatchObject({ source: 'proration', originalCents: 2500, remainingCents: 2500, autoApply: true, membershipId: s.membershipId, sourceInvoiceId: result.invoiceId })
    expect(credit.reason).toContain('Unused time')

    // The renewal: $100 due, $25 of it from the credit, $75 from the card.
    const charged = processor.charges.length
    const later = new Date(s.end.getTime() + 60_000)
    expect((await runMembershipBilling(gym, later)).errors).toEqual([])
    const renewal = await prisma.invoice.findFirstOrThrow({ where: { membershipId: s.membershipId, periodStart: s.end }, include: { transactions: true } })
    expect(renewal).toMatchObject({ totalCents: 10_000, amountPaidCents: 2500, status: 'open' })
    expect(renewal.transactions.map((t) => [t.method, t.amountCents])).toEqual([['account_credit', 2500]])
    await runCollections(gym, later)
    expect(processor.charges.slice(charged).filter((c) => c.invoiceId === renewal.id).map((c) => c.amountCents)).toEqual([7500])
    expect(await balanceOf(s.member.id)).toBe(0)
    const used = await prisma.creditApplication.findMany({ where: { creditId: credit.id } })
    expect(used).toHaveLength(1)
    expect(used[0]).toMatchObject({ kind: 'applied', amountCents: 2500, invoiceId: renewal.id })
    expect(used[0].transactionId).toBe(renewal.transactions[0].id)
  })

  it('carries a credit larger than the next invoice forward instead of losing or refunding it', async () => {
    const s = await midPeriod({ priceCents: 60_000, totalDays: 30, daysIn: 1 })
    const to = await planAt(1000)
    const { result } = await change(s, to.id)
    // 29 of 30 days of $600 unused is $580; 29 days of the $10 plan is $9.67.
    expect(result).toMatchObject({ creditCents: 57_033, amountDueNowCents: 0 })
    const later = new Date(s.end.getTime() + 60_000)
    await runMembershipBilling(gym, later)
    const renewal = await prisma.invoice.findFirstOrThrow({ where: { membershipId: s.membershipId, periodStart: s.end } })
    expect(renewal).toMatchObject({ totalCents: 1000, amountPaidCents: 1000, status: 'paid' })
    expect(await balanceOf(s.member.id)).toBe(56_033)
    expect((await prisma.accountCredit.findUniqueOrThrow({ where: { id: result.creditId! } })).remainingCents).toBe(56_033)
  })

  it('moves between plans of the same price with nothing to pay and no credit', async () => {
    const s = await midPeriod()
    const to = await planAt(10_000, { classLimit: 8 })
    const { result } = await change(s, to.id)
    expect(result).toMatchObject({ amountDueNowCents: 0, creditCents: 0, creditId: null })
    expect(await invoiceOf(result.invoiceId!)).toMatchObject({ totalCents: 0, status: 'paid', amountPaidCents: 0 })
    expect(await balanceOf(s.member.id)).toBe(0)
    expect((await membershipOf(s.membershipId)).planId).toBe(to.id)
  })

  it('keeps the member\'s own discount, and counts only the membership part of what they paid', async () => {
    // 20% off for life: $80 paid, and the $150 plan costs them $120.
    const s = await midPeriod({ discountPercent: 20 })
    const to = await planAt(15_000)
    const { preview } = await change(s, to.id)
    expect(preview).toMatchObject({ from: { priceCents: 8000 }, to: { priceCents: 12_000 }, basis: { paidCents: 8000 } })
    expect(preview.calc).toMatchObject({ oldUnusedCents: 4000, newChargeCents: 6000, amountDueNowCents: 2000, nextBillingCents: 12_000 })
    expect(await membershipOf(s.membershipId)).toMatchObject({ priceCents: 12_000, discountPercent: 20 })

    // An enrollment fee and a coupon on the first invoice: the fee is not "unused membership", and the coupon is shared out.
    const plan = await planAt(10_000, { enrollmentFeeCents: 5000 })
    const coupon = await prisma.coupon.create({ data: { ownerId: gym, code: `HALF${randomUUID().slice(0, 6).toUpperCase()}`, amountOffCents: 3000, appliesTo: 'memberships' } })
    const member = await createMember(gym)
    const at = noon()
    const start = new Date(at.getTime() - 15 * DAY)
    const sale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: member.id, planId: plan.id, paymentMethod: 'cash', startDate: start, couponCode: coupon.code }))
    const end = new Date(start.getTime() + 30 * DAY)
    await prisma.membership.update({ where: { id: sale.membership.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } })
    await prisma.invoice.update({ where: { id: sale.invoice!.id }, data: { periodStart: start, periodEnd: end } })
    expect(sale.invoice!.totalCents).toBe(12_000)
    await tx((db) => recordPayment(db, { ownerId: gym, invoiceId: sale.invoice!.id, method: 'cash' }))
    const p = await previewPlanChange({ ownerId: gym, membershipId: sale.membership.id, planId: to.id, effective: 'now', source: 'staff', at })
    // $120 paid, two thirds of it for the membership: $80, half of it unused.
    expect(p.basis.paidCents).toBe(8000)
    expect(p.calc.oldUnusedCents).toBe(4000)
  })

  it('credits less when part of the period was refunded', async () => {
    const s = await midPeriod({ method: 'card' })
    const payment = (await invoiceOf(s.invoiceId)).transactions[0]
    await refundPayment({ ownerId: gym, transactionId: payment.id, amountCents: 4000 })
    const p = await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: (await planAt(15_000)).id, effective: 'now', source: 'staff', at: s.at })
    expect(p.basis.paidCents).toBe(6000)
    expect(p.calc).toMatchObject({ oldUnusedCents: 3000, newChargeCents: 7500, amountDueNowCents: 4500 })
  })

  it('restarts the period when the billing cycle changes', async () => {
    const s = await midPeriod()
    const yearly = await planAt(100_000, { billingInterval: 'year' })
    const { preview, result } = await change(s, yearly.id)
    expect(preview.calc).toMatchObject({ mode: 'restart_period', oldUnusedCents: 5000, newChargeCents: 100_000, amountDueNowCents: 95_000 })
    const m = await membershipOf(s.membershipId)
    expect(m.currentPeriodStart!.getTime()).toBe(s.at.getTime())
    expect(m.currentPeriodEnd!.toISOString()).toBe(preview.calc.nextBillingDate)
    expect(m.currentPeriodEnd!.getUTCFullYear()).toBe(s.at.getUTCFullYear() + 1)
    expect(await invoiceOf(result.invoiceId!)).toMatchObject({ totalCents: 95_000, periodStart: s.at })
    // The renewal job does not bill the new period a second time.
    await runMembershipBilling(gym, new Date(s.end.getTime() + DAY))
    expect(await prisma.invoice.count({ where: { membershipId: s.membershipId } })).toBe(2)
  })

  it('prorates a second change in the same period from what the first one charged', async () => {
    const s = await midPeriod({ daysIn: 10 })
    const up = await planAt(15_000)
    const first = await change(s, up.id)
    expect(first.result.amountDueNowCents).toBe(3333)
    // Unpaid, a further change is refused.
    const blocked = await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: s.plan.id, effective: 'now', source: 'staff', at: s.at })
    expect(blocked).toMatchObject({ allowed: false, blocked: { code: 'unpaid_invoice' } })
    await tx((db) => recordPayment(db, { ownerId: gym, invoiceId: first.result.invoiceId!, method: 'cash' }))
    // Five days later, back down: 15 of the 20 days the first change paid for are unused.
    const at = new Date(s.at.getTime() + 5 * DAY)
    const second = await change({ ...s, at }, s.plan.id)
    expect(second.preview.basis).toMatchObject({ from: 'plan_change', paidCents: 10_000 })
    expect(second.preview.calc).toMatchObject({ remainingDays: 15, oldUnusedCents: 7500, newChargeCents: 5000, creditCents: 2500 })
    // Paid $100 + $33.33; used 10 days at $100 and 5 at $150 ($58.33), has 15 days at $100 ahead ($50): $25 over.
    expect(await balanceOf(s.member.id)).toBe(2500)
  })

  it('does nothing twice for a repeated request, and refuses a reused key for a different request', async () => {
    const s = await midPeriod()
    const to = await planAt(15_000)
    const preview = await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at })
    const input: ApplyInput = { ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at, expected: { fromPlanId: preview.from.id, amountDueNowCents: 2500, creditCents: 0 }, idempotencyKey: key() }
    const first = await applyPlanChange(input)
    const again = await applyPlanChange(input)
    const third = await applyPlanChange(input)
    expect(first.replayed).toBe(false)
    expect(again).toMatchObject({ replayed: true, planChangeId: first.planChangeId, invoiceId: first.invoiceId, amountDueNowCents: 2500 })
    expect(third.planChangeId).toBe(first.planChangeId)
    expect(await prisma.planChange.count({ where: { membershipId: s.membershipId } })).toBe(1)
    expect(await prisma.invoice.count({ where: { membershipId: s.membershipId } })).toBe(2)
    await expect(applyPlanChange({ ...input, planId: (await planAt(20_000)).id })).rejects.toMatchObject({ status: 409, code: 'idempotency_key_reused' })
    // A fresh key for the same change is a second attempt, and is refused because it has been made.
    await expect(applyPlanChange({ ...input, idempotencyKey: key() })).rejects.toMatchObject({ status: 409, code: 'plan_already_changed' })
  })

  it('lets exactly one of several simultaneous changes through, with one invoice and one live membership', async () => {
    for (let round = 0; round < 3; round++) {
      const s = await midPeriod({ method: 'card' })
      const targets = [await planAt(15_000), await planAt(20_000), await planAt(5000)]
      const previews = await Promise.all(targets.map((t) => previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: t.id, effective: 'now', source: 'staff', at: s.at })))
      // Two people pick different plans, and one of them double-clicks with a new key each time.
      const attempts = [0, 0, 1, 2, 2].map((i) => applyPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: targets[i].id, effective: 'now', source: 'staff', at: s.at, expected: { fromPlanId: previews[i].from.id, amountDueNowCents: previews[i].calc.amountDueNowCents, creditCents: previews[i].calc.creditCents }, idempotencyKey: key() }))
      const results = await Promise.allSettled(attempts)
      const won = results.filter((r) => r.status === 'fulfilled')
      expect(won, `round ${round}`).toHaveLength(1)
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ status: 409, code: 'plan_already_changed' })
      expect(await prisma.planChange.count({ where: { membershipId: s.membershipId, status: 'applied' } })).toBe(1)
      expect(await prisma.invoice.count({ where: { membershipId: s.membershipId } })).toBeLessThanOrEqual(2)
      expect(await prisma.membership.count({ where: { memberId: s.member.id, status: { in: ['active', 'trial', 'past_due', 'frozen'] } } })).toBe(1)
      expect(await prisma.accountCredit.count({ where: { memberId: s.member.id } })).toBeLessThanOrEqual(1)
      const m = await membershipOf(s.membershipId)
      expect(m.currentPeriodEnd!.getTime()).toBe(s.end.getTime())
    }
  })

  it('treats a double click with the same key as one change and one charge', async () => {
    const s = await midPeriod({ method: 'card' })
    const to = await planAt(15_000)
    const preview = await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at })
    const input: ApplyInput = { ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at, expected: { fromPlanId: preview.from.id, amountDueNowCents: 2500, creditCents: 0 }, idempotencyKey: key() }
    const before = processor.charges.length
    const results = await Promise.all(Array.from({ length: 6 }, () => applyPlanChange(input)))
    expect(new Set(results.map((r) => r.planChangeId)).size).toBe(1)
    expect(results.filter((r) => !r.replayed)).toHaveLength(1)
    // Every caller then tries to collect, as the route does: the card is charged once.
    await Promise.all(results.map((r) => collectInvoice({ ownerId: gym, invoiceId: r.invoiceId! })))
    expect(processor.charges.slice(before)).toHaveLength(1)
    expect(await invoiceOf(results[0].invoiceId!)).toMatchObject({ status: 'paid', amountPaidCents: 2500 })
    expect(await prisma.transaction.count({ where: { invoiceId: results[0].invoiceId!, status: 'succeeded' } })).toBe(1)
  })

  it('refuses to go ahead when the figures are no longer the ones that were confirmed', async () => {
    const s = await midPeriod()
    const to = await planAt(15_000)
    const stale = applyPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at, expected: { fromPlanId: s.plan.id, amountDueNowCents: 2400, creditCents: 0 }, idempotencyKey: key() })
    await expect(stale).rejects.toMatchObject({ status: 409, code: 'preview_changed' })
    // A day later the amount is different; yesterday's confirmation is not good enough.
    const tomorrow = applyPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: new Date(s.at.getTime() + DAY), expected: { fromPlanId: s.plan.id, amountDueNowCents: 2500, creditCents: 0 }, idempotencyKey: key() })
    await expect(tomorrow).rejects.toMatchObject({ code: 'preview_changed', details: { preview: { calc: { amountDueNowCents: 2333 } } } })
    expect(await membershipOf(s.membershipId)).toMatchObject({ planId: s.plan.id, priceCents: 10_000 })
    expect(await prisma.invoice.count({ where: { membershipId: s.membershipId } })).toBe(1)
    expect(await prisma.planChange.count({ where: { membershipId: s.membershipId } })).toBe(0)
  })

  it('says why a change cannot go ahead, and changes nothing', async () => {
    const to = await planAt(15_000)
    const blockedBy = async (s: { membershipId: string; at: Date }, planId = to.id, source: 'staff' | 'member' = 'staff') => (await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId, effective: 'now', source, at: s.at })).blocked?.code

    const unpaid = await midPeriod({ paid: false })
    expect(await blockedBy(unpaid)).toBe('unpaid_invoice')
    const same = await midPeriod()
    expect(await blockedBy(same, same.plan.id)).toBe('same_plan')
    const frozen = await midPeriod()
    await prisma.membership.update({ where: { id: frozen.membershipId }, data: { status: 'frozen' } })
    expect(await blockedBy(frozen)).toBe('frozen')
    const pastDue = await midPeriod()
    await prisma.membership.update({ where: { id: pastDue.membershipId }, data: { status: 'past_due' } })
    expect(await blockedBy(pastDue)).toBe('past_due')
    const ended = await midPeriod()
    await prisma.membership.update({ where: { id: ended.membershipId }, data: { status: 'cancelled' } })
    expect(await blockedBy(ended)).toBe('already_ended')
    const cancelling = await midPeriod()
    await prisma.membership.update({ where: { id: cancelling.membershipId }, data: { cancelAt: cancelling.end } })
    expect(await blockedBy(cancelling)).toBe('cancelling')
    const due = await midPeriod({ daysIn: 30 })
    expect(await blockedBy({ ...due, at: new Date(due.end.getTime() + 1000) })).toBe('renewal_due')
    const ok = await midPeriod()
    expect(await blockedBy(ok, (await planAt(5000, { type: 'class_pack', credits: 5 })).id)).toBe('not_recurring')
    expect(await blockedBy(ok, (await planAt(7000, { isActive: false })).id)).toBe('plan_inactive')
    // Another gym's plan, and for a member a plan that is not offered publicly, simply do not exist.
    await expect(previewPlanChange({ ownerId: gym, membershipId: ok.membershipId, planId: (await planAt(15_000, {}, other)).id, effective: 'now', source: 'staff' })).rejects.toMatchObject({ status: 404 })
    await expect(previewPlanChange({ ownerId: gym, membershipId: ok.membershipId, planId: (await planAt(9000, { isPublic: false })).id, effective: 'now', source: 'member' })).rejects.toMatchObject({ status: 404 })
    await expect(previewPlanChange({ ownerId: other, membershipId: ok.membershipId, planId: to.id, effective: 'now', source: 'staff' })).rejects.toMatchObject({ status: 404 })

    await expect(applyPlanChange({ ownerId: gym, membershipId: unpaid.membershipId, planId: to.id, effective: 'now', source: 'staff', at: unpaid.at, expected: { fromPlanId: unpaid.plan.id, amountDueNowCents: 7500, creditCents: 0 }, idempotencyKey: key() })).rejects.toMatchObject({ status: 409, code: 'unpaid_invoice' })
    expect((await membershipOf(unpaid.membershipId)).planId).toBe(unpaid.plan.id)
  })

  it('lets staff go ahead when the period was billed outside ClubCheck, clearly marked, and not a member', async () => {
    const s = await midPeriod()
    await prisma.invoice.update({ where: { id: s.invoiceId }, data: { membershipId: null } })
    const to = await planAt(15_000)
    const staff = await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at })
    expect(staff).toMatchObject({ allowed: true, basis: { assumed: true, from: 'assumed', paidCents: 10_000, invoiceNumber: null } })
    expect(staff.basis.note).toContain('No invoice is on record')
    expect(await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'member', at: s.at })).toMatchObject({ allowed: false, blocked: { code: 'no_invoice' } })
  })

  it('changes plan in a free trial without charging, and bills the new plan when the trial ends', async () => {
    const plan = await planAt(10_000, { trialDays: 14 })
    const member = await createMember(gym)
    const start = new Date(noon().getTime() - 3 * DAY)
    const sale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: member.id, planId: plan.id, paymentMethod: 'cash', startDate: start }))
    expect(sale.membership.status).toBe('trial')
    const to = await planAt(15_000)
    const { preview, result } = await change({ ownerId: gym, membershipId: sale.membership.id, at: noon() }, to.id)
    expect(preview.calc).toMatchObject({ mode: 'trial', amountDueNowCents: 0, creditCents: 0, nextBillingCents: 15_000 })
    expect(result).toMatchObject({ invoiceId: null, creditId: null })
    expect(await membershipOf(sale.membership.id)).toMatchObject({ status: 'trial', planId: to.id, priceCents: 15_000 })
    await runMembershipBilling(gym, new Date(start.getTime() + 14 * DAY + 60_000))
    const first = await prisma.invoice.findFirstOrThrow({ where: { membershipId: sale.membership.id } })
    expect(first.totalCents).toBe(15_000)
  })

  it('schedules a change for the next billing date: nothing now, the new price on the next invoice, and it can be withdrawn', async () => {
    const s = await midPeriod()
    const to = await planAt(5000)
    const { preview, result } = await change(s, to.id, { effective: 'next_period' })
    expect(preview.calc).toMatchObject({ mode: 'next_period', amountDueNowCents: 0, creditCents: 0, nextBillingCents: 5000 })
    expect(result).toMatchObject({ status: 'scheduled', invoiceId: null, creditId: null })
    expect(await membershipOf(s.membershipId)).toMatchObject({ planId: s.plan.id, priceCents: 10_000, pendingPlanId: to.id })
    expect(await prisma.invoice.count({ where: { membershipId: s.membershipId } })).toBe(1)
    expect(await balanceOf(s.member.id)).toBe(0)
    expect((await previewPlanChange({ ownerId: gym, membershipId: s.membershipId, planId: to.id, effective: 'now', source: 'staff', at: s.at })).scheduled).toMatchObject({ planId: to.id })

    // Changed their mind, then changed it back.
    await tx((db) => cancelScheduledPlanChange(db, { ownerId: gym, membershipId: s.membershipId }))
    expect((await membershipOf(s.membershipId)).pendingPlanId).toBeNull()
    await expect(tx((db) => cancelScheduledPlanChange(db, { ownerId: gym, membershipId: s.membershipId }))).rejects.toMatchObject({ code: 'nothing_scheduled' })
    await expect(tx((db) => cancelScheduledPlanChange(db, { ownerId: other, membershipId: s.membershipId }))).rejects.toMatchObject({ status: 404 })
    await change(s, to.id, { effective: 'next_period' })
    expect(await prisma.planChange.count({ where: { membershipId: s.membershipId, status: 'scheduled' } })).toBe(1)

    // At the billing date the plan switches and the invoice is for the new price. Running it again changes nothing.
    const later = new Date(s.end.getTime() + 60_000)
    await runMembershipBilling(gym, later)
    await runMembershipBilling(gym, later)
    expect(await membershipOf(s.membershipId)).toMatchObject({ planId: to.id, priceCents: 5000, pendingPlanId: null })
    const invoices = await prisma.invoice.findMany({ where: { membershipId: s.membershipId }, orderBy: { createdAt: 'asc' } })
    expect(invoices.map((i) => i.totalCents)).toEqual([10_000, 5000])
    expect(await prisma.planChange.count({ where: { membershipId: s.membershipId, status: 'applied' } })).toBe(1)
  })

  it('uses account credit the member already has before asking for money', async () => {
    const s = await midPeriod()
    await tx((db) => grantCredit(db, { ownerId: gym, memberId: s.member.id, amountCents: 1000, source: 'staff', reason: 'Goodwill' }))
    const held = await tx((db) => grantCredit(db, { ownerId: gym, memberId: s.member.id, amountCents: 9000, source: 'staff', reason: 'Held for a refund', autoApply: false }))
    const { preview, result } = await change(s, (await planAt(15_000)).id)
    // Only the credit marked for automatic use counts.
    expect(preview.calc).toMatchObject({ dueBeforeCreditCents: 2500, accountCreditAppliedCents: 1000, amountDueNowCents: 1500, creditCarriedCents: 0 })
    expect(result.accountCreditAppliedCents).toBe(1000)
    expect(await invoiceOf(result.invoiceId!)).toMatchObject({ totalCents: 2500, amountPaidCents: 1000, status: 'open' })
    expect((await prisma.accountCredit.findUniqueOrThrow({ where: { id: held.credit.id } })).remainingCents).toBe(9000)
    expect(await balanceOf(s.member.id)).toBe(9000)
  })
})

// ---------------------------------------------------------------------------
// Account credit
// ---------------------------------------------------------------------------

describe('account credit', () => {
  const openInvoice = async (memberId: string, cents: number, ownerId = gym) => {
    const { createInvoice } = await import('@/lib/services/payments')
    return tx((db) => createInvoice(db, { ownerId, memberId, items: [{ description: 'Test charge', unitPriceCents: cents }] }))
  }

  it('records every credit with what it was for and who added it, and every use with where it went', async () => {
    const member = await createMember(gym)
    const actor = { type: 'staff' as const, id: randomUUID(), name: 'Alex Accountant' }
    const a = await tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 3000, source: 'staff', reason: 'Class cancelled twice', actor }))
    const b = await tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 2000, source: 'staff', reason: 'Referral thank-you', actor }))
    expect(a.credit).toMatchObject({ originalCents: 3000, remainingCents: 3000, source: 'staff', reason: 'Class cancelled twice', createdByName: 'Alex Accountant', createdById: actor.id })
    expect(a.transaction).toMatchObject({ type: 'credit', amountCents: 3000, method: 'account_credit' })
    expect(await balanceOf(member.id)).toBe(5000)

    // Spent oldest first, across two credits, on one invoice.
    const invoice = await openInvoice(member.id, 4000)
    const payment = await tx((db) => recordPayment(db, { ownerId: gym, invoiceId: invoice.id, method: 'account_credit', actor }))
    expect(await balanceOf(member.id)).toBe(1000)
    const view = await listCredits(prisma, gym, member.id)
    expect(view).toMatchObject({ balanceCents: 1000, unitemisedCents: 0 })
    const [newer, older] = view.credits
    expect(older).toMatchObject({ id: a.credit.id, originalCents: 3000, remainingCents: 0, usedCents: 3000 })
    expect(newer).toMatchObject({ id: b.credit.id, originalCents: 2000, remainingCents: 1000, usedCents: 1000 })
    expect(older.uses).toEqual([expect.objectContaining({ kind: 'applied', amountCents: 3000, invoiceId: invoice.id, invoiceNumber: invoice.number, byName: 'Alex Accountant' })])
    expect(newer.uses[0]).toMatchObject({ amountCents: 1000, invoiceNumber: invoice.number })
    expect((await prisma.creditApplication.findMany({ where: { invoiceId: invoice.id } })).every((u) => u.transactionId === payment.id)).toBe(true)

    // Taken back by staff: recorded as removed, and never below zero.
    await tx((db) => adjustCredit(db, { ownerId: gym, memberId: member.id, amountCents: -400, note: 'Added by mistake', actor }))
    expect(await balanceOf(member.id)).toBe(600)
    expect((await listCredits(prisma, gym, member.id)).credits[0].uses.at(-1)).toMatchObject({ kind: 'removed', amountCents: 400, note: 'Added by mistake' })
    await expect(tx((db) => adjustCredit(db, { ownerId: gym, memberId: member.id, amountCents: -601 }))).rejects.toMatchObject({ status: 400 })
    await expect(tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 0, source: 'staff' }))).rejects.toMatchObject({ status: 400 })
    await expect(tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 10.5, source: 'staff' }))).rejects.toMatchObject({ status: 400 })
    await expect(tx((db) => grantCredit(db, { ownerId: other, memberId: member.id, amountCents: 100, source: 'staff' }))).rejects.toMatchObject({ status: 404 })
    expect(await balanceOf(member.id)).toBe(600)
  })

  it('keeps the balance equal to what the credits add up to, including a balance from before credits were itemised', async () => {
    const member = await createMember(gym, { creditBalanceCents: 2500 })
    expect(await listCredits(prisma, gym, member.id)).toMatchObject({ balanceCents: 2500, unitemisedCents: 2500, autoApplyCents: 0, credits: [] })
    // It is not spent automatically (it never was), but staff can use it, and once touched it is itemised.
    const invoice = await openInvoice(member.id, 1000)
    expect(await tx((db) => applyCreditsToInvoice(db, { ownerId: gym, invoiceId: invoice.id }))).toBe(0)
    await tx((db) => recordPayment(db, { ownerId: gym, invoiceId: invoice.id, method: 'account_credit' }))
    const view = await listCredits(prisma, gym, member.id)
    expect(view).toMatchObject({ balanceCents: 1500, unitemisedCents: 0 })
    expect(view.credits).toEqual([expect.objectContaining({ source: 'opening_balance', originalCents: 2500, remainingCents: 1500, autoApply: false })])
    await tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 700, source: 'staff' }))
    const sum = await prisma.accountCredit.aggregate({ where: { memberId: member.id }, _sum: { remainingCents: true } })
    expect(sum._sum.remainingCents).toBe(2200)
    expect(await balanceOf(member.id)).toBe(2200)
  })

  it('never spends the same credit twice when two payments race for it', async () => {
    const member = await createMember(gym)
    await tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 5000, source: 'staff' }))
    const invoices = await Promise.all([openInvoice(member.id, 4000), openInvoice(member.id, 4000), openInvoice(member.id, 4000)])
    const results = await Promise.allSettled(invoices.map((i) => tx((db) => recordPayment(db, { ownerId: gym, invoiceId: i.id, method: 'account_credit' }))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'insufficient_credit' })
    expect(await balanceOf(member.id)).toBe(1000)
    expect((await prisma.accountCredit.findMany({ where: { memberId: member.id } })).map((c) => c.remainingCents)).toEqual([1000])
    expect(await prisma.creditApplication.aggregate({ where: { credit: { memberId: member.id } }, _sum: { amountCents: true } })).toMatchObject({ _sum: { amountCents: 4000 } })
  })

  it('holds a credit back from automatic use when staff say so, and puts credit back when a credit payment is refunded', async () => {
    const member = await createMember(gym)
    const { credit } = await tx((db) => grantCredit(db, { ownerId: gym, memberId: member.id, amountCents: 3000, source: 'staff' }))
    await setCreditAutoApply(prisma, { ownerId: gym, creditId: credit.id, autoApply: false })
    await expect(setCreditAutoApply(prisma, { ownerId: other, creditId: credit.id, autoApply: true })).rejects.toMatchObject({ status: 404 })
    expect(await creditAvailable(prisma, gym, member.id)).toEqual({ totalCents: 3000, autoCents: 0 })
    const invoice = await openInvoice(member.id, 2000)
    expect(await tx((db) => applyCreditsToInvoice(db, { ownerId: gym, invoiceId: invoice.id }))).toBe(0)
    await setCreditAutoApply(prisma, { ownerId: gym, creditId: credit.id, autoApply: true })
    expect(await tx((db) => applyCreditsToInvoice(db, { ownerId: gym, invoiceId: invoice.id }))).toBe(2000)
    expect(await tx((db) => applyCreditsToInvoice(db, { ownerId: gym, invoiceId: invoice.id }))).toBe(0)
    expect(await balanceOf(member.id)).toBe(1000)

    // Refunding a payment that was made with credit returns credit, as a new itemised credit, not cash.
    const payment = (await invoiceOf(invoice.id)).transactions[0]
    const refund = await refundPayment({ ownerId: gym, transactionId: payment.id, amountCents: 1500, reason: 'Charged for the wrong thing' })
    expect(processor.refunds).toHaveLength(0)
    expect(refund).toMatchObject({ amountCents: 1500, remainingRefundableCents: 500 })
    expect(await balanceOf(member.id)).toBe(2500)
    expect(await prisma.accountCredit.findUniqueOrThrow({ where: { id: refund.creditId! } })).toMatchObject({ source: 'refund', originalCents: 1500, sourceInvoiceId: invoice.id })
    await expect(tx((db) => drawCredit(db, { ownerId: gym, memberId: member.id, amountCents: 2501, kind: 'removed' }))).rejects.toMatchObject({ code: 'insufficient_credit' })
  })
})

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

describe('partial refunds', () => {
  const paid = async (method: 'card' | 'cash' = 'card') => {
    const s = await midPeriod({ method })
    const payment = (await invoiceOf(s.invoiceId)).transactions.find((t) => t.status === 'succeeded')!
    return { ...s, payment }
  }
  const paymentOf = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id }, include: { refunds: { orderBy: { createdAt: 'asc' } } } })

  it('refunds part, then more, then the rest, and never more than was taken', async () => {
    const s = await paid()
    const first = await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 2000, refundReason: 'service_issue', reason: 'Class was cancelled' })
    expect(first).toMatchObject({ amountCents: 2000, status: 'succeeded', destination: 'original', originalCents: 10_000, previouslyRefundedCents: 0, totalRefundedCents: 2000, remainingRefundableCents: 8000, fullyRefunded: false })
    const second = await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 3000 })
    expect(second).toMatchObject({ previouslyRefundedCents: 2000, totalRefundedCents: 5000, remainingRefundableCents: 5000, fullyRefunded: false })
    await expect(refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 5001 })).rejects.toMatchObject({ status: 400, code: 'refund_too_large' })
    for (const bad of [0, -100, 10.5]) await expect(refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: bad })).rejects.toMatchObject({ status: 400 })
    // With no amount, the rest.
    const rest = await refundPayment({ ownerId: gym, transactionId: s.payment.id })
    expect(rest).toMatchObject({ amountCents: 5000, totalRefundedCents: 10_000, remainingRefundableCents: 0, fullyRefunded: true })
    await expect(refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 1 })).rejects.toMatchObject({ code: 'already_refunded' })

    const payment = await paymentOf(s.payment.id)
    // The original payment is still there, still succeeded, with its refunds hanging off it.
    expect(payment).toMatchObject({ type: 'payment', status: 'succeeded', amountCents: 10_000, refundedCents: 10_000 })
    expect(payment.refunds.map((r) => [r.type, r.amountCents, r.status])).toEqual([['refund', 2000, 'succeeded'], ['refund', 3000, 'succeeded'], ['refund', 5000, 'succeeded']])
    expect(payment.refunds[0]).toMatchObject({ refundReason: 'service_issue', note: 'Class was cancelled', invoiceId: s.invoiceId, memberId: s.member.id })
    expect(processor.refunds.map((r) => [r.reference, r.amountCents])).toEqual([[s.payment.providerReference, 2000], [s.payment.providerReference, 3000], [s.payment.providerReference, 5000]])
    expect(new Set(payment.refunds.map((r) => r.providerReference)).size).toBe(3)
    expect(await invoiceOf(s.invoiceId)).toMatchObject({ status: 'paid', amountPaidCents: 10_000, refundedCents: 10_000 })
    expect(await prisma.activity.count({ where: { memberId: s.member.id, type: 'refund' } })).toBe(3)
  })

  it('returns the first refund for a repeated request instead of making another', async () => {
    const s = await paid()
    const idempotencyKey = key()
    const input = { ownerId: gym, transactionId: s.payment.id, amountCents: 2500, idempotencyKey }
    const first = await refundPayment(input)
    const again = await refundPayment(input)
    expect(again).toMatchObject({ replayed: true, refundId: first.refundId, totalRefundedCents: 2500 })
    expect(processor.refunds).toHaveLength(1)
    // A double click: the same key, at the same moment.
    const second = key()
    const results = await Promise.all(Array.from({ length: 5 }, () => refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 1000, idempotencyKey: second })))
    expect(new Set(results.map((r) => r.refundId)).size).toBe(1)
    expect(processor.refunds).toHaveLength(2)
    expect(await paymentOf(s.payment.id)).toMatchObject({ refundedCents: 3500 })
    expect((await paymentOf(s.payment.id)).refunds).toHaveLength(2)
    // The same key for a different amount is a mistake, not a retry.
    await expect(refundPayment({ ...input, amountCents: 2600 })).rejects.toMatchObject({ status: 409, code: 'idempotency_key_reused' })
    // The key belongs to the gym that used it.
    const elsewhere = await midPeriod({ method: 'cash', ownerId: other })
    const theirs = (await invoiceOf(elsewhere.invoiceId)).transactions[0]
    expect(await refundPayment({ ownerId: other, transactionId: theirs.id, amountCents: 100, idempotencyKey })).toMatchObject({ replayed: false, amountCents: 100 })
  })

  it('lets simultaneous refunds through only up to what is left, on card and cash alike', async () => {
    for (const method of ['card', 'cash'] as const) {
      const s = await paid(method)
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 6000, idempotencyKey: key() })))
      expect(results.filter((r) => r.status === 'fulfilled'), method).toHaveLength(1)
      const payment = await paymentOf(s.payment.id)
      expect(payment.refundedCents).toBe(6000)
      expect(payment.refunds).toHaveLength(1)
      expect((await invoiceOf(s.invoiceId)).refundedCents).toBe(6000)
      // Several smaller ones at once: they fit until they do not.
      const more = await Promise.allSettled(Array.from({ length: 6 }, () => refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 1500, idempotencyKey: key() })))
      expect(more.filter((r) => r.status === 'fulfilled'), method).toHaveLength(2)
      const after = await paymentOf(s.payment.id)
      expect(after.refundedCents).toBe(9000)
      expect(after.refunds.reduce((sum, r) => sum + r.amountCents, 0)).toBe(9000)
      expect(after.refundedCents).toBeLessThanOrEqual(after.amountCents)
    }
  })

  it('can keep a refund on the account as credit instead of sending money back', async () => {
    const s = await paid()
    const refund = await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 3000, destination: 'credit', refundReason: 'requested', reason: 'Prefers credit' })
    expect(refund).toMatchObject({ destination: 'credit', amountCents: 3000, remainingRefundableCents: 7000 })
    expect(processor.refunds).toHaveLength(0)
    expect(await balanceOf(s.member.id)).toBe(3000)
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: refund.refundId } })).toMatchObject({ type: 'refund', method: 'account_credit', provider: 'manual', amountCents: 3000 })
    expect(await prisma.accountCredit.findUniqueOrThrow({ where: { id: refund.creditId! } })).toMatchObject({ source: 'refund', originalCents: 3000, sourceTransactionId: refund.refundId })
    // The rest can still go back to the card, and the two together cannot pass the payment.
    await expect(refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 7001 })).rejects.toMatchObject({ code: 'refund_too_large' })
    expect((await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 7000 })).fullyRefunded).toBe(true)
  })

  it('follows a pending refund to its end, and puts the money back on the payment if it fails', async () => {
    const s = await paid()
    processor.refundStatus = 'pending'
    const pending = await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 4000 })
    expect(pending.status).toBe('pending')
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: pending.refundId } })
    // While it is pending the amount is spoken for: it cannot be refunded again.
    await expect(refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 6001 })).rejects.toMatchObject({ code: 'refund_too_large' })
    // Stripe reports success, more than once.
    for (let i = 0; i < 3; i++) await recordExternalRefund({ ownerId: gym, paymentReference: s.payment.providerReference!, refundReference: row.providerReference!, amountCents: 4000, status: 'succeeded' })
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('succeeded')
    expect(await paymentOf(s.payment.id)).toMatchObject({ refundedCents: 4000 })
    expect((await paymentOf(s.payment.id)).refunds).toHaveLength(1)

    // A second refund that the bank later fails.
    const failing = await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 2000 })
    const failingRow = await prisma.transaction.findUniqueOrThrow({ where: { id: failing.refundId } })
    expect(await paymentOf(s.payment.id)).toMatchObject({ refundedCents: 6000 })
    for (let i = 0; i < 3; i++) await recordRefundFailure({ ownerId: gym, refundReference: failingRow.providerReference!, failureReason: 'The bank could not complete the refund' })
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: failingRow.id } })).toMatchObject({ status: 'failed', failureReason: 'The bank could not complete the refund' })
    // Reversed once, not three times, and staff are told once.
    expect(await paymentOf(s.payment.id)).toMatchObject({ refundedCents: 4000 })
    expect((await invoiceOf(s.invoiceId)).refundedCents).toBe(4000)
    expect(await prisma.notification.count({ where: { ownerId: gym, type: 'refund_failed', body: { contains: 'could not complete' } } })).toBeGreaterThanOrEqual(1)
    expect(await prisma.activity.count({ where: { memberId: s.member.id, type: 'refund', title: { contains: 'failed' } } })).toBe(1)
    // A late "succeeded" for the failed one changes nothing, and the money can be refunded again.
    await recordExternalRefund({ ownerId: gym, paymentReference: s.payment.providerReference!, refundReference: failingRow.providerReference!, amountCents: 2000, status: 'succeeded' })
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: failingRow.id } })).status).toBe('failed')
    expect(await recordRefundFailure({ ownerId: other, refundReference: failingRow.providerReference! })).toBeNull()
    processor.refundStatus = 'succeeded'
    // At Stripe a failed refund's money is back on the charge.
    processor.held.set(s.payment.providerReference!, 6000)
    expect((await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 6000 })).fullyRefunded).toBe(true)
  })

  it('records a refund made in the Stripe dashboard once, however many times the webhook arrives', async () => {
    const s = await paid()
    const reference = `re_${randomUUID()}`
    for (let i = 0; i < 4; i++) await recordExternalRefund({ ownerId: gym, paymentReference: s.payment.providerReference!, refundReference: reference, amountCents: 1200, status: 'succeeded' })
    await Promise.all(Array.from({ length: 4 }, () => recordExternalRefund({ ownerId: gym, paymentReference: s.payment.providerReference!, refundReference: `re_same_${s.payment.id}`, amountCents: 800, status: 'succeeded' })))
    const payment = await paymentOf(s.payment.id)
    expect(payment.refundedCents).toBe(2000)
    expect(payment.refunds.map((r) => r.amountCents).sort()).toEqual([1200, 800].sort())
    // Another gym quoting this payment's Stripe id gets nothing.
    expect(await recordExternalRefund({ ownerId: other, paymentReference: s.payment.providerReference!, refundReference: `re_${randomUUID()}`, amountCents: 500 })).toBeNull()
    expect((await paymentOf(s.payment.id)).refundedCents).toBe(2000)
  })

  it('marks a shop order partly refunded, then refunded, and back again if a refund fails', async () => {
    const { checkout } = await import('@/lib/services/pos')
    const product = await prisma.product.create({ data: { ownerId: gym, name: 'Protein tub', priceCents: 4000, stock: 10 } })
    const sale = await tx((db) => checkout(db, { ownerId: gym, items: [{ productId: product.id, quantity: 2 }], paymentMethod: 'cash' } as any))
    const payment = await prisma.transaction.findFirstOrThrow({ where: { invoiceId: sale.invoice.id, type: 'payment' } })
    const status = async () => (await prisma.order.findUniqueOrThrow({ where: { id: sale.order.id } })).status
    expect(await status()).toBe('completed')
    const part = await refundPayment({ ownerId: gym, transactionId: payment.id, amountCents: 3000, refundReason: 'service_issue', reason: 'One tub was damaged' })
    expect(await status()).toBe('partially_refunded')
    const { settleRefund } = await import('@/lib/services/payments')
    await tx((db) => settleRefund(db, { ownerId: gym, refundId: part.refundId, outcome: 'failed' }))
    expect(await status()).toBe('completed')
    await refundPayment({ ownerId: gym, transactionId: payment.id, amountCents: 3000 })
    await refundPayment({ ownerId: gym, transactionId: payment.id })
    expect(await status()).toBe('refunded')
    expect((await invoiceOf(sale.invoice.id)).refundedCents).toBe(sale.invoice.totalCents)
  })

  it('only refunds a successful payment that belongs to the gym asking', async () => {
    const s = await paid()
    await expect(refundPayment({ ownerId: other, transactionId: s.payment.id, amountCents: 100 })).rejects.toMatchObject({ status: 404 })
    await expect(refundPayment({ ownerId: gym, transactionId: s.payment.providerReference!, amountCents: 100 })).rejects.toBeTruthy()
    const done = await refundPayment({ ownerId: gym, transactionId: s.payment.id, amountCents: 100 })
    // A refund cannot itself be refunded, and neither can a failed charge.
    await expect(refundPayment({ ownerId: gym, transactionId: done.refundId, amountCents: 50 })).rejects.toMatchObject({ code: 'not_refundable' })
    const f = await midPeriod({ method: 'card', paid: false })
    processor.next = ['failed']
    await collectInvoice({ ownerId: gym, invoiceId: f.invoiceId })
    const failed = (await invoiceOf(f.invoiceId)).transactions[0]
    await expect(refundPayment({ ownerId: gym, transactionId: failed.id })).rejects.toMatchObject({ code: 'not_refundable' })
    expect(await paymentOf(s.payment.id)).toMatchObject({ refundedCents: 100 })
  })
})

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

describe('household billing', () => {
  /** A parent with a card and two children, each on their own plan, each with an unpaid invoice due. */
  async function family(ownerId = gym) {
    const parent = await withCard(ownerId, { name: `Pat Parent ${randomUUID().slice(0, 4)}` })
    const [kid1, kid2] = [await createMember(ownerId, { name: `Kit Kid ${randomUUID().slice(0, 4)}` }), await createMember(ownerId, { name: `Kai Kid ${randomUUID().slice(0, 4)}` })]
    const { household } = await tx((db) => createHousehold(db, { ownerId, payerMemberId: parent.member.id, memberIds: [kid1.id, kid2.id] }))
    const [planA, planB] = [await planAt(6000, {}, ownerId), await planAt(4500, {}, ownerId)]
    const sales = []
    for (const [m, plan] of [[kid1, planA], [kid2, planB]] as const) sales.push(await tx((db) => sellMembership(db, { ownerId, memberId: m.id, planId: plan.id, paymentMethod: 'card' })))
    return { ownerId, household, parent, kid1, kid2, sales }
  }

  it('bills each member\'s own invoice to the payer\'s card, without merging anything', async () => {
    const f = await family()
    expect(await billingPayer(prisma, gym, f.kid1.id)).toEqual({ payerId: f.parent.member.id, viaHousehold: true, householdId: f.household.id })
    expect(await billingPayer(prisma, gym, f.parent.member.id)).toMatchObject({ payerId: f.parent.member.id, viaHousehold: false })
    const summary = await runCollections(gym)
    expect(summary.errors).toEqual([])
    const mine = processor.charges.filter((c) => f.sales.some((s) => s.invoice!.id === c.invoiceId))
    expect(mine.map((c) => c.amountCents).sort()).toEqual([4500, 6000])
    // The payer's customer and card, every time.
    expect(mine.every((c) => c.customerRef === f.parent.member.connectCustomerId && c.paymentMethodRef === f.parent.method.providerId)).toBe(true)
    for (const [kid, sale] of [[f.kid1, f.sales[0]], [f.kid2, f.sales[1]]] as const) {
      const invoice = await invoiceOf(sale.invoice!.id)
      // The invoice and the payment still belong to the child; the payer is recorded as who paid.
      expect(invoice).toMatchObject({ status: 'paid', memberId: kid.id, membershipId: sale.membership.id })
      expect(invoice.transactions).toHaveLength(1)
      expect(invoice.transactions[0]).toMatchObject({ memberId: kid.id, payerMemberId: f.parent.member.id, paymentMethodId: f.parent.method.id, status: 'succeeded' })
      expect(await prisma.membership.count({ where: { memberId: kid.id } })).toBe(1)
    }
    expect(await prisma.membership.count({ where: { memberId: f.parent.member.id } })).toBe(0)
    expect(await prisma.invoice.count({ where: { memberId: f.parent.member.id } })).toBe(0)
    const view = await getHousehold(gym, f.household.id)
    expect(view).toMatchObject({ payerMemberId: f.parent.member.id, totals: { amountDueCents: 0, openInvoices: 0, recurringCents: 10_500 } })
    expect(view.members.map((m) => [m.isPayer, m.memberships.length, m.paymentProblem])).toEqual(expect.arrayContaining([[true, 0, false], [false, 1, false], [false, 1, false]]))
    expect(view.payments.every((p) => p.paidByName === f.parent.member.name)).toBe(true)
    expect(view.payer?.paymentMethods).toHaveLength(1)
  })

  it('puts each affected membership through the usual failed-payment steps when the payer\'s card fails, once each', async () => {
    const f = await family()
    const own = await tx(async (db) => sellMembership(db, { ownerId: gym, memberId: f.parent.member.id, planId: (await planAt(9000)).id, paymentMethod: 'cash' }))
    await tx((db) => recordPayment(db, { ownerId: gym, invoiceId: own.invoice!.id, method: 'cash' }))
    processor.next = ['failed', 'failed']
    const summary = await runCollections(gym)
    expect(summary.failed).toBeGreaterThanOrEqual(2)
    for (const [kid, sale] of [[f.kid1, f.sales[0]], [f.kid2, f.sales[1]]] as const) {
      const invoice = await invoiceOf(sale.invoice!.id)
      expect(invoice).toMatchObject({ status: 'open', attemptCount: 1, memberId: kid.id })
      expect(invoice.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 2 * DAY)
      expect(invoice.transactions).toHaveLength(1)
      expect(invoice.transactions[0]).toMatchObject({ status: 'failed', payerMemberId: f.parent.member.id, memberId: kid.id, failureReason: 'Your card was declined.' })
      expect(await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id } })).toMatchObject({ status: 'past_due', failedPaymentCount: 1 })
      expect(await prisma.notification.count({ where: { ownerId: gym, type: 'payment_failed', body: { contains: `billed to ${f.parent.member.name}` }, title: { contains: kid.name } } })).toBe(1)
      // The webhook reports the same failure again: nothing is recorded twice.
      const t = invoice.transactions[0]
      await settlePayment({ ownerId: gym, invoiceId: invoice.id, reference: t.providerReference!, outcome: 'failed', amountCents: t.amountCents, method: 'card', provider: 'stripe', failureReason: 'Your card was declined.' })
      await settlePayment({ ownerId: gym, invoiceId: invoice.id, reference: t.providerReference!, outcome: 'failed', amountCents: t.amountCents, method: 'card', provider: 'stripe', failureReason: 'Your card was declined.' })
      expect(await invoiceOf(invoice.id)).toMatchObject({ attemptCount: 1 })
      expect((await invoiceOf(invoice.id)).transactions).toHaveLength(1)
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id } })).failedPaymentCount).toBe(1)
    }
    // The payer's own, paid, membership is not dragged down with them.
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: own.membership.id } })).status).toBe('active')
    const view = await getHousehold(gym, f.household.id)
    expect(view.totals).toMatchObject({ amountDueCents: 10_500, openInvoices: 2 })
    expect(view.members.filter((m) => m.paymentProblem).map((m) => m.id).sort()).toEqual([f.kid1.id, f.kid2.id].sort())
    expect(view.members.find((m) => m.isPayer)).toMatchObject({ paymentProblem: false, amountDueCents: 0 })

    // The retry, when it is due, goes to the payer again and clears each membership.
    const charged = processor.charges.length
    await runCollections(gym, new Date(Date.now() + 4 * DAY))
    expect(processor.charges.slice(charged).filter((c) => f.sales.some((s) => s.invoice!.id === c.invoiceId))).toHaveLength(2)
    for (const sale of f.sales) expect((await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id } })).status).toBe('active')
  })

  it('only ever charges the payer\'s own payment methods', async () => {
    const f = await family()
    const kidCard = await prisma.paymentMethod.create({ data: { ownerId: gym, memberId: f.kid1.id, providerId: `pm_${randomUUID()}`, type: 'card', brand: 'visa', last4: '1111', isDefault: true } })
    const stranger = await withCard()
    const invoiceId = f.sales[0].invoice!.id
    // A card that is not the payer's cannot be named for a household invoice: not the child's, not anyone else's.
    await expect(collectInvoice({ ownerId: gym, invoiceId, paymentMethodId: kidCard.id })).rejects.toMatchObject({ status: 404 })
    await expect(collectInvoice({ ownerId: gym, invoiceId, paymentMethodId: stranger.method.id })).rejects.toMatchObject({ status: 404 })
    expect(processor.charges.filter((c) => c.invoiceId === invoiceId)).toHaveLength(0)
    expect((await collectInvoice({ ownerId: gym, invoiceId, paymentMethodId: f.parent.method.id })).status).toBe('succeeded')
    // And a stranger's invoice cannot be put on the payer's card.
    const theirs = await tx(async (db) => sellMembership(db, { ownerId: gym, memberId: stranger.member.id, planId: (await planAt(6000)).id, paymentMethod: 'card' }))
    await expect(collectInvoice({ ownerId: gym, invoiceId: theirs.invoice!.id, paymentMethodId: f.parent.method.id })).rejects.toMatchObject({ status: 404 })
  })

  it('changes who pays from now on, without touching what was already paid', async () => {
    const f = await family()
    await collectInvoice({ ownerId: gym, invoiceId: f.sales[0].invoice!.id })
    const before = await invoiceOf(f.sales[0].invoice!.id)
    const other2 = await withCard(gym, { name: 'Olu Otherparent' })
    // Someone outside the household cannot be made payer: they have to be added first.
    await expect(tx((db) => setHouseholdPayer(db, { ownerId: gym, householdId: f.household.id, payerMemberId: other2.member.id }))).rejects.toMatchObject({ code: 'payer_not_in_household' })
    await tx((db) => addHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: other2.member.id }))
    const changed = await tx((db) => setHouseholdPayer(db, { ownerId: gym, householdId: f.household.id, payerMemberId: other2.member.id }))
    expect(changed).toMatchObject({ changed: true, previous: { id: f.parent.member.id }, payer: { id: other2.member.id } })
    expect((await tx((db) => setHouseholdPayer(db, { ownerId: gym, householdId: f.household.id, payerMemberId: other2.member.id }))).changed).toBe(false)
    await collectInvoice({ ownerId: gym, invoiceId: f.sales[1].invoice!.id })
    expect((await invoiceOf(f.sales[1].invoice!.id)).transactions[0]).toMatchObject({ payerMemberId: other2.member.id, paymentMethodId: other2.method.id })
    expect(processor.charges.at(-1)).toMatchObject({ customerRef: other2.member.connectCustomerId })
    // Yesterday's payment still says who really paid it.
    const after = await invoiceOf(f.sales[0].invoice!.id)
    expect(after.transactions[0]).toMatchObject({ id: before.transactions[0].id, payerMemberId: f.parent.member.id, paymentMethodId: f.parent.method.id })
    expect(await prisma.activity.count({ where: { memberId: f.kid1.id, type: 'household', title: { contains: 'Billing moved to' } } })).toBe(1)
  })

  it('lets a member leave with their history intact, and bills them directly from then on', async () => {
    const f = await family()
    await collectInvoice({ ownerId: gym, invoiceId: f.sales[0].invoice!.id })
    // The payer cannot walk away while others depend on them.
    await expect(tx((db) => removeHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: f.parent.member.id }))).rejects.toMatchObject({ status: 409, code: 'payer_cannot_leave' })
    await tx((db) => removeHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: f.kid1.id }))
    expect((await prisma.member.findUniqueOrThrow({ where: { id: f.kid1.id } })).householdId).toBeNull()
    // Nothing financial was deleted or rewritten.
    expect(await invoiceOf(f.sales[0].invoice!.id)).toMatchObject({ status: 'paid', memberId: f.kid1.id })
    expect((await invoiceOf(f.sales[0].invoice!.id)).transactions[0]).toMatchObject({ payerMemberId: f.parent.member.id, status: 'succeeded' })
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: f.sales[0].membership.id } })).toMatchObject({ status: 'active', memberId: f.kid1.id })
    // Their next invoice is theirs to pay: they have no card, so nothing is charged, least of all the old payer.
    const next = await tx(async (db) => sellMembership(db, { ownerId: gym, memberId: f.kid1.id, planId: (await planAt(3000)).id, paymentMethod: 'card' }))
    const charges = processor.charges.length
    expect((await collectInvoice({ ownerId: gym, invoiceId: next.invoice!.id })).status).toBe('no_method')
    expect(processor.charges).toHaveLength(charges)
    expect(await billingPayer(prisma, gym, f.kid1.id)).toMatchObject({ payerId: f.kid1.id, viaHousehold: false })
    // The last two leave: the household goes, the records do not.
    await tx((db) => removeHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: f.kid2.id }))
    expect((await tx((db) => removeHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: f.parent.member.id }))).dissolved).toBe(true)
    expect(await prisma.household.findUnique({ where: { id: f.household.id } })).toBeNull()
    expect(await prisma.invoice.count({ where: { memberId: { in: [f.kid1.id, f.kid2.id] } } })).toBe(3)
  })

  it('keeps a member in one household, inside one gym', async () => {
    const f = await family()
    const outsider = await createMember(other)
    const second = await withCard()
    await expect(tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: second.member.id, memberIds: [f.kid1.id] }))).rejects.toMatchObject({ status: 409, code: 'already_in_household' })
    await expect(tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: second.member.id, memberIds: [outsider.id] }))).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => addHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: outsider.id }))).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => addHouseholdMember(db, { ownerId: other, householdId: f.household.id, memberId: outsider.id }))).rejects.toMatchObject({ status: 404 })
    await expect(getHousehold(other, f.household.id)).rejects.toMatchObject({ status: 404 })
    await expect(tx((db) => setHouseholdPayer(db, { ownerId: other, householdId: f.household.id, payerMemberId: f.kid1.id }))).rejects.toMatchObject({ status: 404 })
    expect((await prisma.member.findUniqueOrThrow({ where: { id: outsider.id } })).householdId).toBeNull()
    expect(await prisma.household.count({ where: { ownerId: gym, payerMemberId: second.member.id } })).toBe(0)
    // Adding someone who is already in it is a no-op, not a second entry.
    expect((await tx((db) => addHouseholdMember(db, { ownerId: gym, householdId: f.household.id, memberId: f.kid1.id }))).added).toBe(false)
    // Two people trying to put the same member in two new households at once: one wins.
    const loose = await createMember(gym)
    const [p1, p2] = [await withCard(), await withCard()]
    const results = await Promise.allSettled([p1, p2].map((p) => tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: p.member.id, memberIds: [loose.id] }))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.household.count({ where: { ownerId: gym, payerMemberId: { in: [p1.member.id, p2.member.id] } } })).toBe(1)
    // A payer stored against a household they are no longer in is not trusted.
    await prisma.member.update({ where: { id: f.parent.member.id }, data: { householdId: null } })
    expect(await billingPayer(prisma, gym, f.kid2.id)).toMatchObject({ payerId: f.kid2.id, viaHousehold: false })
  })

  it('gives a child\'s plan-change credit to whoever paid, and spends the payer\'s credit on the household\'s invoices', async () => {
    const parent = await withCard(gym, { name: 'Robin Payer' })
    const child = await createMember(gym, { name: 'Remy Child' })
    await tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: parent.member.id, memberIds: [child.id] }))
    const s = await midPeriod({ priceCents: 15_000, method: 'card', member: child })
    expect((await invoiceOf(s.invoiceId)).transactions[0]).toMatchObject({ payerMemberId: parent.member.id })
    const { preview, result } = await change(s, (await planAt(10_000)).id)
    expect(preview.payer).toMatchObject({ id: parent.member.id, viaHousehold: true })
    expect(result.creditCents).toBe(2500)
    expect(await balanceOf(parent.member.id)).toBe(2500)
    expect(await balanceOf(child.id)).toBe(0)
    // The membership that changed is still the child's.
    expect(await membershipOf(s.membershipId)).toMatchObject({ memberId: child.id, priceCents: 10_000 })
    // At renewal the payer's credit comes off the child's invoice, then the payer's card pays the rest.
    const later = new Date(s.end.getTime() + 60_000)
    await runMembershipBilling(gym, later)
    const renewal = await prisma.invoice.findFirstOrThrow({ where: { membershipId: s.membershipId, periodStart: s.end }, include: { transactions: true } })
    expect(renewal).toMatchObject({ memberId: child.id, amountPaidCents: 2500 })
    expect(renewal.transactions[0]).toMatchObject({ method: 'account_credit', payerMemberId: parent.member.id, memberId: child.id })
    expect(await balanceOf(parent.member.id)).toBe(0)
    // Nobody outside the household can have their invoice paid from the payer's credit.
    await tx((db) => grantCredit(db, { ownerId: gym, memberId: parent.member.id, amountCents: 5000, source: 'staff' }))
    const stranger = await midPeriod({ paid: false })
    await expect(tx((db) => recordPayment(db, { ownerId: gym, invoiceId: stranger.invoiceId, method: 'account_credit', creditMemberId: parent.member.id }))).rejects.toMatchObject({ code: 'not_payer' })
    expect(await balanceOf(parent.member.id)).toBe(5000)
  })
})

// ---------------------------------------------------------------------------
// Over HTTP: permissions and tenant isolation
// ---------------------------------------------------------------------------

async function call(auth: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text }
}

describe.skipIf(!up)('advanced billing over HTTP', () => {
  const who: Record<string, string> = {}
  let owner: string
  let foreignOwner: string
  const ROLES = ['admin', 'manager', 'sales', 'accountant', 'front_desk', 'coach', 'trainer'] as const

  beforeAll(async () => {
    owner = `auth-token=${await createToken({ ownerId: gym, emailVerified: true })}`
    foreignOwner = `auth-token=${await createToken({ ownerId: other, emailVerified: true })}`
    for (const role of ROLES) {
      const row = await prisma.staff.create({ data: { ownerId: gym, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role, isCoach: role === 'coach' || role === 'trainer' } })
      who[role] = `auth-token=${await createToken({ ownerId: gym, staffId: row.id, role: role as any })}`
    }
  })
  const allowed = async (roles: readonly string[], method: string, path: string, body?: unknown) => {
    const out: Record<string, number> = {}
    for (const role of ROLES) out[role] = (await call(who[role], method, path, body)).status
    for (const role of ROLES) expect(out[role] !== 403, `${role} ${method} ${path} -> ${out[role]}`).toBe(roles.includes(role))
    expect((await call(null, method, path, body)).status, `signed out ${method} ${path}`).toBe(401)
  }

  it('previews and confirms a plan change for the roles that manage memberships, and nobody else', async () => {
    const s = await midPeriod()
    const to = await planAt(15_000)
    const path = `/api/memberships/${s.membershipId}/plan-change`
    await allowed(['admin', 'manager', 'sales'], 'GET', `${path}?planId=${to.id}&effective=now`)
    const preview = await call(who.sales, 'GET', `${path}?planId=${to.id}&effective=now`)
    expect(preview.data).toMatchObject({ allowed: true, from: { priceCents: 10_000 }, to: { priceCents: 15_000 }, calc: { oldUnusedCents: 5000, newChargeCents: 7500, amountDueNowCents: 2500, creditCents: 0, remainingDays: 15, totalDays: 30 } })
    expect(preview.data.calc.nextBillingDate).toBe(s.end.toISOString())
    const body = { planId: to.id, effective: 'now', expected: { fromPlanId: s.plan.id, amountDueNowCents: 2500, creditCents: 0 }, idempotencyKey: key() }
    for (const role of ['accountant', 'front_desk', 'coach', 'trainer']) expect((await call(who[role], 'POST', path, body)).status, role).toBe(403)
    expect((await call(foreignOwner, 'GET', `${path}?planId=${to.id}`)).status).toBe(404)
    expect((await call(foreignOwner, 'POST', path, body)).status).toBe(404)
    // A confirmation has to say what was agreed to, and carry a key.
    expect((await call(who.sales, 'POST', path, { planId: to.id, effective: 'now' })).status).toBe(400)
    expect((await call(who.sales, 'POST', path, { ...body, expected: { ...body.expected, amountDueNowCents: 1 } })).json.code).toBe('preview_changed')
    expect((await call(who.sales, 'POST', path, { ...body, planId: (await planAt(15_000, {}, other)).id })).status).toBe(404)
    expect((await membershipOf(s.membershipId)).planId).toBe(s.plan.id)

    const [a, b] = await Promise.all([call(who.sales, 'POST', path, body), call(who.sales, 'POST', path, body)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(a.data.planChangeId).toBe(b.data.planChangeId)
    expect(a.data).toMatchObject({ status: 'applied', amountDueNowCents: 2500, invoice: { totalCents: 2500, status: 'open' } })
    expect(await prisma.invoice.count({ where: { membershipId: s.membershipId } })).toBe(2)
    // One audit entry, with the before, the after, the figures and the key.
    const audits = await prisma.auditLog.findMany({ where: { ownerId: gym, action: 'membership.change_plan', entityId: s.membershipId } })
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0])).toContain(body.idempotencyKey)
    const recorded = typeof audits[0].metadata === 'string' ? JSON.parse(audits[0].metadata) : (audits[0].metadata as any)
    expect(recorded).toMatchObject({ amountDueNowCents: 2500, creditCents: 0, effective: 'now', calculation: { oldUnusedCents: 5000, newChargeCents: 7500 } })
    const history = await call(who.manager, 'GET', path)
    expect(history.data.history).toHaveLength(1)
    expect(history.data.history[0]).toMatchObject({ status: 'applied', effective: 'now', calc: { amountDueNowCents: 2500 } })
  })

  it('refunds only for roles allowed to, only inside the gym, and shows what is left', async () => {
    const s = await midPeriod()
    const payment = (await invoiceOf(s.invoiceId)).transactions[0]
    const path = `/api/billing/transactions/${payment.id}/refund`
    await allowed(['admin', 'manager', 'accountant'], 'POST', path, { amountCents: 100, idempotencyKey: `perm-${payment.id}` })
    const info = await call(who.front_desk, 'GET', path)
    // Front desk can look, and is told plainly that it cannot refund.
    expect(info.data).toMatchObject({ originalCents: 10_000, refundedCents: 100, refundableCents: 9900, canRefund: false, throughProcessor: false })
    expect(info.data.refunds).toHaveLength(1)
    expect((await call(who.coach, 'GET', path)).status).toBe(403)
    for (const cookie of [foreignOwner]) {
      expect((await call(cookie, 'GET', path)).status).toBe(404)
      expect((await call(cookie, 'POST', path, { amountCents: 100 })).status).toBe(404)
    }
    const refundKey = key()
    const first = await call(who.accountant, 'POST', path, { amountCents: 4000, refundReason: 'billing_error', note: 'Charged the wrong plan', idempotencyKey: refundKey })
    expect(first.data).toMatchObject({ amountCents: 4000, previouslyRefundedCents: 100, totalRefundedCents: 4100, remainingRefundableCents: 5900, fullyRefunded: false, replayed: false })
    expect((await call(who.accountant, 'POST', path, { amountCents: 4000, refundReason: 'billing_error', note: 'Charged the wrong plan', idempotencyKey: refundKey })).data).toMatchObject({ replayed: true, refundId: first.data.refundId })
    expect((await call(who.accountant, 'POST', path, { amountCents: 5901 })).json.code).toBe('refund_too_large')
    expect((await call(who.accountant, 'POST', path, { amountCents: 0 })).status).toBe(400)
    expect((await call(who.accountant, 'POST', path, { amountCents: -5 })).status).toBe(400)
    expect((await call(who.accountant, 'POST', path, { amountCents: 100, refundReason: 'because' })).status).toBe(400)
    const after = await call(who.accountant, 'GET', path)
    expect(after.data).toMatchObject({ refundedCents: 4100, refundableCents: 5900, canRefund: true })
    expect(after.data.refunds.at(-1)).toMatchObject({ amountCents: 4000, reason: 'billing_error', reasonLabel: 'Billing mistake', note: 'Charged the wrong plan', status: 'succeeded' })
    // A Stripe id is not a way in: only our own id for a payment in this gym works.
    expect((await call(who.accountant, 'POST', `/api/billing/transactions/pi_3NxyzNotOurs/refund`, { amountCents: 100 })).status).toBe(404)
    // Two refunds were made (the repeats were replays), so two audit entries.
    const audits = await prisma.auditLog.findMany({ where: { ownerId: gym, action: 'payment.refund', entityId: payment.id } })
    expect(audits.length).toBe(2)
    expect(JSON.stringify(audits)).toContain(refundKey)
  })

  it('lets billing staff see credits, and only refund-level roles add or remove them', async () => {
    const member = await createMember(gym)
    const path = `/api/members/${member.id}/credit`
    await allowed(['admin', 'manager', 'sales', 'accountant', 'front_desk'], 'GET', path)
    await allowed(['admin', 'manager', 'accountant'], 'POST', path, { amountCents: 500, note: 'Permission check', idempotencyKey: `credit-perm-${member.id}` })
    expect(await balanceOf(member.id)).toBe(500)
    const creditKey = key()
    const [a, b] = await Promise.all([call(owner, 'POST', path, { amountCents: 2000, note: 'Goodwill', idempotencyKey: creditKey }), call(owner, 'POST', path, { amountCents: 2000, note: 'Goodwill', idempotencyKey: creditKey })])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await balanceOf(member.id)).toBe(2500)
    const list = await call(who.front_desk, 'GET', path)
    expect(list.data).toMatchObject({ balanceCents: 2500 })
    expect(list.data.credits.map((c: any) => [c.originalCents, c.source, c.reason])).toEqual([[2000, 'staff', 'Goodwill'], [500, 'staff', 'Permission check']])
    expect((await call(owner, 'POST', path, { amountCents: -3000 })).status).toBe(400)
    expect((await call(foreignOwner, 'GET', path)).status).toBe(404)
    expect((await call(foreignOwner, 'POST', path, { amountCents: 100 })).status).toBe(404)
    expect((await call(who.front_desk, 'PATCH', path, { creditId: list.data.credits[0].id, autoApply: false })).status).toBe(403)
    expect((await call(who.accountant, 'PATCH', path, { creditId: list.data.credits[0].id, autoApply: false })).data.updated).toBe(true)
    expect(await balanceOf(member.id)).toBe(2500)
  })

  it('sets up households only for roles with that permission, and never across gyms', async () => {
    const [payer, kid, extra] = [await createMember(gym, { name: 'Hana Household' }), await createMember(gym, { name: 'Hugo Household' }), await createMember(gym, { name: 'Hedy Household' })]
    const stranger = await createMember(other, { name: 'Outside Person' })
    const body = { payerMemberId: payer.id, memberIds: [kid.id] }
    for (const role of ['sales', 'front_desk', 'coach', 'trainer']) expect((await call(who[role], 'POST', '/api/households', body)).status, role).toBe(403)
    expect((await call(owner, 'POST', '/api/households', { payerMemberId: payer.id, memberIds: [stranger.id] })).status).toBe(404)
    expect((await call(owner, 'POST', '/api/households', { payerMemberId: stranger.id })).status).toBe(404)
    const made = await call(who.accountant, 'POST', '/api/households', body)
    expect(made.status).toBe(200)
    const id = made.data.id
    await allowed(['admin', 'manager', 'sales', 'accountant', 'front_desk'], 'GET', `/api/households/${id}`)
    await allowed(['admin', 'manager', 'accountant'], 'POST', `/api/households/${id}`, { action: 'rename', name: 'Household family' })
    const view = await call(who.front_desk, 'GET', `/api/households/${id}`)
    expect(view.data).toMatchObject({ name: 'Household family', payerMemberId: payer.id, canManage: false })
    expect(view.data.members.map((m: any) => m.name).sort()).toEqual(['Hana Household', 'Hugo Household'])
    expect((await call(who.manager, 'GET', `/api/members/${kid.id}/household`)).data).toMatchObject({ canManage: true, household: { id } })
    expect((await call(who.manager, 'GET', `/api/members/${extra.id}/household`)).data.household).toBeNull()
    expect((await call(who.front_desk, 'GET', '/api/households?search=Hugo')).data.map((h: any) => h.id)).toEqual([id])

    // Another gym cannot see it, change it, or slip one of its own members in; nor can this gym pull theirs in.
    for (const action of [{ action: 'add', memberId: stranger.id }, { action: 'payer', memberId: stranger.id }, { action: 'remove', memberId: kid.id }, { action: 'dissolve' }, { action: 'rename', name: 'Taken over' }]) {
      expect((await call(foreignOwner, 'POST', `/api/households/${id}`, action)).status, JSON.stringify(action)).toBe(404)
    }
    expect((await call(foreignOwner, 'GET', `/api/households/${id}`)).status).toBe(404)
    expect((await call(foreignOwner, 'GET', `/api/members/${kid.id}/household`)).status).toBe(404)
    expect((await call(foreignOwner, 'GET', '/api/households')).data).toEqual([])
    expect((await call(owner, 'POST', `/api/households/${id}`, { action: 'add', memberId: stranger.id })).status).toBe(404)
    expect((await call(owner, 'POST', `/api/households/${id}`, { action: 'payer', memberId: extra.id })).json.code).toBe('payer_not_in_household')
    expect((await call(owner, 'POST', `/api/households/${id}`, { action: 'add', memberId: extra.id })).data.added).toBe(true)
    expect((await call(owner, 'POST', `/api/households/${id}`, { action: 'payer', memberId: extra.id })).data.changed).toBe(true)
    expect((await call(owner, 'POST', `/api/households/${id}`, { action: 'remove', memberId: extra.id })).json.code).toBe('payer_cannot_leave')
    const audits = await prisma.auditLog.findMany({ where: { ownerId: gym, entityType: 'household', entityId: id } })
    expect(audits.map((a) => a.action).sort()).toEqual(['household.add_member', 'household.change_payer', 'household.create'])
    expect((await prisma.household.findUniqueOrThrow({ where: { id } })).name).toBe('Household family')
  })

  describe('members', () => {
    let parent: Awaited<ReturnType<typeof createMember>>
    let child: Awaited<ReturnType<typeof createMember>>
    let outsider: Awaited<ReturnType<typeof createMember>>
    let bearer: Record<'parent' | 'child' | 'outsider', string>
    let childSetup: Awaited<ReturnType<typeof midPeriod>>
    let parentSetup: Awaited<ReturnType<typeof midPeriod>>

    beforeAll(async () => {
      parent = await createMember(gym, { name: 'Morgan Secretsurname', phone: '(415) 555-0177' })
      child = await createMember(gym, { name: 'Jamie Secretsurname', phone: '(415) 555-0178', medicalNotes: 'Asthma inhaler in bag' })
      outsider = await createMember(gym, { name: 'Sam Elsewhere' })
      await tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: parent.id, memberIds: [child.id] }))
      childSetup = await midPeriod({ member: child })
      parentSetup = await midPeriod({ member: parent })
      bearer = {} as typeof bearer
      for (const [name, m] of [['parent', parent], ['child', child], ['outsider', outsider]] as const) {
        const { token } = await createInvite(gym, m.id)
        await setPasswordWithToken(token, 'a-long-test-password-1')
        bearer[name] = await memberBearer(m.id)
      }
    })

    it('shows a member the same plan-change figures staff see, for their own membership only', async () => {
      const to = await planAt(15_000)
      const path = `/api/portal/me/memberships/${parentSetup.membershipId}/plan-change`
      const preview = await call(bearer.parent, 'GET', `${path}?planId=${to.id}&effective=now`)
      const staff = await call(owner, 'GET', `/api/memberships/${parentSetup.membershipId}/plan-change?planId=${to.id}&effective=now`)
      expect(preview.status).toBe(200)
      // The same figures to the cent (the two requests are milliseconds apart, so only the timestamp differs).
      expect({ ...preview.data.calc, effectiveAt: null }).toEqual({ ...staff.data.calc, effectiveAt: null })
      expect(preview.data).toMatchObject({ allowed: true, to: { priceCents: 15_000 }, calc: { amountDueNowCents: 2500 } })
      // Not which invoice it was worked out from: that is the back office's business.
      expect(preview.data.basis).toBeUndefined()
      // Somebody else's membership, even their own child's, is not theirs to change here.
      for (const b of [bearer.outsider, bearer.child]) expect((await call(b, 'GET', `${path}?planId=${to.id}`)).status).toBe(404)
      expect((await call(bearer.parent, 'GET', `/api/portal/me/memberships/${childSetup.membershipId}/plan-change?planId=${to.id}`)).status).toBe(404)
      const body = { planId: to.id, effective: 'now', expected: { fromPlanId: parentSetup.plan.id, amountDueNowCents: 2500, creditCents: 0 }, idempotencyKey: key() }
      expect((await call(bearer.outsider, 'POST', path, body)).status).toBe(404)
      expect((await call(bearer.parent, 'POST', `/api/portal/me/memberships/${childSetup.membershipId}/plan-change`, { ...body, expected: { ...body.expected, fromPlanId: childSetup.plan.id } })).status).toBe(404)
      // A plan the gym does not offer publicly cannot be reached by guessing its id.
      expect((await call(bearer.parent, 'GET', `${path}?planId=${(await planAt(2000, { isPublic: false })).id}`)).status).toBe(404)
      const stale = await call(bearer.parent, 'POST', path, { ...body, expected: { ...body.expected, amountDueNowCents: 1 } })
      expect(stale.json.code).toBe('preview_changed')
      expect(stale.json.details).toBeUndefined()

      const done = await call(bearer.parent, 'POST', path, body)
      expect(done.data).toMatchObject({ status: 'applied', amountDueNowCents: 2500, creditCents: 0, nextBillingCents: 15_000 })
      expect((await call(bearer.parent, 'POST', path, body)).data).toMatchObject({ status: 'applied', amountDueNowCents: 2500 })
      expect(await prisma.planChange.findFirstOrThrow({ where: { membershipId: parentSetup.membershipId } })).toMatchObject({ source: 'member', byName: parent.name })
      expect(await prisma.planChange.count({ where: { membershipId: parentSetup.membershipId } })).toBe(1)
      // The gym can switch member plan changes off.
      await prisma.gymProfile.update({ where: { ownerId: gym }, data: { memberSelfChangePlan: false } })
      expect((await call(bearer.parent, 'GET', `${path}?planId=${to.id}`)).json.code).toBe('self_service_disabled')
      await prisma.gymProfile.update({ where: { ownerId: gym }, data: { memberSelfChangePlan: true } })
    })

    it('tells a household only what each person needs to know', async () => {
      const mine = await call(bearer.child, 'GET', '/api/portal/me/household')
      expect(mine.data.household).toEqual({ name: expect.any(String), role: 'member', billedTo: 'Morgan', members: [] })
      expect(mine.text).not.toContain('555-0177')
      const theirs = await call(bearer.parent, 'GET', '/api/portal/me/household')
      expect(theirs.data.household).toMatchObject({ role: 'payer', billedTo: null })
      expect(theirs.data.household.members).toHaveLength(1)
      expect(theirs.data.household.members[0]).toMatchObject({ name: 'Jamie Secretsurname', memberships: [{ priceCents: 10_000 }] })
      // Billing, and nothing else about the child.
      for (const hidden of ['Asthma', '555-0178', child.email, child.id, child.qrCode]) expect(theirs.text, hidden).not.toContain(hidden)
      expect(Object.keys(theirs.data.household.members[0]).sort()).toEqual(['amountDueCents', 'invoices', 'memberships', 'name'])
      expect((await call(bearer.outsider, 'GET', '/api/portal/me/household')).data.household).toBeNull()
      expect((await call(null, 'GET', '/api/portal/me/household')).status).toBe(401)
    })

    it('lets the payer pay for the household, and nobody pay with a card that is not theirs', async () => {
      const due = await tx(async (db) => sellMembership(db, { ownerId: gym, memberId: child.id, planId: (await planAt(2500)).id, paymentMethod: 'card' }))
      const path = `/api/portal/me/invoices/${due.invoice!.id}/pay`
      // The child's bills go to the parent's card: the child cannot set that off.
      expect((await call(bearer.child, 'POST', path, {})).json.code).toBe('billed_to_payer')
      expect((await call(bearer.outsider, 'POST', path, {})).status).toBe(404)
      // The payer may (no processor is connected on this server, so it stops there, but it is their invoice to pay).
      expect((await call(bearer.parent, 'POST', path, {})).json.code).toBe('payments_not_connected')
      expect((await call(bearer.parent, 'POST', `/api/portal/me/invoices/${(await midPeriod({ paid: false })).invoiceId}/pay`, {})).status).toBe(404)
      expect((await invoiceOf(due.invoice!.id)).status).toBe('open')
    })

    it('gives members no way to refund, credit or regroup themselves', async () => {
      const payment = (await invoiceOf(childSetup.invoiceId)).transactions[0]
      for (const b of [bearer.parent, bearer.child]) {
        expect((await call(b, 'POST', `/api/billing/transactions/${payment.id}/refund`, { amountCents: 100 })).status).toBe(401)
        expect((await call(b, 'POST', `/api/members/${child.id}/credit`, { amountCents: 5000 })).status).toBe(401)
        expect((await call(b, 'POST', '/api/households', { payerMemberId: outsider.id, memberIds: [child.id] })).status).toBe(401)
        expect((await call(b, 'GET', `/api/members/${child.id}/credit`)).status).toBe(401)
      }
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } })).refundedCents).toBe(0)
      expect(await balanceOf(child.id)).toBe(0)
    })
  })
})
