// Payroll and commissions: pay rates, commission plans, who a sale is credited to, the earnings
// ledger, refunds, pay periods, adjustments and export.
// The HTTP half needs a running dev server (npm run dev) and is skipped without one.

import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { Staff } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { toCsv } from '@/lib/csv'
import { createInvoice, recordPayment, refundTransaction, settleRefund } from '@/lib/services/payments'
import { sellMembership } from '@/lib/services/memberships'
import { applyPlanChange, previewPlanChange } from '@/lib/services/plan-change'
import { attributionSchema, compensationSchema, createPlan as createCommissionPlan, getAttribution, listCompensation, listPlans, planSchema, saveCompensation, setAttribution, updatePlan } from '@/lib/services/payroll-config'
import { addAdjustment, addTime, adjustmentSchema, createPeriod, exportPeriod, listPeriods, myEarnings, myLines, periodAction, periodCreateSchema, periodDetail, staffLines, syncPayroll, timeSchema, voidTime } from '@/lib/services/payroll'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const TZ = 'America/New_York'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

const today = zonedParts(new Date(), TZ).date
const d = (n: number) => addDaysToDate(today, n)
/** An instant n days from today (gym time), at a time of day. */
const at = (n: number, time = '12:00') => zonedToUtc(d(n), time, TZ)
const boss = { type: 'owner' as const, id: randomUUID(), name: 'Olive Owner' }
const actorOf = (s: Staff) => ({ type: 'staff' as const, id: s.id, name: s.name })

const gyms: string[] = []
async function gym() {
  const ownerId = await createGym({ timezone: TZ })
  gyms.push(ownerId)
  return ownerId
}
afterAll(async () => {
  for (const ownerId of gyms) {
    for (const model of ['payrollEntry', 'payrollSource', 'payrollPeriod', 'payrollTimeEntry', 'payrollEvent', 'saleAttribution', 'staffCompensation', 'commissionPlan', 'planChange'] as const) await (prisma[model] as any).deleteMany({ where: { ownerId } })
    await destroyGym(ownerId)
  }
})

const person = (ownerId: string, name: string, data: Record<string, unknown> = {}) => prisma.staff.create({ data: { ownerId, name, email: `${randomUUID()}@test.local`, password: 'x', role: 'sales', ...data } })
const comp = (extra: Record<string, unknown> = {}) => compensationSchema.parse({ basePay: 'none', ...extra })
const rule = (trigger: string, rate: number | string, extra: Record<string, unknown> = {}) => (typeof rate === 'string' ? { trigger, rateType: 'percent', percentBps: Math.round(parseFloat(rate) * 100), ...extra } : { trigger, rateType: 'flat', flatCents: rate, ...extra })
/** A commission plan with these rules, with the given people on it from today. */
async function onPlan(ownerId: string, staff: Staff[], rules: Record<string, unknown>[], name = 'Standard') {
  const plan = await createCommissionPlan(ownerId, planSchema.parse({ name, rules }), boss)
  // Commission plans start the day they are assigned; these tests look back in time, so the start is set well before.
  await prisma.commissionAssignment.createMany({ data: staff.map((s) => ({ ownerId, staffId: s.id, planId: plan.id, startsOn: d(-400) })) })
  return plan.id
}
const period = (ownerId: string, from: number, to: number) => createPeriod(ownerId, periodCreateSchema.parse({ startDate: d(from), endDate: d(to) }), boss)
// In date order; lines written together for one event come pay first, then commission.
const lines = async (ownerId: string, where: Record<string, unknown> = {}) => {
  const rows = await prisma.payrollEntry.findMany({ where: { ownerId, ...where }, orderBy: [{ earnedAt: 'asc' }, { createdAt: 'asc' }, { sourceKey: 'asc' }] })
  const rank = (kind: string) => (kind.endsWith('_pay') ? 0 : 1)
  return rows.sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || rank(a.kind) - rank(b.kind))
}
const amounts = async (ownerId: string, where: Record<string, unknown> = {}) => (await lines(ownerId, where)).map((l) => [l.kind, l.amountCents])
const total = async (ownerId: string, where: Record<string, unknown> = {}) => (await prisma.payrollEntry.aggregate({ where: { ownerId, ...where }, _sum: { amountCents: true } }))._sum.amountCents || 0
const act = async (ownerId: string, id: string, action: string, extra: Record<string, unknown> = {}, reopen = true) => (await periodAction(ownerId, id, { action, ...extra } as never, boss, { reopen })) as { status: string; changed: boolean; [key: string]: unknown }

/** Sell a plan at the desk and take the money, on a given day. */
async function sale(ownerId: string, seller: Staff | null, opts: { priceCents?: number; day?: number; planExtra?: Record<string, unknown>; pay?: boolean; soldBy?: string[]; planId?: string } = {}) {
  const plan = opts.planId ? await prisma.membershipPlan.findUniqueOrThrow({ where: { id: opts.planId } }) : await createPlan(ownerId, { priceCents: opts.priceCents ?? 10_000, name: `Plan ${randomUUID().slice(0, 5)}`, ...opts.planExtra })
  const member = await createMember(ownerId)
  const when = at(opts.day ?? -1)
  const actor = seller ? actorOf(seller) : undefined
  const sold = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', startDate: when, actor, soldByStaffIds: opts.soldBy }))
  let payment = null
  if (opts.pay !== false && sold.invoice) payment = (await tx((db) => recordPayment(db, { ownerId, invoiceId: sold.invoice!.id, method: 'cash', actor, at: when })))
  return { plan, member, membership: sold.membership, invoice: sold.invoice!, payment: payment! }
}
const refund = (ownerId: string, transactionId: string, amountCents?: number, extra: Record<string, unknown> = {}) => tx((db) => refundTransaction(db, { ownerId, transactionId, amountCents, reason: 'Test', ...extra }))

/** A coach with an appointment type, and a way to put appointments on record in any state. */
async function coaching(ownerId: string, name = 'Cora Coach') {
  const coach = await person(ownerId, name, { role: 'coach', isCoach: true })
  const type = await prisma.appointmentType.create({ data: { ownerId, name: 'Personal Training', durationMin: 60, paymentMode: 'paid', priceCents: 8000 } })
  const appointment = async (opts: { day?: number; status?: string; paidCents?: number; staffId?: string; locationId?: string | null; typeId?: string } = {}) => {
    const member = await createMember(ownerId)
    const startsAt = at(opts.day ?? -1, '10:00')
    let invoiceId: string | null = null
    let payment = null
    if (opts.paidCents) {
      const invoice = await tx((db) => createInvoice(db, { ownerId, memberId: member.id, items: [{ description: 'Personal Training', type: 'other', unitPriceCents: 8000, taxRateBps: 0 }], dueDate: startsAt }))
      invoiceId = invoice.id
      payment = (await tx((db) => recordPayment(db, { ownerId, invoiceId: invoice.id, method: 'cash', amountCents: opts.paidCents, at: new Date(startsAt.getTime() - HOUR) })))
    }
    const a = await prisma.appointment.create({
      data: { ownerId, typeId: opts.typeId || type.id, memberId: member.id, staffId: opts.staffId || coach.id, locationId: opts.locationId || null, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), status: opts.status || 'completed', paymentMode: opts.paidCents ? 'paid' : 'credits', priceCents: opts.paidCents ? 8000 : 0, invoiceId, completedAt: opts.status && opts.status !== 'completed' ? null : startsAt },
    })
    return { appointment: a, member, invoiceId, payment }
  }
  return { coach, type, appointment }
}

