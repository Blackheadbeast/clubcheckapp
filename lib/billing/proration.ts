// The one proration calculation. The staff preview, the member preview, the API, the invoice that
// gets raised and the amount that gets charged all come from this function and nothing else.
//
// Everything is integer cents and whole days. There is no floating-point money here.
//
// Two shapes of change:
//   keep_billing_date  The new plan bills on the same cycle (say both monthly). The member keeps
//                      their billing date. They are credited the unused part of what they paid and
//                      charged the new plan for the days that are left.
//   restart_period     The new plan bills on a different cycle (monthly to yearly). A new period
//                      starts today on the new plan. They are credited the unused part of what they
//                      paid and charged one full period of the new plan.
//
// Days are calendar days in the gym's timezone. The day of the change counts as a day on the new plan.

import { zonedParts } from '@/lib/dates'

export interface ProrationInput {
  tz: string
  /** The moment the change takes effect. */
  at: Date
  periodStart: Date
  periodEnd: Date
  /** What was actually paid for the time from `paidFrom` to the end of the period: tax included, refunds taken off. Zero in a free trial. */
  oldPaidCents: number
  /**
   * When the time that `oldPaidCents` bought began. Normally the start of the period. After an
   * earlier change in the same period it is the day of that change, because what was paid then
   * covered only the days from there on.
   */
  paidFrom?: Date
  /** The new plan's price for one of its periods, before tax, after the member's own discount. */
  newPriceCents: number
  newTaxRateBps: number
  /** True when both plans bill on the same interval, so the billing date can stay where it is. */
  sameCycle: boolean
  /** Restart only: when the first period on the new plan ends. */
  newPeriodEnd: Date
  /** In a free trial nothing has been paid and nothing is charged until the trial ends. */
  inTrial?: boolean
  /** Account credit that may be spent on this change. */
  availableCreditCents?: number
}

export interface Proration {
  mode: 'keep_billing_date' | 'restart_period' | 'trial' | 'next_period'
  effectiveAt: string
  totalDays: number
  usedDays: number
  remainingDays: number
  /** Unused part of what was paid for the old plan. Credited. */
  oldUnusedCents: number
  /** New plan for the time being bought now, before tax. */
  newChargeBaseCents: number
  newChargeTaxCents: number
  newChargeCents: number
  /** newChargeCents - oldUnusedCents. Positive: owed. Negative: credit. */
  netCents: number
  /** Owed for the change before any account credit is used. */
  dueBeforeCreditCents: number
  /** Existing account credit used against it. */
  accountCreditAppliedCents: number
  /** What is actually charged now. */
  amountDueNowCents: number
  /** New credit created by this change (a downgrade). Never paid out as cash. */
  creditCents: number
  /** Credit left on account after the change, carried to the next invoice. */
  creditCarriedCents: number
  nextBillingDate: string
  nextBillingBaseCents: number
  nextBillingTaxCents: number
  nextBillingCents: number
  /** The next invoice once the carried credit is taken off it. */
  nextBillingAfterCreditCents: number
}

/** amount * part / whole, rounded half up, in integers. */
export function prorate(amountCents: number, part: number, whole: number): number {
  if (whole <= 0 || part <= 0 || amountCents <= 0) return 0
  if (part >= whole) return amountCents
  return Math.floor((amountCents * part * 2 + whole) / (2 * whole))
}