// ===========================================================================
describe('payroll: configuration', () => {
  it('validates pay rates and commission rules before anything is stored', () => {
    expect(compensationSchema.safeParse({ basePay: 'hourly', hourlyRateCents: 0 }).success).toBe(false)
    expect(compensationSchema.safeParse({ basePay: 'salary' }).success).toBe(false)
    expect(compensationSchema.safeParse({ basePay: 'flat', flatPerPeriodCents: -5 }).success).toBe(false)
    expect(compensationSchema.safeParse({ basePay: 'hourly', hourlyRateCents: 2000.5 }).success).toBe(false)
    expect(compensationSchema.safeParse({ basePay: 'weekly' }).success).toBe(false)
    const loc = randomUUID()
    expect(compensationSchema.safeParse({ basePay: 'none', overrides: [{ locationId: loc, basePay: 'none' }, { locationId: loc, basePay: 'none' }] }).success).toBe(false)
    expect(compensationSchema.safeParse({ basePay: 'hourly', hourlyRateCents: 2200, perSessionCents: 3000, perClassCents: 2500 }).success).toBe(true)
    for (const bad of [rule('membership_sale', '0'), rule('membership_sale', '101'), rule('membership_sale', 0), rule('class', '10'), { trigger: 'tips', rateType: 'flat', flatCents: 100 }, { trigger: 'class', rateType: 'bonus', flatCents: 100 }]) expect(planSchema.safeParse({ name: 'P', rules: [bad] }).success, JSON.stringify(bad)).toBe(false)
    expect(planSchema.safeParse({ name: '', rules: [] }).success).toBe(false)
    expect(planSchema.safeParse({ name: 'P', rules: [rule('membership_sale', '12.5'), rule('class', 1500), rule('appointment', '40', { includeNoShow: true })] }).success).toBe(true)
    expect(attributionSchema.safeParse({ shares: [{ staffId: randomUUID(), sharePercent: 60 }, { staffId: randomUUID(), sharePercent: 30 }] }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ staffId: randomUUID(), type: 'bonus', amountCents: 5000, reason: '' }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ staffId: randomUUID(), type: 'bonus', amountCents: -5000, reason: 'Negative' }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ staffId: randomUUID(), type: 'tip', amountCents: 5000, reason: 'Unknown type' }).success).toBe(false)
    expect(periodCreateSchema.safeParse({ startDate: '2026-02-30', endDate: '2026-03-01' }).success).toBe(false)
    expect(timeSchema.safeParse({ staffId: randomUUID(), workDate: today, minutes: 25 * 60 }).success).toBe(false)
  })

  it('stores each person\'s pay, a different rate at another location, and one commission plan at a time', async () => {
    const g = await gym()
    const other = await gym()
    const [downtown, uptown] = await Promise.all(['Downtown', 'Uptown'].map((name) => prisma.location.create({ data: { ownerId: g, name } })))
    const theirLocation = await prisma.location.create({ data: { ownerId: other, name: 'Elsewhere' } })
    const sam = await person(g, 'Sam Sales')
    const first = await createCommissionPlan(g, planSchema.parse({ name: 'Starter', rules: [rule('membership_sale', '10')] }), boss)
    const second = await createCommissionPlan(g, planSchema.parse({ name: 'Senior', rules: [rule('membership_sale', '15'), rule('membership_renewal', 500)] }), boss)
    await saveCompensation(g, sam.id, comp({ basePay: 'hourly', hourlyRateCents: 2000, perSessionCents: 3000, overrides: [{ locationId: uptown.id, basePay: 'hourly', hourlyRateCents: 2600, perSessionCents: 4000 }], commissionPlanId: first.id, notes: 'Reviewed in October' }), boss)
    let row = (await listCompensation(g)).staff.find((s) => s.id === sam.id)!
    expect(row).toMatchObject({ basePay: 'hourly', hourlyRateCents: 2000, perSessionCents: 3000, configured: true, commissionPlanId: first.id, commissionPlanName: 'Starter', commissionSince: today, notes: 'Reviewed in October', overrides: [{ locationId: uptown.id, hourlyRateCents: 2600, perSessionCents: 4000 }] })
    // Saving again without mentioning the plan leaves it alone; naming another one switches; null takes them off.
    await saveCompensation(g, sam.id, comp({ basePay: 'salary', annualSalaryCents: 5_200_000 }), boss)
    row = (await listCompensation(g)).staff.find((s) => s.id === sam.id)!
    expect(row).toMatchObject({ basePay: 'salary', annualSalaryCents: 5_200_000, hourlyRateCents: 0, overrides: [], commissionPlanId: first.id })
    await saveCompensation(g, sam.id, comp({ commissionPlanId: second.id }), boss)
    expect(await prisma.commissionAssignment.findMany({ where: { staffId: sam.id } })).toMatchObject([{ planId: second.id, startsOn: today, endsOn: null }])
    await saveCompensation(g, sam.id, comp({ commissionPlanId: null }), boss)
    expect(await prisma.commissionAssignment.count({ where: { staffId: sam.id } })).toBe(0)
    expect((await listPlans(g)).plans.find((p) => p.id === second.id)).toMatchObject({ name: 'Senior', staff: [], rules: [{ summary: '15% of membership sales' }, { summary: '$5 per renewal' }] })
    // Every change of pay is on record.
    expect((await prisma.payrollEvent.findMany({ where: { ownerId: g, staffId: sam.id, type: 'compensation_changed' } })).length).toBe(4)
    // Nothing reaches across gyms: their staff, their location, their plan, their membership plan in a rule.
    await expect(saveCompensation(other, sam.id, comp(), boss)).rejects.toMatchObject({ status: 404 })
    await expect(saveCompensation(g, sam.id, comp({ overrides: [{ locationId: theirLocation.id, basePay: 'none' }] }), boss)).rejects.toMatchObject({ status: 404 })
    const theirs = await createCommissionPlan(other, planSchema.parse({ name: 'Theirs', rules: [] }), boss)
    await expect(saveCompensation(g, sam.id, comp({ commissionPlanId: theirs.id }), boss)).rejects.toMatchObject({ status: 404 })
    await expect(updatePlan(g, theirs.id, planSchema.parse({ name: 'Mine now', rules: [] }), boss)).rejects.toMatchObject({ status: 404 })
    const theirPlan = await createPlan(other)
    await expect(createCommissionPlan(g, planSchema.parse({ name: 'X', rules: [rule('membership_sale', '10', { planIds: [theirPlan.id] })] }), boss)).rejects.toMatchObject({ status: 404 })
    expect((await listCompensation(other)).staff.map((s) => s.id)).not.toContain(sam.id)
    expect(downtown.id).not.toBe(uptown.id)
    // An archived plan cannot be given to anyone new.
    await updatePlan(g, first.id, planSchema.parse({ name: 'Starter', isActive: false, rules: [rule('membership_sale', '10')] }), boss)
    await expect(saveCompensation(g, sam.id, comp({ commissionPlanId: first.id }), boss)).rejects.toMatchObject({ status: 400, code: 'plan_archived' })
  })
})

// ===========================================================================
describe('payroll: commission on sales', () => {
  it('pays the seller a percentage of what was actually received, before tax, and a fixed amount once per sale', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await onPlan(g, [sam], [rule('membership_sale', '10'), rule('membership_sale', 2000)])
    const p = await period(g, -10, 5)
    // $150 plus 8% tax, paid in two parts.
    const s = await sale(g, sam, { priceCents: 15_000, planExtra: { taxRateBps: 800 }, pay: false, day: -3 })
    expect(s.invoice).toMatchObject({ totalCents: 16_200, taxCents: 1200 })
    const first = (await tx((db) => recordPayment(db, { ownerId: g, invoiceId: s.invoice.id, method: 'cash', amountCents: 10_800, actor: actorOf(sam), at: at(-3) })))
    await syncPayroll(g)
    // Two thirds paid: two thirds of the pre-tax price is the basis.
    expect(await lines(g)).toMatchObject([
      { kind: 'commission', staffId: sam.id, staffName: 'Sam Sales', trigger: 'membership_sale', rateType: 'percent', percentBps: 1000, basisCents: 10_000, grossCents: 10_800, amountCents: 1000, periodId: p.id, sourceType: 'transaction', sourceId: first.id, invoiceId: s.invoice.id, memberId: s.member.id, commissionPlanName: 'Standard', sharePercent: 100, carried: false },
      { kind: 'commission', rateType: 'flat', flatCents: 2000, basisCents: 0, amountCents: 2000 },
    ])
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: s.invoice.id, method: 'cash', actor: actorOf(sam), at: at(-2) }))
    await syncPayroll(g)
    // The rest: the percentage on the rest, and no second fixed amount.
    expect(await amounts(g)).toEqual([['commission', 1000], ['commission', 2000], ['commission', 500]])
    // Working it out again changes nothing, however many times and however many at once.
    const before = JSON.stringify(await lines(g))
    await syncPayroll(g)
    expect((await Promise.all(Array.from({ length: 6 }, () => syncPayroll(g)))).every((r) => r.created === 0)).toBe(true)
    expect(JSON.stringify(await lines(g))).toBe(before)
    expect(await total(g)).toBe(3500)
    // A failed or pending payment, an unpaid invoice and a sale by the owner earn nobody anything.
    await sale(g, sam, { pay: false })
    const byOwner = await sale(g, null, { day: -1 })
    await prisma.transaction.create({ data: { ownerId: g, invoiceId: byOwner.invoice.id, type: 'payment', status: 'failed', amountCents: 5000, method: 'card', staffId: sam.id } })
    await prisma.transaction.create({ data: { ownerId: g, invoiceId: byOwner.invoice.id, type: 'payment', status: 'pending', amountCents: 5000, method: 'ach', staffId: sam.id } })
    await syncPayroll(g)
    expect(await total(g)).toBe(3500)
  })

  it('only counts what a rule covers: its plans, its kind of sale, and the days the person was on the plan', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    const gold = await createPlan(g, { name: 'Gold', priceCents: 20_000 })
    const pack = await createPlan(g, { name: '10 Pack', type: 'class_pack', priceCents: 12_000, credits: 10, billingInterval: 'once' })
    const pt = await createPlan(g, { name: 'PT 5', type: 'pt_package', priceCents: 30_000, credits: 5, billingInterval: 'once' })
    const planId = await onPlan(g, [sam], [rule('membership_sale', '10', { planIds: [gold.id] }), rule('package_sale', '5'), rule('package_sale', 1000, { planIds: [pt.id] })])
    await period(g, -30, 5)
    await sale(g, sam, { planId: gold.id })
    await sale(g, sam, { priceCents: 9000 })
    await sale(g, sam, { planId: pack.id })
    await sale(g, sam, { planId: pt.id })
    await syncPayroll(g)
    expect((await lines(g)).map((l) => [l.trigger, l.rateType, l.amountCents]).sort()).toEqual([['membership_sale', 'percent', 2000], ['package_sale', 'flat', 1000], ['package_sale', 'percent', 1500], ['package_sale', 'percent', 600]].sort())
    // A sale made before they were put on the plan, or after they came off it, is not theirs to be paid for.
    await prisma.commissionAssignment.updateMany({ where: { ownerId: g, planId }, data: { startsOn: d(-8), endsOn: d(-4) } })
    await sale(g, sam, { planId: gold.id, day: -9 })
    await sale(g, sam, { planId: gold.id, day: -3 })
    const inside = await sale(g, sam, { planId: gold.id, day: -6 })
    await syncPayroll(g)
    expect((await lines(g, { trigger: 'membership_sale' })).map((l) => l.sourceId)).toContain(inside.payment.id)
    expect(await total(g, { trigger: 'membership_sale' })).toBe(4000)
    // Changing the plan's rate changes what is earned from now on, and nothing already in the ledger.
    await prisma.commissionAssignment.updateMany({ where: { ownerId: g, planId }, data: { startsOn: d(-400), endsOn: null } })
    await updatePlan(g, planId, planSchema.parse({ name: 'Standard', rules: [rule('membership_sale', '25')] }), boss)
    await syncPayroll(g)
    expect(await total(g, { trigger: 'membership_sale' })).toBe(4000)
    await sale(g, sam, { planId: gold.id, day: -1 })
    await syncPayroll(g)
    expect((await lines(g, { trigger: 'membership_sale' })).map((l) => [l.percentBps, l.amountCents])).toEqual(expect.arrayContaining([[1000, 2000], [2500, 5000]]))
    expect(await total(g, { trigger: 'membership_sale' })).toBe(9000)
  })

  it('credits renewals to whoever sold the membership, and an upgrade to whoever made it', async () => {
    const g = await gym()
    const [sam, uma] = [await person(g, 'Sam Sales'), await person(g, 'Uma Upsell')]
    await onPlan(g, [sam, uma], [rule('membership_sale', '10'), rule('membership_renewal', '5'), rule('membership_upgrade', '20')])
    await period(g, -45, 5)
    const start = at(-15)
    const basic = await createPlan(g, { name: 'Basic', priceCents: 10_000 })
    const premium = await createPlan(g, { name: 'Premium', priceCents: 16_000 })
    const member = await createMember(g)
    const sold = await tx((db) => sellMembership(db, { ownerId: g, memberId: member.id, planId: basic.id, paymentMethod: 'cash', startDate: start, actor: actorOf(sam) }))
    const end = new Date(start.getTime() + 30 * DAY)
    await prisma.membership.update({ where: { id: sold.membership.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } })
    await prisma.invoice.update({ where: { id: sold.invoice!.id }, data: { periodStart: start, periodEnd: end } })
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: sold.invoice!.id, method: 'cash', actor: actorOf(sam), at: start }))
    expect((await getAttribution(g, sold.membership.id)).shares).toEqual([{ staffId: sam.id, staffName: 'Sam Sales', sharePercent: 100 }])

    // Uma upgrades the member half way through the period.
    const base = { ownerId: g, membershipId: sold.membership.id, planId: premium.id, effective: 'now' as const, source: 'staff' as const, at: new Date(start.getTime() + 15 * DAY) }
    const preview = await previewPlanChange(base)
    const changed = await applyPlanChange({ ...base, expected: { fromPlanId: preview.from.id, amountDueNowCents: preview.calc.amountDueNowCents, creditCents: preview.calc.creditCents }, idempotencyKey: randomUUID(), actor: actorOf(uma) })
    expect(changed.amountDueNowCents).toBe(3000)
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: changed.invoiceId!, method: 'cash', actor: actorOf(uma), at: at(0, '00:30') }))
    // The next period is billed by the system and paid by card: nobody is at the desk for it.
    const renewal = await tx((db) => createInvoice(db, { ownerId: g, memberId: member.id, membershipId: sold.membership.id, items: [{ description: 'Premium', type: 'membership', unitPriceCents: 16_000, planId: premium.id, taxRateBps: 0 }], periodStart: end, periodEnd: new Date(end.getTime() + 30 * DAY) }))
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: renewal.id, method: 'card', provider: 'stripe', at: at(0, '01:00') }))
    await syncPayroll(g)
    expect((await lines(g)).map((l) => [l.staffName, l.trigger, l.basisCents, l.amountCents])).toEqual([
      ['Sam Sales', 'membership_sale', 10_000, 1000],
      ['Uma Upsell', 'membership_upgrade', 3000, 600],
      ['Sam Sales', 'membership_renewal', 16_000, 800],
    ])
    // A downgrade charges nothing, so there is nothing to pay commission on, and nothing is taken back.
    const down = { ...base, planId: basic.id, at: new Date(start.getTime() + 16 * DAY) }
    const p2 = await previewPlanChange(down)
    const lowered = await applyPlanChange({ ...down, expected: { fromPlanId: p2.from.id, amountDueNowCents: p2.calc.amountDueNowCents, creditCents: p2.calc.creditCents }, idempotencyKey: randomUUID(), actor: actorOf(uma) })
    expect(lowered.amountDueNowCents).toBe(0)
    await syncPayroll(g)
    expect(await total(g)).toBe(2400)
  })

  it('splits a sale between the people credited with it, and never pays more than the whole', async () => {
    const g = await gym()
    const [sam, uma, vic] = [await person(g, 'Sam Sales'), await person(g, 'Uma Upsell'), await person(g, 'Vic Third')]
    await onPlan(g, [sam, uma, vic], [rule('membership_sale', '10'), rule('membership_sale', 1001), rule('membership_renewal', '10')])
    await period(g, -20, 5)
    const s = await sale(g, sam, { priceCents: 9999, soldBy: [sam.id, uma.id, vic.id], day: -5 })
    expect((await getAttribution(g, s.membership.id)).shares.map((x) => x.sharePercent).sort()).toEqual([33, 33, 34])
    await syncPayroll(g)
    const made = await lines(g)
    expect(made).toHaveLength(6)
    const pct = made.filter((l) => l.rateType === 'percent')
    expect(pct.map((l) => l.sharePercent).sort()).toEqual([33, 33, 34])
    expect(pct.reduce((a, l) => a + l.amountCents, 0)).toBe(1000)
    expect(pct.every((l) => l.basisCents === 9999)).toBe(true)
    expect(made.filter((l) => l.rateType === 'flat').reduce((a, l) => a + l.amountCents, 0)).toBeLessThanOrEqual(1001)
    // Re-crediting applies to money not yet worked out: the next renewal, 70/30 between two of them.
    await setAttribution(g, s.membership.id, attributionSchema.parse({ shares: [{ staffId: uma.id, sharePercent: 70 }, { staffId: vic.id, sharePercent: 30 }] }), boss)
    await syncPayroll(g)
    expect(await lines(g)).toHaveLength(6)
    const renewal = await tx((db) => createInvoice(db, { ownerId: g, memberId: s.member.id, membershipId: s.membership.id, items: [{ description: 'Renewal', type: 'membership', unitPriceCents: 10_000, planId: s.plan.id, taxRateBps: 0 }], periodStart: at(25), periodEnd: at(55) }))
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: renewal.id, method: 'card', at: at(0, '00:10') }))
    await syncPayroll(g)
    expect((await lines(g, { trigger: 'membership_renewal' })).map((l) => [l.staffName, l.sharePercent, l.amountCents]).sort()).toEqual([['Uma Upsell', 70, 700], ['Vic Third', 30, 300]])
    // A sale nobody was credited with can be credited afterwards, and is then paid once.
    const orphan = await sale(g, null, { priceCents: 5000, day: -4 })
    await syncPayroll(g)
    expect(await lines(g, { sourceId: orphan.payment.id })).toHaveLength(0)
    await setAttribution(g, orphan.membership.id, attributionSchema.parse({ shares: [{ staffId: sam.id, sharePercent: 100 }] }), boss)
    await syncPayroll(g); await syncPayroll(g)
    expect((await lines(g, { sourceId: orphan.payment.id })).map((l) => [l.staffName, l.amountCents]).sort()).toEqual([['Sam Sales', 1001], ['Sam Sales', 500]])
    // Someone from another gym cannot be credited, and shares must be whole.
    const stranger = await person(await gym(), 'Stranger')
    await expect(setAttribution(g, orphan.membership.id, attributionSchema.parse({ shares: [{ staffId: stranger.id, sharePercent: 100 }] }), boss)).rejects.toMatchObject({ status: 404 })
    await expect(setAttribution(stranger.ownerId, orphan.membership.id, attributionSchema.parse({ shares: [] }), boss)).rejects.toMatchObject({ status: 404 })
  })
})

// ===========================================================================
describe('payroll: refunds', () => {
  it('takes back commission in proportion to a partial refund, all of it on a full one, and never more', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await onPlan(g, [sam], [rule('membership_sale', '10'), rule('membership_sale', 2000)])
    const p = await period(g, -10, 5)
    const s = await sale(g, sam, { priceCents: 9000, day: -4 })
    await syncPayroll(g)
    expect(await total(g)).toBe(2900)
    // A third back.
    const first = await refund(g, s.payment.id, 3000)
    await syncPayroll(g)
    const reversals = await lines(g, { kind: 'refund_reversal' })
    expect(reversals.map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([-667, -300])
    expect(reversals[0]).toMatchObject({ staffId: sam.id, periodId: p.id, sourceType: 'transaction', sourceId: first.refund.id, trigger: 'membership_sale', grossCents: 3000, memberId: s.member.id })
    expect(reversals.every((l) => l.reversesEntryId)).toBe(true)
    // The same refund seen again (a repeated webhook, a second sync) takes nothing more.
    await syncPayroll(g); await Promise.all([syncPayroll(g), syncPayroll(g), syncPayroll(g)])
    expect(await total(g)).toBe(2900 - 967)
    // The rest back: exactly nothing is left, with no rounding crumbs.
    await refund(g, s.payment.id)
    await syncPayroll(g)
    expect(await total(g)).toBe(0)
    expect(await lines(g)).toHaveLength(6)
    // The original lines are untouched.
    expect((await lines(g, { kind: 'commission' })).map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([900, 2000])
    await expect(refund(g, s.payment.id, 100)).rejects.toMatchObject({ code: 'already_refunded' })
  })

  it('waits for a pending refund to settle, and restores the commission if a refund fails afterwards', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await onPlan(g, [sam], [rule('membership_sale', '10')])
    await period(g, -10, 5)
    const s = await sale(g, sam, { priceCents: 20_000, day: -4 })
    const pending = await refund(g, s.payment.id, 10_000, { status: 'pending', providerReference: 're_1' })
    await syncPayroll(g)
    expect(await total(g)).toBe(2000)
    await tx((db) => settleRefund(db, { ownerId: g, refundId: pending.refund.id, outcome: 'succeeded' }))
    await syncPayroll(g)
    expect(await total(g)).toBe(1000)
    // The bank bounces it after all: the money never went back.
    await tx((db) => settleRefund(db, { ownerId: g, refundId: pending.refund.id, outcome: 'failed', failureReason: 'Account closed' }))
    await syncPayroll(g); await syncPayroll(g)
    expect(await amounts(g)).toEqual([['commission', 2000], ['refund_reversal', -1000], ['commission', 1000]])
    // And what is left to reverse is the whole commission again.
    await refund(g, s.payment.id)
    await syncPayroll(g)
    expect(await total(g)).toBe(0)
  })

  it('puts the reversal of a commission already paid out into the pay period that is open now', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await onPlan(g, [sam], [rule('membership_sale', '10')])
    const old = await period(g, -40, -21)
    const s = await sale(g, sam, { priceCents: 30_000, day: -30 })
    await syncPayroll(g)
    for (const step of ['submit', 'approve', 'finalize']) await act(g, old.id, step)
    const now = await period(g, -20, 5)
    await refund(g, s.payment.id, 15_000)
    await syncPayroll(g)
    // The locked period still says what it said; the open one carries the minus.
    expect(await amounts(g, { periodId: old.id })).toEqual([['commission', 3000]])
    expect(await amounts(g, { periodId: now.id })).toEqual([['refund_reversal', -1500]])
    expect((await periodDetail(g, old.id)).integrity).toEqual({ ok: true, lockedTotalCents: 3000 })
    expect((await periodDetail(g, now.id)).staff).toMatchObject([{ staffName: 'Sam Sales', commissionCents: 0, reversalCents: -1500, totalCents: -1500 }])
  })
})