/** Tax on a pre-tax amount at a rate in basis points, rounded half up, in integers. */
export function taxOn(baseCents: number, rateBps: number): number {
  if (baseCents <= 0 || rateBps <= 0) return 0
  return Math.floor((baseCents * rateBps * 2 + 10_000) / 20_000)
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** Whole calendar days from one instant to another, in the gym's timezone. */
export function daysBetween(from: Date, to: Date, tz: string): number {
  return dayNumber(zonedParts(to, tz).date) - dayNumber(zonedParts(from, tz).date)
}

export function calculateProration(input: ProrationInput): Proration {
  const whole = (n: number) => Math.max(0, Math.trunc(n))
  const oldPaid = whole(input.oldPaidCents)
  const newPrice = whole(input.newPriceCents)
  const available = whole(input.availableCreditCents || 0)

  const totalDays = Math.max(1, daysBetween(input.periodStart, input.periodEnd, input.tz))
  const usedDays = Math.min(totalDays, Math.max(0, daysBetween(input.periodStart, input.at, input.tz)))
  const remainingDays = totalDays - usedDays

  // The old money is spread over the days it bought; the new price over the whole period it is a price for.
  const paidDays = input.paidFrom ? Math.max(1, daysBetween(input.paidFrom, input.periodEnd, input.tz)) : totalDays
  const mode: Proration['mode'] = input.inTrial ? 'trial' : input.sameCycle ? 'keep_billing_date' : 'restart_period'
  const oldUnusedCents = mode === 'trial' ? 0 : prorate(oldPaid, Math.min(remainingDays, paidDays), paidDays)
  const newChargeBaseCents = mode === 'trial' ? 0 : mode === 'keep_billing_date' ? prorate(newPrice, remainingDays, totalDays) : newPrice
  const newChargeTaxCents = taxOn(newChargeBaseCents, input.newTaxRateBps)
  const newChargeCents = newChargeBaseCents + newChargeTaxCents

  const netCents = newChargeCents - oldUnusedCents
  const dueBeforeCreditCents = Math.max(0, netCents)
  const creditCents = Math.max(0, -netCents)
  const accountCreditAppliedCents = Math.min(available, dueBeforeCreditCents)
  const amountDueNowCents = dueBeforeCreditCents - accountCreditAppliedCents
  const creditCarriedCents = available - accountCreditAppliedCents + creditCents

  const nextBillingBaseCents = newPrice
  const nextBillingTaxCents = taxOn(newPrice, input.newTaxRateBps)
  const nextBillingCents = nextBillingBaseCents + nextBillingTaxCents
  return {
    mode,
    effectiveAt: input.at.toISOString(),
    totalDays, usedDays, remainingDays,
    oldUnusedCents, newChargeBaseCents, newChargeTaxCents, newChargeCents,
    netCents, dueBeforeCreditCents, accountCreditAppliedCents, amountDueNowCents, creditCents, creditCarriedCents,
    nextBillingDate: (mode === 'restart_period' ? input.newPeriodEnd : input.periodEnd).toISOString(),
    nextBillingBaseCents, nextBillingTaxCents, nextBillingCents,
    nextBillingAfterCreditCents: Math.max(0, nextBillingCents - creditCarriedCents),
  }
}

/**
 * A change that waits for the next billing date: nothing is charged or credited now, and the next
 * invoice is simply for the new plan. Same shape as a prorated change so every screen reads one thing.
 */
export function calculateScheduledChange(input: { at: Date; tz: string; periodStart: Date; periodEnd: Date; newPriceCents: number; newTaxRateBps: number; availableCreditCents?: number }): Proration {
  const totalDays = Math.max(1, daysBetween(input.periodStart, input.periodEnd, input.tz))
  const usedDays = Math.min(totalDays, Math.max(0, daysBetween(input.periodStart, input.at, input.tz)))
  const available = Math.max(0, Math.trunc(input.availableCreditCents || 0))
  const base = Math.max(0, Math.trunc(input.newPriceCents))
  const tax = taxOn(base, input.newTaxRateBps)
  return {
    mode: 'next_period', effectiveAt: input.periodEnd.toISOString(), totalDays, usedDays, remainingDays: totalDays - usedDays,
    oldUnusedCents: 0, newChargeBaseCents: 0, newChargeTaxCents: 0, newChargeCents: 0, netCents: 0, dueBeforeCreditCents: 0,
    accountCreditAppliedCents: 0, amountDueNowCents: 0, creditCents: 0, creditCarriedCents: available,
    nextBillingDate: input.periodEnd.toISOString(), nextBillingBaseCents: base, nextBillingTaxCents: tax, nextBillingCents: base + tax,
    nextBillingAfterCreditCents: Math.max(0, base + tax - available),
  }
}