describe('payroll: a large backlog', () => {
  it('works through hundreds of payments in batches, and never reverses a refund before its payment has been worked out', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await onPlan(g, [sam], [rule('package_sale', '10')])
    const plan = await createPlan(g, { name: 'Drop-in', type: 'drop_in', priceCents: 2000, credits: 1, billingInterval: 'once' })
    const member = await createMember(g)
    // 620 paid invoices written directly: more than two batches' worth, with the oldest and the newest refunded.
    const n = 620
    const base = at(-9).getTime()
    const membership = await prisma.membership.create({ data: { ownerId: g, memberId: member.id, planId: plan.id, priceCents: 2000, status: 'active' } })
    await prisma.saleAttribution.create({ data: { ownerId: g, membershipId: membership.id, staffId: sam.id, staffName: sam.name, sharePercent: 100 } })
    const invoices = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), ownerId: g, memberId: member.id, membershipId: membership.id, number: `B-${i}`, status: 'paid', subtotalCents: 2000, totalCents: 2000, amountPaidCents: 2000, createdAt: new Date(base + i * 1000) }))
    await prisma.invoice.createMany({ data: invoices })
    await prisma.invoiceItem.createMany({ data: invoices.map((inv) => ({ invoiceId: inv.id, description: 'Drop-in', type: 'class_pack', unitPriceCents: 2000, amountCents: 2000, planId: plan.id })) })
    const payments = invoices.map((inv, i) => ({ id: randomUUID(), ownerId: g, memberId: member.id, invoiceId: inv.id, type: 'payment', status: 'succeeded', amountCents: 2000, method: 'cash', staffId: sam.id, createdAt: new Date(base + i * 1000) }))
    await prisma.transaction.createMany({ data: payments })
    // The refunds are dated before most of the payments, so a batch that took the oldest 250 payments would meet them early.
    for (const [i, when] of [[0, 1500], [n - 1, 2500]] as const) {
      await prisma.transaction.create({ data: { ownerId: g, memberId: member.id, invoiceId: invoices[i].id, type: 'refund', status: 'succeeded', amountCents: 2000, method: 'cash', parentTransactionId: payments[i].id, createdAt: new Date(base + when) } })
      await prisma.transaction.update({ where: { id: payments[i].id }, data: { refundedCents: 2000 } })
    }
    const p = await period(g, -10, 5)
    // Creating the period worked out one batch; the rest follows on the next sync, and nothing is done twice.
    await syncPayroll(g)
    expect((await syncPayroll(g)).created).toBe(0)
    expect(await prisma.payrollEntry.count({ where: { ownerId: g, kind: 'commission' } })).toBe(n)
    expect(await total(g, { kind: 'commission' })).toBe(n * 200)
    expect(await amounts(g, { kind: 'refund_reversal' })).toEqual([['refund_reversal', -200], ['refund_reversal', -200]])
    expect(await total(g, { periodId: p.id })).toBe((n - 2) * 200)
    // Approval refuses nothing here because everything is caught up.
    await act(g, p.id, 'submit')
    expect(await act(g, p.id, 'approve')).toMatchObject({ status: 'approved' })
  }, 120_000)
})

// ===========================================================================
describe('payroll: appointments and classes', () => {
  it('pays for appointments that happened: a rate per session, a share of the revenue, and nothing for a cancellation', async () => {
    const g = await gym()
    const { coach, type, appointment } = await coaching(g)
    const other = await prisma.appointmentType.create({ data: { ownerId: g, name: 'Assessment', durationMin: 30, paymentMode: 'included' } })
    await saveCompensation(g, coach.id, comp({ perSessionCents: 2500 }), boss)
    await onPlan(g, [coach], [rule('appointment', '40', { appointmentTypeIds: [type.id] }), rule('appointment', 500), rule('appointment', 1500, { includeNoShow: true, appointmentTypeIds: [other.id] })])
    const p = await period(g, -10, 5)
    const done = await appointment({ paidCents: 8000, day: -3 })
    await appointment({ paidCents: 8000, day: -3, status: 'cancelled' })
    await appointment({ paidCents: 8000, day: -3, status: 'late_cancelled' })
    await appointment({ paidCents: 8000, day: 1, status: 'booked' })
    await syncPayroll(g)
    expect((await lines(g)).map((l) => [l.kind, l.rateType, l.basisCents, l.amountCents])).toEqual([['session_pay', null, 0, 2500], ['commission', 'percent', 8000, 3200], ['commission', 'flat', 0, 500]])
    expect((await lines(g))[1]).toMatchObject({ staffId: coach.id, sourceType: 'appointment', sourceId: done.appointment.id, invoiceId: done.invoiceId, trigger: 'appointment', memberId: done.member.id, periodId: p.id, grossCents: 8000 })
    // The payment itself was not also counted as a sale.
    expect(await lines(g, { sourceType: 'transaction' })).toHaveLength(0)
    // A session from a package: no price of its own, so the fixed rates only.
    await appointment({ day: -2 })
    await syncPayroll(g)
    expect(await total(g)).toBe(6200 + 2500 + 500)
    // A no-show pays only where the rule says it does.
    await appointment({ paidCents: 8000, day: -2, status: 'no_show' })
    await appointment({ day: -2, status: 'no_show', typeId: other.id })
    await syncPayroll(g); await syncPayroll(g)
    expect(await total(g)).toBe(9200 + 1500)
    expect(await lines(g, { kind: 'session_pay' })).toHaveLength(2)
  })

  it('counts appointment money once whenever it arrives, and takes it back if it is refunded', async () => {
    const g = await gym()
    const { coach, appointment } = await coaching(g)
    await saveCompensation(g, coach.id, comp({ perSessionCents: 2000 }), boss)
    await onPlan(g, [coach], [rule('appointment', '50')])
    await period(g, -10, 5)
    // Half paid before the session, the rest a day after.
    const a = await appointment({ paidCents: 4000, day: -3 })
    await syncPayroll(g)
    expect(await total(g, { kind: 'commission' })).toBe(2000)
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: a.invoiceId!, method: 'cash', at: at(-2) }))
    await syncPayroll(g); await syncPayroll(g)
    expect((await lines(g, { kind: 'commission' })).map((l) => [l.sourceType, l.basisCents, l.amountCents])).toEqual([['appointment', 4000, 2000], ['transaction', 4000, 2000]])
    // Refund the first payment in full, and a quarter of the second.
    await refund(g, a.payment!.id)
    const second = await prisma.transaction.findFirstOrThrow({ where: { invoiceId: a.invoiceId!, type: 'payment', id: { not: a.payment!.id } } })
    await refund(g, second.id, 1000)
    await syncPayroll(g); await syncPayroll(g)
    expect(await total(g, { kind: 'refund_reversal' })).toBe(-2500)
    // The coach still did the session: the per-session pay stays.
    expect(await total(g, { kind: 'session_pay' })).toBe(2000)
    // Refunded before it ever happened, then delivered anyway: commission on what was kept only.
    const b = await appointment({ paidCents: 8000, day: -1, status: 'booked' })
    await refund(g, b.payment!.id, 6000)
    await syncPayroll(g)
    await prisma.appointment.update({ where: { id: b.appointment.id }, data: { status: 'completed', completedAt: new Date() } })
    await syncPayroll(g)
    expect((await lines(g, { sourceId: b.appointment.id, kind: 'commission' })).map((l) => [l.basisCents, l.amountCents])).toEqual([[2000, 1000]])
    expect(await total(g, { kind: 'refund_reversal' })).toBe(-2500)
  })

  it('pays for classes that were taught, at the rate for where they were taught, and takes it back if the class is cancelled afterwards', async () => {
    const g = await gym()
    const coach = await person(g, 'Cora Coach', { role: 'coach', isCoach: true })
    const uptown = await prisma.location.create({ data: { ownerId: g, name: 'Uptown' } })
    await saveCompensation(g, coach.id, comp({ perClassCents: 3000, overrides: [{ locationId: uptown.id, basePay: 'none', perClassCents: 4500 }] }), boss)
    await onPlan(g, [coach], [rule('class', 500)])
    await period(g, -10, 5)
    const taught = await createSession(g, { coachId: coach.id, startsAt: at(-3, '09:00'), endsAt: at(-3, '10:00') })
    const away = await createSession(g, { coachId: coach.id, locationId: uptown.id, startsAt: at(-2, '09:00'), endsAt: at(-2, '10:00') })
    await createSession(g, { coachId: coach.id, startsAt: at(2, '09:00'), endsAt: at(2, '10:00') })
    await createSession(g, { coachId: coach.id, startsAt: at(-3, '12:00'), endsAt: at(-3, '13:00'), status: 'cancelled' })
    await createSession(g, { startsAt: at(-3, '15:00'), endsAt: at(-3, '16:00') })
    await syncPayroll(g)
    expect((await lines(g)).map((l) => [l.kind, l.sourceId, l.locationId, l.amountCents])).toEqual([['class_pay', taught.id, null, 3000], ['commission', taught.id, null, 500], ['class_pay', away.id, uptown.id, 4500], ['commission', away.id, uptown.id, 500]])
    // Someone moves to another location: the work already done keeps the rate and place it was done at.
    await prisma.staff.update({ where: { id: coach.id }, data: { locationId: uptown.id } })
    await saveCompensation(g, coach.id, comp({ perClassCents: 9000 }), boss)
    await prisma.classSession.update({ where: { id: taught.id }, data: { status: 'cancelled', cancelReason: 'Entered by mistake' } })
    await syncPayroll(g); await syncPayroll(g)
    expect(await total(g, { sourceId: taught.id })).toBe(0)
    expect(await total(g, { sourceId: away.id })).toBe(5000)
    expect(await lines(g)).toHaveLength(6)
    const detail = await periodDetail(g, (await listPeriods(g)).periods[0].id, { locationId: uptown.id })
    expect(detail.totals.totalCents).toBe(5000)
  })
})

// ===========================================================================
describe('payroll: base pay, hours and people who have left', () => {
  it('works out salary by the day and flat pay by the period, and corrects it with a new line when pay changes', async () => {
    const g = await gym()
    const [sal, flo, non] = [await person(g, 'Sal Salary'), await person(g, 'Flo Flat'), await person(g, 'Non Paid')]
    await saveCompensation(g, sal.id, comp({ basePay: 'salary', annualSalaryCents: 3_650_000 }), boss)
    await saveCompensation(g, flo.id, comp({ basePay: 'flat', flatPerPeriodCents: 40_000 }), boss)
    const p = await period(g, -6, 7)
    expect(await amounts(g, { periodId: p.id })).toEqual(expect.arrayContaining([['base_salary', 140_000], ['base_flat', 40_000]]))
    expect(await lines(g, { staffId: non.id })).toHaveLength(0)
    await syncPayroll(g); await Promise.all([syncPayroll(g), syncPayroll(g), syncPayroll(g)])
    expect(await lines(g)).toHaveLength(2)
    // A raise part way through the period: the first line stays, a second makes up the difference.
    await saveCompensation(g, sal.id, comp({ basePay: 'salary', annualSalaryCents: 7_300_000 }), boss)
    await saveCompensation(g, flo.id, comp({ basePay: 'none' }), boss)
    await syncPayroll(g); await syncPayroll(g)
    expect((await lines(g, { staffId: sal.id })).map((l) => l.amountCents)).toEqual([140_000, 140_000])
    expect((await lines(g, { staffId: flo.id })).map((l) => l.amountCents)).toEqual([40_000, -40_000])
    // A second period gets its own.
    const next = await period(g, 8, 21)
    expect(await amounts(g, { periodId: next.id })).toEqual([['base_salary', 280_000]])
  })

  it('pays hours at the rate for where they were worked, and removes hours by adding a cancelling line', async () => {
    const g = await gym()
    const [hal, sal] = [await person(g, 'Hal Hourly'), await person(g, 'Sal Salary')]
    const uptown = await prisma.location.create({ data: { ownerId: g, name: 'Uptown' } })
    await saveCompensation(g, hal.id, comp({ basePay: 'hourly', hourlyRateCents: 2000, overrides: [{ locationId: uptown.id, basePay: 'hourly', hourlyRateCents: 2600 }] }), boss)
    await saveCompensation(g, sal.id, comp({ basePay: 'salary', annualSalaryCents: 4_000_000 }), boss)
    const p = await period(g, -6, 7)
    const time = (extra: Record<string, unknown>) => addTime(g, p.id, timeSchema.parse({ staffId: hal.id, workDate: d(-2), minutes: 450, ...extra }), boss)
    const first = await time({})
    await time({ locationId: uptown.id, minutes: 100, workDate: d(-1) })
    expect((await lines(g, { staffId: hal.id })).map((l) => [l.kind, l.minutes, l.rateCents, l.amountCents, l.locationId])).toEqual([['base_hourly', 450, 2000, 15_000, null], ['base_hourly', 100, 2600, 4333, uptown.id]])
    await expect(time({ workDate: d(-7) })).rejects.toMatchObject({ status: 400, code: 'outside_period' })
    await expect(time({ minutes: 1000 })).rejects.toMatchObject({ status: 400, code: 'too_many_hours' })
    await expect(addTime(g, p.id, timeSchema.parse({ staffId: sal.id, workDate: d(-2), minutes: 60 }), boss)).rejects.toMatchObject({ status: 400, code: 'not_hourly' })
    await expect(addTime(await gym(), p.id, timeSchema.parse({ staffId: hal.id, workDate: d(-2), minutes: 60 }), boss)).rejects.toMatchObject({ status: 404 })
    expect(await voidTime(g, p.id, first.id, boss)).toEqual({ voided: true })
    expect(await voidTime(g, p.id, first.id, boss)).toEqual({ voided: false })
    expect((await lines(g, { staffId: hal.id })).map((l) => l.amountCents)).toEqual([15_000, 4333, -15_000])
    const mine = await staffLines(g, p.id, hal.id)
    expect(mine.totals).toMatchObject({ baseCents: 4333, totalCents: 4333 })
    expect(mine.time.map((t) => [t.minutes, t.voided])).toEqual([[450, true], [100, false]])
    expect((await periodDetail(g, p.id)).staff.find((s) => s.staffId === hal.id)).toMatchObject({ minutes: 100, baseCents: 4333 })
  })

  it('earns nothing new for someone who has left, but still takes back what was refunded', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await saveCompensation(g, sam.id, comp({ basePay: 'flat', flatPerPeriodCents: 50_000 }), boss)
    await onPlan(g, [sam], [rule('membership_sale', '10'), rule('membership_renewal', '10')])
    const p = await period(g, -10, 5)
    const s = await sale(g, sam, { priceCents: 10_000, day: -5 })
    await syncPayroll(g)
    expect(await total(g)).toBe(51_000)
    await prisma.staff.update({ where: { id: sam.id }, data: { active: false } })
    // A renewal on their old sale, and a new period, after they have gone: nothing.
    const renewal = await tx((db) => createInvoice(db, { ownerId: g, memberId: s.member.id, membershipId: s.membership.id, items: [{ description: 'Renewal', type: 'membership', unitPriceCents: 10_000, planId: s.plan.id, taxRateBps: 0 }], periodStart: at(25), periodEnd: at(55) }))
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: renewal.id, method: 'card', at: at(0, '00:10') }))
    const next = await period(g, 6, 19)
    await syncPayroll(g)
    expect(await total(g)).toBe(51_000)
    expect(await lines(g, { periodId: next.id })).toHaveLength(0)
    // The refund of their sale still comes off what they are owed.
    await refund(g, s.payment.id)
    await syncPayroll(g)
    expect(await total(g, { periodId: p.id })).toBe(50_000)
    // They still appear in the period, by name, marked as no longer active.
    expect((await periodDetail(g, p.id)).staff).toMatchObject([{ staffName: 'Sam Sales', active: false, totalCents: 50_000 }])
    expect((await listCompensation(g)).staff.find((x) => x.id === sam.id)).toMatchObject({ active: false })
  })
})

// ===========================================================================
describe('payroll: pay periods', () => {
  it('refuses overlapping periods and puts each event in the period its date falls in, by the gym\'s own clock', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await onPlan(g, [sam], [rule('membership_sale', '10')])
    const a = await period(g, -20, -11)
    const b = await period(g, -10, 5)
    expect(a.name).toMatch(/ – .*, \d{4}$/)
    for (const [from, to] of [[-25, -20], [-11, -10], [-15, -12], [-30, 30], [5, 9]]) await expect(period(g, from, to)).rejects.toMatchObject({ status: 409, code: 'period_overlap' })
    await expect(period(g, 9, 6)).rejects.toMatchObject({ status: 400, code: 'bad_range' })
    await expect(period(g, 6, 200)).rejects.toMatchObject({ status: 400, code: 'too_long' })
    // Six people create the same period at once: one exists.
    const made = await Promise.allSettled(Array.from({ length: 6 }, () => period(g, 6, 19)))
    expect(made.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.payrollPeriod.count({ where: { ownerId: g } })).toBe(3)
    // One minute before midnight on the last day, and the stroke of midnight.
    const late = await sale(g, sam, { priceCents: 10_000, day: -11, pay: false })
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: late.invoice.id, method: 'cash', amountCents: 4000, actor: actorOf(sam), at: at(-11, '23:59') }))
    await tx((db) => recordPayment(db, { ownerId: g, invoiceId: late.invoice.id, method: 'cash', actor: actorOf(sam), at: at(-10, '00:00') }))
    // Before payroll began: not looked at.
    await sale(g, sam, { priceCents: 10_000, day: -25 })
    await syncPayroll(g)
    expect(await amounts(g, { periodId: a.id })).toEqual([['commission', 400]])
    expect(await amounts(g, { periodId: b.id })).toEqual([['commission', 600]])
    expect(await lines(g)).toHaveLength(2)
    const list = await listPeriods(g)
    expect(list.periods.map((p) => [p.startDate, p.status, p.totalCents, p.staffCount, p.current])).toEqual([[d(6), 'open', 0, 0, false], [d(-10), 'open', 600, 1, true], [d(-20), 'open', 400, 1, false]])
    expect(list.currentId).toBe(b.id)
    expect(list.suggestion).toEqual({ startDate: d(20), endDate: d(33) })
    await expect(periodDetail(await gym(), a.id)).rejects.toMatchObject({ status: 404 })
  })

  it('moves through review, approval and finalization, locks, and can only be reopened by someone allowed to', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    await saveCompensation(g, sam.id, comp({ basePay: 'hourly', hourlyRateCents: 2000 }), boss)
    await onPlan(g, [sam], [rule('membership_sale', '10')])
    const p = await period(g, -10, 5)
    await sale(g, sam, { priceCents: 10_000, day: -5 })
    // Steps cannot be skipped.
    await expect(act(g, p.id, 'approve')).rejects.toMatchObject({ status: 409, code: 'wrong_status' })
    await expect(act(g, p.id, 'finalize')).rejects.toMatchObject({ status: 409, code: 'wrong_status' })
    expect(await act(g, p.id, 'submit')).toMatchObject({ status: 'review', changed: true, locked: false })
    expect(await act(g, p.id, 'submit')).toMatchObject({ status: 'review', changed: false })
    // Review found the sale without anyone pressing refresh, and still takes changes.
    expect(await total(g, { periodId: p.id })).toBe(1000)
    const bonus = adjustmentSchema.parse({ staffId: sam.id, type: 'bonus', amountCents: 5000, reason: 'Sold the most in October' })
    await addAdjustment(g, p.id, bonus, boss)
    expect(await act(g, p.id, 'send_back')).toMatchObject({ status: 'open', changed: true })
    await act(g, p.id, 'submit')
    // A sale that lands just before approval is in what is approved.
    await sale(g, sam, { priceCents: 20_000, day: -1 })
    const approved = await act(g, p.id, 'approve')
    expect(approved).toMatchObject({ status: 'approved', changed: true, locked: true, approvedByName: 'Olive Owner' })
    expect(await total(g, { periodId: p.id })).toBe(8000)
    expect(await act(g, p.id, 'approve')).toMatchObject({ changed: false })
    // Locked: nothing new goes in, by any route.
    await expect(addAdjustment(g, p.id, bonus, boss)).rejects.toMatchObject({ status: 409, code: 'period_locked' })
    await expect(addTime(g, p.id, timeSchema.parse({ staffId: sam.id, workDate: d(-2), minutes: 60 }), boss)).rejects.toMatchObject({ status: 409, code: 'period_locked' })
    await expect(act(g, p.id, 'send_back')).rejects.toMatchObject({ status: 409 })
    const lateSale = await sale(g, sam, { priceCents: 30_000, day: -1 })
    await syncPayroll(g)
    expect(await total(g, { periodId: p.id })).toBe(8000)
    expect(await lines(g, { sourceId: lateSale.payment.id })).toMatchObject([{ periodId: null, amountCents: 3000 }])

    const final = await act(g, p.id, 'finalize')
    expect(final).toMatchObject({ status: 'finalized', changed: true, finalizedByName: 'Olive Owner' })
    const stored = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: p.id } })
    expect(stored.totals).toMatchObject({ totalCents: 8000, commissionCents: 3000, adjustmentCents: 5000, lines: 3, staff: [{ staffName: 'Sam Sales', totalCents: 8000 }] })
    expect((stored.totals as { fingerprint: string }).fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect((await periodDetail(g, p.id)).integrity).toEqual({ ok: true, lockedTotalCents: 8000 })
    await expect(addAdjustment(g, p.id, bonus, boss)).rejects.toMatchObject({ status: 409, code: 'period_locked' })
    // The sale that missed it is paid in the next period, marked as carried over.
    const next = await period(g, 6, 19)
    expect(await lines(g, { periodId: next.id })).toMatchObject([{ sourceId: lateSale.payment.id, amountCents: 3000, carried: true }])
    expect((await periodDetail(g, next.id)).carriedLines).toBe(1)
    // If the ledger and the locked figure ever disagreed, it would say so.
    await prisma.payrollEntry.create({ data: { ownerId: g, staffId: sam.id, staffName: 'Sam Sales', periodId: p.id, kind: 'adjustment', sourceKey: `tamper:${randomUUID()}`, sourceType: 'manual', amountCents: 99, description: 'Slipped in behind the lock', earnedAt: new Date() } })
    expect((await periodDetail(g, p.id)).integrity).toEqual({ ok: false, lockedTotalCents: 8000 })
    await prisma.payrollEntry.deleteMany({ where: { ownerId: g, description: 'Slipped in behind the lock' } })

    // Reopening needs the permission and a reason, is recorded, and unlocks.
    await expect(act(g, p.id, 'reopen', { reason: 'Missed a bonus' }, false)).rejects.toMatchObject({ status: 403 })
    expect((await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('finalized')
    const reopened = await act(g, p.id, 'reopen', { reason: 'Missed a bonus' })
    expect(reopened).toMatchObject({ status: 'review', changed: true, reopenReason: 'Missed a bonus', reopenedByName: 'Olive Owner', finalizedAt: null, approvedAt: null })
    await addAdjustment(g, p.id, bonus, boss)
    await act(g, p.id, 'approve'); await act(g, p.id, 'finalize')
    expect((await periodDetail(g, p.id)).integrity).toEqual({ ok: true, lockedTotalCents: 13_000 })
    const events = (await prisma.payrollEvent.findMany({ where: { ownerId: g, periodId: p.id }, orderBy: { createdAt: 'asc' } })).map((e) => e.type)
    expect(events).toEqual(['period_created', 'period_submitted', 'adjustment_added', 'period_sent_back', 'period_submitted', 'period_approved', 'period_finalized', 'period_reopened', 'adjustment_added', 'period_approved', 'period_finalized'])
    expect((await prisma.payrollEvent.findFirstOrThrow({ where: { ownerId: g, type: 'period_reopened' } })).metadata).toMatchObject({ reason: 'Missed a bonus', lockedTotalCents: 8000, from: 'finalized', to: 'review' })
  })

  it('finalizes once when eight people press the button together, and keeps adjustments made at the same moment whole', async () => {
    const g = await gym()
    const sam = await person(g, 'Sam Sales')
    const p = await period(g, -10, 5)
    await act(g, p.id, 'submit'); await act(g, p.id, 'approve')
    const results = await Promise.all(Array.from({ length: 8 }, () => act(g, p.id, 'finalize')))
    expect(results.filter((r) => r.changed)).toHaveLength(1)
    expect(results.every((r) => r.status === 'finalized')).toBe(true)
    expect(await prisma.payrollEvent.count({ where: { ownerId: g, periodId: p.id, type: 'period_finalized' } })).toBe(1)

    // Adjustments racing an approval: each one either made it into the approved total or was refused; none is half in.
    const q = await period(g, 6, 19)
    await act(g, q.id, 'submit')
    const race = await Promise.allSettled([
      ...Array.from({ length: 8 }, (_, i) => addAdjustment(g, q.id, adjustmentSchema.parse({ staffId: sam.id, type: 'bonus', amountCents: 1000, reason: `Race ${i}` }), boss)),
      act(g, q.id, 'approve'),
    ])
    const landed = race.slice(0, 8).filter((r) => r.status === 'fulfilled').length
    for (const r of race.slice(0, 8)) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'period_locked' })
    expect(await total(g, { periodId: q.id })).toBe(landed * 1000)
    await act(g, q.id, 'finalize')
    expect((await periodDetail(g, q.id)).integrity).toEqual({ ok: true, lockedTotalCents: landed * 1000 })
  })
})

// ===========================================================================
describe('payroll: adjustments, export and a person\'s own earnings', () => {
  it('records every adjustment with its reason and author, once per request', async () => {
    const g = await gym()
    const [sam, cora] = [await person(g, 'Sam Sales'), await person(g, 'Cora Coach')]
    const p = await period(g, -10, 5)
    const add = (extra: Record<string, unknown>, key?: string) => addAdjustment(g, p.id, adjustmentSchema.parse({ staffId: sam.id, type: 'bonus', amountCents: 10_000, reason: 'Quarterly bonus', ...extra }), boss, key)
    expect(await add({})).toMatchObject({ kind: 'adjustment', adjustmentType: 'bonus', amountCents: 10_000, reason: 'Quarterly bonus', createdByName: 'Olive Owner', replayed: false })
    // A deduction always takes; a correction goes whichever way it is told.
    expect((await add({ type: 'deduction', amountCents: 2500, reason: 'Uniform' })).amountCents).toBe(-2500)
    expect((await add({ type: 'deduction', amountCents: 500, reason: 'Locker key', direction: 'add' })).amountCents).toBe(-500)
    expect((await add({ type: 'correction', amountCents: 300, reason: 'Overpaid last period', direction: 'subtract' })).amountCents).toBe(-300)
    expect((await add({ type: 'commission_adjustment', amountCents: 1200, reason: 'Missed sale credit' })).amountCents).toBe(1200)
    expect((await add({ type: 'other', amountCents: 100, reason: 'Parking', staffId: cora.id })).amountCents).toBe(100)
    // The same request key: one adjustment, however many times and however close together it arrives.
    const key = randomUUID()
    const many = await Promise.all(Array.from({ length: 6 }, () => add({ amountCents: 7700, reason: 'Sent six times' }, key)))
    expect(new Set(many.map((m) => m.id)).size).toBe(1)
    expect(many.filter((m) => !m.replayed)).toHaveLength(1)
    expect((await add({ amountCents: 7700, reason: 'Sent six times' }, key)).replayed).toBe(true)
    await expect(add({ amountCents: 9900, reason: 'Different amount, same key' }, key)).rejects.toMatchObject({ status: 409, code: 'idempotency_key_reused' })
    expect(await total(g, { periodId: p.id })).toBe(10_000 - 2500 - 500 - 300 + 1200 + 100 + 7700)
    expect(await prisma.payrollEvent.count({ where: { ownerId: g, type: 'adjustment_added' } })).toBe(7)
    const event = await prisma.payrollEvent.findFirstOrThrow({ where: { ownerId: g, type: 'adjustment_added' }, orderBy: { createdAt: 'asc' } })
    expect(event).toMatchObject({ actorType: 'owner', actorName: 'Olive Owner', staffId: sam.id, periodId: p.id, metadata: { amountCents: 10_000, reason: 'Quarterly bonus', adjustmentType: 'bonus' } })
    const detail = await periodDetail(g, p.id)
    expect(detail.staff.map((s) => [s.staffName, s.adjustmentCents, s.totalCents, s.lines])).toEqual([['Cora Coach', 100, 100, 1], ['Sam Sales', 15_600, 15_600, 6]])
    expect(detail.totals).toEqual({ baseCents: 0, commissionCents: 0, reversalCents: 0, adjustmentCents: 15_700, totalCents: 15_700 })
    // Not for someone at another gym, and not into another gym's period.
    const elsewhere = await gym()
    await expect(add({ staffId: (await person(elsewhere, 'Stranger')).id })).rejects.toMatchObject({ status: 404 })
    await expect(addAdjustment(elsewhere, p.id, adjustmentSchema.parse({ staffId: sam.id, type: 'bonus', amountCents: 1, reason: 'Wrong gym' }), boss)).rejects.toMatchObject({ status: 404 })
  })

  it('exports a summary and the lines behind it, with totals that agree', async () => {
    const g = await gym()
    const sam = await person(g, '=Sam "The Closer" Sales')
    await saveCompensation(g, sam.id, comp({ basePay: 'hourly', hourlyRateCents: 2000 }), boss)
    await onPlan(g, [sam], [rule('membership_sale', '10')])
    const p = await period(g, -10, 5)
    const s = await sale(g, sam, { priceCents: 12_345, day: -3 })
    await addTime(g, p.id, timeSchema.parse({ staffId: sam.id, workDate: d(-3), minutes: 390 }), boss)
    await addAdjustment(g, p.id, adjustmentSchema.parse({ staffId: sam.id, type: 'bonus', amountCents: 2500, reason: 'Good, "clean" month' }), boss)
    await refund(g, s.payment.id, 2345)
    await syncPayroll(g)
    const summary = await exportPeriod(g, p.id, 'summary', boss)
    expect(summary.headers).toEqual(['Staff', 'Email', 'Role', 'Period start', 'Period end', 'Status', 'Hours', 'Base pay', 'Commissions', 'Refund reversals', 'Adjustments', 'Total payable'])
    expect(summary.rows).toEqual([
      ['=Sam "The Closer" Sales', sam.email, 'sales', d(-10), d(5), 'open', '6.50', '130.00', '12.35', '-2.35', '25.00', '165.00'],
      ['TOTAL', '', '', d(-10), d(5), 'open', '', '130.00', '12.35', '-2.35', '25.00', '165.00'],
    ])
    // A name that looks like a spreadsheet formula is defused, and quotes are escaped.
    expect(toCsv(summary.headers, summary.rows).split('\n')[1].startsWith(`"'=Sam ""The Closer"" Sales",`)).toBe(true)
    const detail = await exportPeriod(g, p.id, 'detail', boss)
    expect(detail.rows).toHaveLength(4)
    const amount = detail.headers.indexOf('Amount')
    expect(detail.rows.reduce((a, r) => a + Math.round(parseFloat(String(r[amount])) * 100), 0)).toBe(16_500)
    expect(detail.rows.map((r) => r[2])).toEqual(['Hourly pay', 'Commission', 'Bonus', 'Refund reversal'])
    expect(detail.rows[1]).toEqual(expect.arrayContaining(['123.45', '10%', 100, s.member.name]))
    expect(detail.rows[2][detail.headers.indexOf('Reason')]).toBe('Good, "clean" month')
    expect(summary.filename).toBe(`payroll-${d(-10)}-to-${d(5)}`)
    expect(await prisma.payrollEvent.count({ where: { ownerId: g, type: 'period_exported' } })).toBe(2)
    await expect(exportPeriod(await gym(), p.id, 'summary', boss)).rejects.toMatchObject({ status: 404 })
  })

  it('shows each person their own earnings and nothing of anyone else\'s', async () => {
    const g = await gym()
    const [sam, uma] = [await person(g, 'Sam Sales'), await person(g, 'Uma Upsell')]
    await onPlan(g, [sam, uma], [rule('membership_sale', '10')])
    const p = await period(g, -10, 5)
    await sale(g, sam, { priceCents: 10_000, day: -3 })
    await sale(g, uma, { priceCents: 50_000, day: -3 })
    await addAdjustment(g, p.id, adjustmentSchema.parse({ staffId: uma.id, type: 'bonus', amountCents: 9000, reason: 'Private to Uma' }), boss)
    await syncPayroll(g)
    expect((await myEarnings(g, sam.id)).periods).toMatchObject([{ id: p.id, commissionCents: 1000, adjustmentCents: 0, totalCents: 1000, status: 'open' }])
    const mine = await myLines(g, sam.id, p.id)
    expect(mine.lines.map((l) => l.amountCents)).toEqual([1000])
    expect(JSON.stringify(mine)).not.toMatch(/Private to Uma|Uma Upsell|9000|5000/)
    expect((await myEarnings(g, uma.id)).periods[0].totalCents).toBe(14_000)
    // Someone with no earnings sees empty periods, not an error; another gym's period is not there.
    expect((await myEarnings(g, randomUUID())).periods[0].totalCents).toBe(0)
    await expect(myLines(await gym(), sam.id, p.id)).rejects.toMatchObject({ status: 404 })
  })
})

// ===========================================================================
describe.skipIf(!up)('payroll over HTTP', () => {
  type Res = { status: number; json: any; data: any; text: string; headers: Headers }
  async function call(auth: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'X-Forwarded-For': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`, ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, data: json?.data, text, headers: res.headers }
  }
  const ROLES = ['admin', 'manager', 'accountant', 'front_desk', 'sales', 'coach', 'trainer'] as const

  it('lets each role do exactly what it should with payroll, and nothing reach another gym, a member or the public', async () => {
    const g = await gym()
    const other = await gym()
    const cookies: Record<string, string> = { owner: `auth-token=${await createToken({ ownerId: g, emailVerified: true })}` }
    const staff: Record<string, Staff> = {}
    for (const role of ROLES) {
      staff[role] = await person(g, `Test ${role}`, { role })
      cookies[role] = `auth-token=${await createToken({ ownerId: g, staffId: staff[role].id, role })}`
    }
    const ownerB = `auth-token=${await createToken({ ownerId: other, emailVerified: true })}`
    const plan = await createCommissionPlan(g, planSchema.parse({ name: 'Role Plan', rules: [rule('membership_sale', '10')] }), boss)
    await saveCompensation(g, staff.sales.id, comp({ basePay: 'hourly', hourlyRateCents: 2000, commissionPlanId: plan.id }), boss)
    await prisma.commissionAssignment.updateMany({ where: { ownerId: g, staffId: staff.sales.id }, data: { startsOn: d(-400) } })
    const p = await period(g, -10, 5)
    const locked = await period(g, -30, -11)
    for (const step of ['submit', 'approve', 'finalize']) await act(g, locked.id, step)
    const s = await sale(g, staff.sales, { priceCents: 40_000, day: -2 })
    await addAdjustment(g, p.id, adjustmentSchema.parse({ staffId: staff.coach.id, type: 'bonus', amountCents: 1234, reason: 'Coach only' }), boss)

    const view = ['owner', 'admin', 'manager', 'accountant']
    const manage = ['owner', 'admin', 'manager']
    const reopen = ['owner', 'admin']
    for (const role of Object.keys(cookies)) {
      const c = cookies[role]
      const expectStatus = async (who: string[], method: string, path: string, body?: unknown, ok = 200) => {
        const r = await call(c, method, path, body)
        expect(r.status, `${role} ${method} ${path} ${JSON.stringify(body || '').slice(0, 50)} → ${r.text.slice(0, 120)}`).toBe(who.includes(role) ? ok : 403)
        return r
      }
      for (const path of ['/api/payroll/periods', `/api/payroll/periods/${p.id}`, `/api/payroll/periods/${p.id}/staff/${staff.sales.id}`, `/api/payroll/periods/${p.id}/export`, `/api/payroll/periods/${p.id}/export?format=detail`, '/api/payroll/compensation', '/api/payroll/commission-plans', `/api/memberships/${s.membership.id}/attribution`]) await expectStatus(view, 'GET', path)
      await expectStatus(manage, 'PUT', `/api/payroll/compensation/${staff.trainer.id}`, { basePay: 'flat', flatPerPeriodCents: 10_000 })
      const made = await expectStatus(manage, 'POST', '/api/payroll/commission-plans', { name: `By ${role}`, rules: [rule('class', 1000)] })
      if (made.status === 200) expect((await call(c, 'PUT', `/api/payroll/commission-plans/${made.data.id}`, { name: `By ${role} v2`, isActive: false, rules: [] })).status).toBe(200)
      else expect((await call(c, 'PUT', `/api/payroll/commission-plans/${plan.id}`, { name: 'Hijacked', rules: [rule('membership_sale', '99')] })).status).toBe(403)
      await expectStatus(manage, 'POST', `/api/payroll/periods/${p.id}/adjustments`, { staffId: staff.sales.id, type: 'bonus', amountCents: 100, reason: `From ${role}` })
      const time = await expectStatus(manage, 'POST', `/api/payroll/periods/${p.id}/time`, { staffId: staff.sales.id, workDate: d(-1), minutes: 30 })
      await expectStatus(manage, 'DELETE', `/api/payroll/periods/${p.id}/time/${time.data?.id || randomUUID()}`, undefined, time.data?.id ? 200 : 404)
      await expectStatus(manage, 'PUT', `/api/memberships/${s.membership.id}/attribution`, { shares: [{ staffId: staff.sales.id, sharePercent: 100 }] })
      await expectStatus(manage, 'POST', `/api/payroll/periods/${p.id}`, { action: 'sync' })
      await expectStatus(manage, 'POST', '/api/payroll/periods', { startDate: d(-12), endDate: d(-8) }, 409)
      // Reopening a finalized period: managers may run payroll but not undo a lock.
      const r = await call(c, 'POST', `/api/payroll/periods/${locked.id}`, { action: 'reopen', reason: `Tried by ${role}` })
      expect(r.status, `${role} reopen`).toBe(reopen.includes(role) ? 200 : 403)
      if (r.status === 200) for (const step of ['approve', 'finalize']) await act(g, locked.id, step)
      // Everyone on staff can see their own earnings, and only their own.
      const me = await call(c, 'GET', `/api/payroll/me?periodId=${p.id}`)
      expect(me.status, role).toBe(200)
      if (role === 'owner') expect(me.data).toEqual({ periods: [], lines: null })
      else {
        expect(me.data.periods.find((x: any) => x.id === p.id)).toBeTruthy()
        const own = JSON.stringify(me.data)
        if (role !== 'coach') expect(own).not.toMatch(/Coach only|1234/)
        if (role !== 'sales') expect(own).not.toContain(s.member.name)
      }
    }
    expect((await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: locked.id } })).status).toBe('finalized')
    expect((await prisma.commissionPlan.findUniqueOrThrow({ where: { id: plan.id } })).name).toBe('Role Plan')
    const coachMe = await call(cookies.coach, 'GET', `/api/payroll/me?periodId=${p.id}`)
    expect(coachMe.data.lines.lines).toMatchObject([{ amountCents: 1234, reason: 'Coach only' }])
    expect((await call(cookies.sales, 'GET', `/api/payroll/me?periodId=${p.id}`)).data.periods.find((x: any) => x.id === p.id).commissionCents).toBe(4000)
    expect((await call(cookies.coach, 'GET', `/api/payroll/me?periodId=${randomUUID()}`)).status).toBe(404)
    expect((await call(cookies.coach, 'GET', '/api/payroll/me?periodId=not-an-id')).status).toBe(404)

    // Another gym's owner: nothing of this gym's payroll exists for them.
    for (const [method, path, body] of [
      ['GET', `/api/payroll/periods/${p.id}`], ['GET', `/api/payroll/periods/${p.id}/staff/${staff.sales.id}`], ['GET', `/api/payroll/periods/${p.id}/export`],
      ['POST', `/api/payroll/periods/${p.id}`, { action: 'submit' }], ['POST', `/api/payroll/periods/${locked.id}`, { action: 'reopen', reason: 'Not mine' }],
      ['POST', `/api/payroll/periods/${p.id}/adjustments`, { staffId: staff.sales.id, type: 'bonus', amountCents: 100, reason: 'Not mine' }],
      ['POST', `/api/payroll/periods/${p.id}/time`, { staffId: staff.sales.id, workDate: d(-1), minutes: 30 }],
      ['PUT', `/api/payroll/compensation/${staff.sales.id}`, { basePay: 'none' }], ['PUT', `/api/payroll/commission-plans/${plan.id}`, { name: 'Hijacked', rules: [] }],
      ['GET', `/api/memberships/${s.membership.id}/attribution`], ['PUT', `/api/memberships/${s.membership.id}/attribution`, { shares: [] }],
    ] as const) expect((await call(ownerB, method, path, body)).status, `${method} ${path}`).toBe(404)
    const theirs = await call(ownerB, 'GET', '/api/payroll/periods')
    expect(theirs.data.periods).toEqual([])
    expect((await call(ownerB, 'GET', '/api/payroll/compensation')).data.staff.map((x: any) => x.id)).not.toContain(staff.sales.id)
    expect((await call(ownerB, 'GET', '/api/payroll/commission-plans')).data.plans).toEqual([])
    // Their own staff cannot be paid through this gym's period either.
    const stranger = await person(other, 'Stranger')
    expect((await call(cookies.owner, 'POST', `/api/payroll/periods/${p.id}/adjustments`, { staffId: stranger.id, type: 'bonus', amountCents: 100, reason: 'Wrong gym' })).status).toBe(404)
    expect((await call(cookies.owner, 'PUT', `/api/payroll/compensation/${stranger.id}`, { basePay: 'none' })).status).toBe(404)

    // Signed out, a member, and the public API: no payroll anywhere.
    const member = await createMember(g)
    const { createInvite, setPasswordWithToken } = await import('@/lib/member-auth')
    await setPasswordWithToken((await createInvite(g, member.id)).token, 'correct-horse-42')
    const bearer = await memberBearer(member.id)
    for (const auth of [null, bearer]) for (const path of ['/api/payroll/periods', `/api/payroll/periods/${p.id}`, `/api/payroll/periods/${p.id}/export`, '/api/payroll/compensation', '/api/payroll/commission-plans', '/api/payroll/me']) expect((await call(auth, 'GET', path)).status, path).toBe(401)
    for (const path of ['/api/portal/me/payroll', '/api/v1/payroll', '/api/v1/payroll/periods', '/api/public/payroll']) expect([401, 404]).toContain((await call(bearer, 'GET', path)).status)
    const portal = await call(bearer, 'GET', '/api/portal/me')
    expect(portal.text).not.toMatch(/payroll|commission|hourlyRate|salary/i)

    // There is no way to edit or delete a ledger line, an event or a period through the API.
    const line = (await lines(g, { periodId: p.id }))[0]
    for (const [method, path] of [['DELETE', `/api/payroll/periods/${p.id}`], ['PATCH', `/api/payroll/periods/${p.id}`], ['PUT', `/api/payroll/periods/${p.id}`], ['DELETE', `/api/payroll/periods/${p.id}/adjustments`], ['PATCH', `/api/payroll/periods/${p.id}/adjustments/${line.id}`], ['DELETE', `/api/payroll/periods/${p.id}/staff/${staff.sales.id}`], ['DELETE', `/api/payroll/commission-plans/${plan.id}`]] as const) {
      expect([404, 405], `${method} ${path}`).toContain((await call(cookies.owner, method, path, {})).status)
    }
  })

  it('validates input, makes repeated requests safe, and returns the export as a CSV file', async () => {
    const g = await gym()
    const owner = `auth-token=${await createToken({ ownerId: g, emailVerified: true })}`
    const sam = await person(g, 'Sam Sales')
    const created = await call(owner, 'POST', '/api/payroll/periods', { startDate: d(-10), endDate: d(5) })
    expect(created.status, created.text).toBe(200)
    expect(created.data).toMatchObject({ status: 'open', startDate: d(-10), endDate: d(5), locked: false })
    const id = created.data.id
    for (const bad of [{ startDate: d(5), endDate: d(-10) }, { startDate: 'tomorrow', endDate: d(5) }, { startDate: d(-10) }, {}]) expect((await call(owner, 'POST', '/api/payroll/periods', bad)).status, JSON.stringify(bad)).toBe(400)
    const adj = `/api/payroll/periods/${id}/adjustments`
    for (const bad of [{ staffId: sam.id, type: 'bonus', amountCents: 0, reason: 'Zero' }, { staffId: sam.id, type: 'bonus', amountCents: 10.5, reason: 'Fraction' }, { staffId: sam.id, type: 'bonus', amountCents: 100 }, { staffId: sam.id, type: 'bonus', amountCents: 100, reason: ' ' }, { staffId: 'x', type: 'bonus', amountCents: 100, reason: 'Bad id' }, { staffId: sam.id, type: 'gift', amountCents: 100, reason: 'Bad type' }, { staffId: sam.id, type: 'bonus', amountCents: 1e12, reason: 'Too big' }]) {
      const r = await call(owner, 'POST', adj, bad)
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.json.code).toBe('validation_error')
    }
    expect(await prisma.payrollEntry.count({ where: { ownerId: g } })).toBe(0)
    // The same Idempotency-Key, five at once and once more later: one adjustment.
    const key = randomUUID()
    const body = { staffId: sam.id, type: 'bonus', amountCents: 2500, reason: 'Sent more than once' }
    const sent = await Promise.all(Array.from({ length: 5 }, () => call(owner, 'POST', adj, body, { 'Idempotency-Key': key })))
    expect(sent.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(new Set(sent.map((r) => r.data.id)).size).toBe(1)
    expect((await call(owner, 'POST', adj, body, { 'Idempotency-Key': key })).data.replayed).toBe(true)
    expect((await call(owner, 'POST', adj, { ...body, amountCents: 9999 }, { 'Idempotency-Key': key })).status).toBe(409)
    expect(await prisma.payrollEntry.count({ where: { ownerId: g } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { ownerId: g, action: 'payroll.adjustment' } })).toBe(1)
    // Each step of the lifecycle, twice.
    for (const [action, status] of [['submit', 'review'], ['approve', 'approved'], ['finalize', 'finalized']] as const) {
      const first = await call(owner, 'POST', `/api/payroll/periods/${id}`, { action })
      expect(first.data).toMatchObject({ status, changed: true })
      expect((await call(owner, 'POST', `/api/payroll/periods/${id}`, { action })).data).toMatchObject({ status, changed: false })
    }
    const eight = await Promise.all(Array.from({ length: 8 }, () => call(owner, 'POST', `/api/payroll/periods/${id}`, { action: 'finalize' })))
    expect(eight.every((r) => r.status === 200 && r.data.status === 'finalized' && r.data.changed === false)).toBe(true)
    expect((await call(owner, 'POST', adj, body)).json).toMatchObject({ code: 'period_locked' })
    expect((await call(owner, 'POST', `/api/payroll/periods/${id}`, { action: 'reopen' })).status).toBe(400)
    expect((await call(owner, 'POST', `/api/payroll/periods/${id}`, { action: 'delete' })).status).toBe(400)
    const detail = await call(owner, 'GET', `/api/payroll/periods/${id}`)
    expect(detail.data).toMatchObject({ status: 'finalized', locked: true, integrity: { ok: true, lockedTotalCents: 2500 }, totals: { totalCents: 2500, adjustmentCents: 2500 }, can: { manage: true, reopen: true } })
    expect(detail.data.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['period_created', 'adjustment_added', 'period_submitted', 'period_approved', 'period_finalized']))
    const csv = await call(owner, 'GET', `/api/payroll/periods/${id}/export`)
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csv.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="payroll-${d(-10)}-to-${d(5)}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`))
    expect(csv.headers.get('cache-control')).toBe('no-store')
    expect(csv.text.split('\n')).toEqual([
      'Staff,Email,Role,Period start,Period end,Status,Hours,Base pay,Commissions,Refund reversals,Adjustments,Total payable',
      `Sam Sales,${sam.email},sales,${d(-10)},${d(5)},finalized,0.00,0.00,0.00,0.00,25.00,25.00`,
      `TOTAL,,,${d(-10)},${d(5)},finalized,,0.00,0.00,0.00,25.00,25.00`,
    ])
    const full = await call(owner, 'GET', `/api/payroll/periods/${id}/export?format=detail`)
    expect(full.text.split('\n')).toHaveLength(2)
    expect(full.text).toContain('Sent more than once')
    expect((await call(owner, 'GET', `/api/payroll/periods/${randomUUID()}`)).status).toBe(404)
    // Selling at the desk credits the person who sold it, or whoever they name.
    const desk = await person(g, 'Dee Desk', { role: 'sales' })
    const deskCookie = `auth-token=${await createToken({ ownerId: g, staffId: desk.id, role: 'sales' })}`
    const plan = await createPlan(g, { priceCents: 5000 })
    const sold = await call(deskCookie, 'POST', `/api/members/${(await createMember(g)).id}/memberships`, { planId: plan.id, paymentMethod: 'cash', collectNow: true })
    expect(sold.status, sold.text).toBe(200)
    expect((await call(owner, 'GET', `/api/memberships/${sold.data.membershipId}/attribution`)).data.shares).toEqual([{ staffId: desk.id, staffName: 'Dee Desk', sharePercent: 100 }])
    const named = await call(owner, 'POST', `/api/members/${(await createMember(g)).id}/memberships`, { planId: plan.id, paymentMethod: 'cash', soldByStaffIds: [sam.id, desk.id] })
    expect((await call(owner, 'GET', `/api/memberships/${named.data.membershipId}/attribution`)).data.shares.map((x: any) => x.sharePercent)).toEqual([50, 50])
    expect((await call(owner, 'POST', `/api/members/${(await createMember(g)).id}/memberships`, { planId: plan.id, paymentMethod: 'cash', soldByStaffIds: [randomUUID()] })).status).toBe(404)
    expect((await call(owner, 'PUT', `/api/memberships/${sold.data.membershipId}/attribution`, { shares: [{ staffId: sam.id, sharePercent: 60 }, { staffId: desk.id, sharePercent: 30 }] })).status).toBe(400)
  })
})
