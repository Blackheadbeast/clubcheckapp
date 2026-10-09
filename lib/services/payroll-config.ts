// How staff are paid: each person's compensation, the commission plans, who is on which plan,
// and who is credited with a sale. This file is configuration; lib/services/payroll.ts turns it,
// together with the payments and appointments already on record, into the earnings ledger.

import { z } from 'zod'
import type { CommissionRule, StaffCompensation } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { zonedParts } from '@/lib/dates'
import { addDaysToDate } from '@/lib/dates'
import { getGymSettings, lockRow, type ActorRef, type Db } from './core'

export const BASE_PAY = ['none', 'hourly', 'salary', 'flat'] as const
export const BASE_PAY_LABELS: Record<(typeof BASE_PAY)[number], string> = { none: 'No base pay', hourly: 'Hourly', salary: 'Salary', flat: 'Flat amount each pay period' }

export const TRIGGERS = ['membership_sale', 'membership_upgrade', 'membership_renewal', 'package_sale', 'appointment', 'class'] as const
export type Trigger = (typeof TRIGGERS)[number]
export const TRIGGER_LABELS: Record<Trigger, string> = {
  membership_sale: 'Membership sales',
  membership_upgrade: 'Membership upgrades',
  membership_renewal: 'Membership renewals',
  package_sale: 'Packages, class packs and drop-ins',
  appointment: 'Appointments delivered',
  class: 'Classes taught',
}

const cents = z.number().int().min(0).max(100_000_000)
const compFields = {
  basePay: z.enum(BASE_PAY),
  hourlyRateCents: cents.default(0),
  annualSalaryCents: cents.default(0),
  flatPerPeriodCents: cents.default(0),
  perSessionCents: cents.default(0),
  perClassCents: cents.default(0),
}
export const compensationSchema = z.object({
  ...compFields,
  notes: z.string().trim().max(500).nullish(),
  // Different rates for work done at a particular location
  overrides: z.array(z.object({ locationId: z.string().uuid(), ...compFields })).max(20).default([]),
  // The commission plan they are on from today. Omit to leave it as it is; null to take them off.
  commissionPlanId: z.string().uuid().nullish(),
}).superRefine((v, ctx) => {
  const check = (c: { basePay: string; hourlyRateCents: number; annualSalaryCents: number; flatPerPeriodCents: number }, path: (string | number)[]) => {
    if (c.basePay === 'hourly' && c.hourlyRateCents <= 0) ctx.addIssue({ code: 'custom', path: [...path, 'hourlyRateCents'], message: 'Enter the hourly rate' })
    if (c.basePay === 'salary' && c.annualSalaryCents <= 0) ctx.addIssue({ code: 'custom', path: [...path, 'annualSalaryCents'], message: 'Enter the yearly salary' })
    if (c.basePay === 'flat' && c.flatPerPeriodCents <= 0) ctx.addIssue({ code: 'custom', path: [...path, 'flatPerPeriodCents'], message: 'Enter the amount per pay period' })
  }
  check(v, [])
  v.overrides.forEach((o, i) => check(o, ['overrides', i]))
  if (new Set(v.overrides.map((o) => o.locationId)).size !== v.overrides.length) ctx.addIssue({ code: 'custom', path: ['overrides'], message: 'Each location can only be listed once' })
})
export type CompensationInput = z.infer<typeof compensationSchema>

const ruleSchema = z.object({
  trigger: z.enum(TRIGGERS),
  rateType: z.enum(['percent', 'flat']),
  // Hundredths of a percent: 1000 = 10%
  percentBps: z.number().int().min(0).max(10_000).default(0),
  flatCents: cents.default(0),
  planIds: z.array(z.string().uuid()).max(50).default([]),
  appointmentTypeIds: z.array(z.string().uuid()).max(50).default([]),
  classTypeIds: z.array(z.string().uuid()).max(50).default([]),
  includeNoShow: z.boolean().default(false),
}).superRefine((r, ctx) => {
  if (r.rateType === 'percent' && r.percentBps <= 0) ctx.addIssue({ code: 'custom', path: ['percentBps'], message: 'Enter a percentage above zero' })
  if (r.rateType === 'flat' && r.flatCents <= 0) ctx.addIssue({ code: 'custom', path: ['flatCents'], message: 'Enter an amount above zero' })
  // A class has no price of its own (members come on memberships and packs), so there is nothing to take a percentage of.
  if (r.trigger === 'class' && r.rateType === 'percent') ctx.addIssue({ code: 'custom', path: ['rateType'], message: 'Classes are paid a fixed amount per class taught' })
})
export const planSchema = z.object({
  name: z.string().trim().min(1, 'Give the plan a name').max(80),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().default(true),
  rules: z.array(ruleSchema).max(30).default([]),
})
export type PlanInput = z.infer<typeof planSchema>

export const attributionSchema = z.object({
  shares: z.array(z.object({ staffId: z.string().uuid(), sharePercent: z.number().int().min(1).max(100) })).max(5),
}).superRefine((v, ctx) => {
  if (v.shares.length && v.shares.reduce((a, s) => a + s.sharePercent, 0) !== 100) ctx.addIssue({ code: 'custom', path: ['shares'], message: 'The shares must add up to 100%' })
  if (new Set(v.shares.map((s) => s.staffId)).size !== v.shares.length) ctx.addIssue({ code: 'custom', path: ['shares'], message: 'Each person can only be listed once' })
})

export async function payrollEvent(db: Db, input: { ownerId: string; type: string; actor?: ActorRef; periodId?: string | null; staffId?: string | null; metadata?: Record<string, unknown> }) {
  await db.payrollEvent.create({
    data: {
      ownerId: input.ownerId, periodId: input.periodId || null, staffId: input.staffId || null, type: input.type,
      actorType: input.actor?.type || 'system', actorId: input.actor?.id || null, actorName: input.actor?.name || null,
      metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    },
  })
}

export async function todayIn(ownerId: string, db: Db = prisma) {
  const settings = await getGymSettings(ownerId, db)
  return { today: zonedParts(new Date(), settings.timezone).date, tz: settings.timezone }
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

const compOut = (c: StaffCompensation | undefined | null) => ({
  basePay: (c?.basePay || 'none') as (typeof BASE_PAY)[number], hourlyRateCents: c?.hourlyRateCents || 0, annualSalaryCents: c?.annualSalaryCents || 0,
  flatPerPeriodCents: c?.flatPerPeriodCents || 0, perSessionCents: c?.perSessionCents || 0, perClassCents: c?.perClassCents || 0,
})

/** The assignment in force on a date (YYYY-MM-DD in the gym's timezone). */
export function assignmentOn<T extends { startsOn: string; endsOn: string | null }>(rows: T[], date: string): T | null {
  return rows.find((a) => a.startsOn <= date && (!a.endsOn || a.endsOn >= date)) || null
}

export async function listCompensation(ownerId: string) {
  const { today } = await todayIn(ownerId)
  const [staff, comps, assignments, plans, locations] = await Promise.all([
    prisma.staff.findMany({ where: { ownerId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], select: { id: true, name: true, email: true, role: true, active: true, title: true, locationId: true } }),
    prisma.staffCompensation.findMany({ where: { ownerId } }),
    prisma.commissionAssignment.findMany({ where: { ownerId }, orderBy: { startsOn: 'desc' } }),
    prisma.commissionPlan.findMany({ where: { ownerId }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } }),
    prisma.location.findMany({ where: { ownerId }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } }),
  ])
  return {
    staff: staff
      // Someone who has left and was never set up for pay is noise here.
      .filter((s) => s.active || comps.some((c) => c.staffId === s.id) || assignments.some((a) => a.staffId === s.id))
      .map((s) => {
        const mine = comps.filter((c) => c.staffId === s.id)
        const current = assignmentOn(assignments.filter((a) => a.staffId === s.id), today)
        const base = mine.find((c) => !c.locationId)
        return {
          ...s, ...compOut(base), notes: base?.notes || null, configured: mine.length > 0,
          overrides: mine.filter((c) => c.locationId).map((c) => ({ locationId: c.locationId as string, ...compOut(c) })),
          commissionPlanId: current?.planId || null, commissionPlanName: plans.find((p) => p.id === current?.planId)?.name || null, commissionSince: current?.startsOn || null,
        }
      }),
    plans, locations,
  }
}

export async function saveCompensation(ownerId: string, staffId: string, input: CompensationInput, actor: ActorRef) {
  const { today } = await todayIn(ownerId)
  return prisma.$transaction(async (db) => {
    const staff = await db.staff.findFirst({ where: { id: staffId, ownerId } })
    if (!staff) throw notFound('Staff member')
    // One person's pay is changed by one request at a time.
    await lockRow(db, 'Staff', staff.id)
    if (input.overrides.length) {
      const found = await db.location.count({ where: { ownerId, id: { in: input.overrides.map((o) => o.locationId) } } })
      if (found !== input.overrides.length) throw notFound('Location')
    }
    const before = await db.staffCompensation.findMany({ where: { ownerId, staffId } })
    await db.staffCompensation.deleteMany({ where: { ownerId, staffId } })
    const { overrides, commissionPlanId, notes, ...base } = input
    await db.staffCompensation.createMany({
      data: [
        { ownerId, staffId, locationId: null, ...base, notes: notes || null, updatedByName: actor.name || null },
        ...overrides.map((o) => ({ ownerId, staffId, ...o, updatedByName: actor.name || null })),
      ],
    })

    let planChanged = false
    if (commissionPlanId !== undefined) {
      const rows = await db.commissionAssignment.findMany({ where: { ownerId, staffId } })
      const current = assignmentOn(rows, today)
      if ((current?.planId || null) !== (commissionPlanId || null)) {
        planChanged = true
        if (commissionPlanId) {
          const plan = await db.commissionPlan.findFirst({ where: { id: commissionPlanId, ownerId } })
          if (!plan) throw notFound('Commission plan')
          if (!plan.isActive) throw badRequest('That commission plan has been archived.', 'plan_archived')
        }
        // The old plan stops yesterday and the new one starts today, so no day is on two plans or none by accident.
        if (current) {
          if (current.startsOn >= today) await db.commissionAssignment.delete({ where: { id: current.id } })
          else await db.commissionAssignment.update({ where: { id: current.id }, data: { endsOn: addDaysToDate(today, -1) } })
        }
        // Anything arranged to start later is replaced by this decision.
        await db.commissionAssignment.deleteMany({ where: { ownerId, staffId, startsOn: { gt: today } } })
        if (commissionPlanId) await db.commissionAssignment.create({ data: { ownerId, staffId, planId: commissionPlanId, startsOn: today, createdByName: actor.name || null } })
      }
    }
    await payrollEvent(db, {
      ownerId, type: 'compensation_changed', actor, staffId,
      metadata: { staffName: staff.name, before: before.map((c) => ({ locationId: c.locationId, ...compOut(c) })), after: [{ locationId: null, ...base }, ...overrides], ...(planChanged && { commissionPlanId: commissionPlanId || null }) },
    })
    return { saved: true, planChanged }
  })
}

/** The rates that apply to work at a location: that location's own, or the person's default. */
export function compFor(rows: StaffCompensation[], staffId: string, locationId: string | null | undefined) {
  const mine = rows.filter((c) => c.staffId === staffId)
  return (locationId && mine.find((c) => c.locationId === locationId)) || mine.find((c) => !c.locationId) || null
}

// ---------------------------------------------------------------------------
// Commission plans
// ---------------------------------------------------------------------------

export function describeRule(r: Pick<CommissionRule, 'trigger' | 'rateType' | 'percentBps' | 'flatCents'>) {
  const rate = r.rateType === 'percent' ? `${(r.percentBps / 100).toFixed(r.percentBps % 100 ? 2 : 0)}%` : `$${(r.flatCents / 100).toFixed(r.flatCents % 100 ? 2 : 0)}`
  const what: Record<string, string> = {
    membership_sale: r.rateType === 'percent' ? 'of membership sales' : 'per membership sold', membership_upgrade: r.rateType === 'percent' ? 'of upgrade charges' : 'per upgrade',
    membership_renewal: r.rateType === 'percent' ? 'of renewals' : 'per renewal', package_sale: r.rateType === 'percent' ? 'of package sales' : 'per package sold',
    appointment: r.rateType === 'percent' ? 'of appointment revenue' : 'per completed appointment', class: 'per class taught',
  }
  return `${rate} ${what[r.trigger] || r.trigger}`
}

async function checkRuleTargets(db: Db, ownerId: string, rules: PlanInput['rules']) {
  const ids = (key: 'planIds' | 'appointmentTypeIds' | 'classTypeIds') => Array.from(new Set(rules.flatMap((r) => r[key])))
  const [plans, types, classes] = [ids('planIds'), ids('appointmentTypeIds'), ids('classTypeIds')]
  if (plans.length && (await db.membershipPlan.count({ where: { ownerId, id: { in: plans } } })) !== plans.length) throw notFound('Membership plan')
  if (types.length && (await db.appointmentType.count({ where: { ownerId, id: { in: types } } })) !== types.length) throw notFound('Appointment type')
  if (classes.length && (await db.classType.count({ where: { ownerId, id: { in: classes } } })) !== classes.length) throw notFound('Class type')
}

const ruleData = (ownerId: string, planId: string, rules: PlanInput['rules']) => rules.map((r, i) => ({
  ownerId, planId, trigger: r.trigger, rateType: r.rateType, percentBps: r.rateType === 'percent' ? r.percentBps : 0, flatCents: r.rateType === 'flat' ? r.flatCents : 0,
  planIds: ['membership_sale', 'membership_upgrade', 'membership_renewal', 'package_sale'].includes(r.trigger) ? r.planIds : [],
  appointmentTypeIds: r.trigger === 'appointment' ? r.appointmentTypeIds : [], classTypeIds: r.trigger === 'class' ? r.classTypeIds : [],
  includeNoShow: r.trigger === 'appointment' && r.includeNoShow, sortOrder: i,
}))

export async function listPlans(ownerId: string) {
  const { today } = await todayIn(ownerId)
  const [plans, staff, options] = await Promise.all([
    prisma.commissionPlan.findMany({ where: { ownerId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { rules: { orderBy: { sortOrder: 'asc' } }, assignments: true } }),
    prisma.staff.findMany({ where: { ownerId }, select: { id: true, name: true, active: true } }),
    ruleOptions(ownerId),
  ])
  return {
    plans: plans.map((p) => {
      const on = p.assignments.filter((a) => a.startsOn <= today && (!a.endsOn || a.endsOn >= today))
      return {
        id: p.id, name: p.name, description: p.description, isActive: p.isActive, updatedAt: p.updatedAt,
        rules: p.rules.map((r) => ({ id: r.id, trigger: r.trigger, rateType: r.rateType, percentBps: r.percentBps, flatCents: r.flatCents, planIds: r.planIds, appointmentTypeIds: r.appointmentTypeIds, classTypeIds: r.classTypeIds, includeNoShow: r.includeNoShow, summary: describeRule(r) })),
        staff: on.map((a) => ({ id: a.staffId, name: staff.find((s) => s.id === a.staffId)?.name || 'Former staff', since: a.startsOn })),
      }
    }),
    options,
  }
}

export async function ruleOptions(ownerId: string) {
  const [plans, appointmentTypes, classTypes] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, type: true } }),
    prisma.appointmentType.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.classType.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  return { plans, appointmentTypes, classTypes }
}

export async function createPlan(ownerId: string, input: PlanInput, actor: ActorRef) {
  return prisma.$transaction(async (db) => {
    await checkRuleTargets(db, ownerId, input.rules)
    const plan = await db.commissionPlan.create({ data: { ownerId, name: input.name, description: input.description || null, isActive: input.isActive } })
    if (input.rules.length) await db.commissionRule.createMany({ data: ruleData(ownerId, plan.id, input.rules) })
    await payrollEvent(db, { ownerId, type: 'commission_plan_created', actor, metadata: { planId: plan.id, name: plan.name, rules: input.rules } })
    return { id: plan.id }
  })
}

/**
 * Changing a plan changes what is earned from now on. Lines already in the ledger carry the rule
 * they were worked out with, and an event that has been worked out is never worked out again.
 */
export async function updatePlan(ownerId: string, id: string, input: PlanInput, actor: ActorRef) {
  return prisma.$transaction(async (db) => {
    const plan = await db.commissionPlan.findFirst({ where: { id, ownerId }, include: { rules: { orderBy: { sortOrder: 'asc' } } } })
    if (!plan) throw notFound('Commission plan')
    await db.$queryRaw`SELECT id FROM "CommissionPlan" WHERE id = ${plan.id} FOR NO KEY UPDATE`
    await checkRuleTargets(db, ownerId, input.rules)
    await db.commissionPlan.update({ where: { id: plan.id }, data: { name: input.name, description: input.description || null, isActive: input.isActive } })
    await db.commissionRule.deleteMany({ where: { planId: plan.id } })
    if (input.rules.length) await db.commissionRule.createMany({ data: ruleData(ownerId, plan.id, input.rules) })
    await payrollEvent(db, {
      ownerId, type: input.isActive === plan.isActive ? 'commission_plan_changed' : input.isActive ? 'commission_plan_restored' : 'commission_plan_archived', actor,
      metadata: { planId: plan.id, name: input.name, before: plan.rules.map((r) => describeRule(r)), after: input.rules.map((r) => describeRule(r as never)) },
    })
    return { id: plan.id }
  })
}

// ---------------------------------------------------------------------------
// Who sold it
// ---------------------------------------------------------------------------

/** Credit the person at the desk with a sale they have just made. Does nothing if someone is already credited. */
export async function creditSale(db: Db, input: { ownerId: string; membershipId: string; actor?: ActorRef; staffIds?: string[] }) {
  const ids = input.staffIds?.length ? Array.from(new Set(input.staffIds)) : input.actor?.type === 'staff' && input.actor.id ? [input.actor.id] : []
  if (!ids.length) return
  const staff = await db.staff.findMany({ where: { ownerId: input.ownerId, id: { in: ids }, active: true } })
  if (staff.length !== ids.length) throw notFound('Staff member')
  if (await db.saleAttribution.count({ where: { membershipId: input.membershipId } })) return
  // Equal shares; any odd percent goes to the first person named.
  const each = Math.floor(100 / ids.length)
  await db.saleAttribution.createMany({
    data: ids.map((id, i) => ({ ownerId: input.ownerId, membershipId: input.membershipId, staffId: id, staffName: staff.find((s) => s.id === id)!.name, sharePercent: each + (i === 0 ? 100 - each * ids.length : 0), createdByName: input.actor?.name || null })),
  })
}

export async function getAttribution(ownerId: string, membershipId: string) {
  const membership = await prisma.membership.findFirst({ where: { id: membershipId, ownerId }, select: { id: true } })
  if (!membership) throw notFound('Membership')
  const [shares, staff] = await Promise.all([
    prisma.saleAttribution.findMany({ where: { ownerId, membershipId }, orderBy: { sharePercent: 'desc' } }),
    prisma.staff.findMany({ where: { ownerId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  return { shares: shares.map((s) => ({ staffId: s.staffId, staffName: s.staffName, sharePercent: s.sharePercent })), staff }
}

/**
 * Change who is credited with a membership. It applies to money that payroll has not yet worked
 * out (future renewals, and past payments nobody was credited for). Commission already in the
 * ledger stays where it is; move it with an adjustment if it should move.
 */
export async function setAttribution(ownerId: string, membershipId: string, input: z.infer<typeof attributionSchema>, actor: ActorRef) {
  return prisma.$transaction(async (db) => {
    const membership = await db.membership.findFirst({ where: { id: membershipId, ownerId } })
    if (!membership) throw notFound('Membership')
    await lockRow(db, 'Membership', membership.id)
    const staff = await db.staff.findMany({ where: { ownerId, id: { in: input.shares.map((s) => s.staffId) } } })
    if (staff.length !== input.shares.length) throw notFound('Staff member')
    const before = await db.saleAttribution.findMany({ where: { ownerId, membershipId } })
    await db.saleAttribution.deleteMany({ where: { ownerId, membershipId } })
    if (input.shares.length) {
      await db.saleAttribution.createMany({ data: input.shares.map((s) => ({ ownerId, membershipId, staffId: s.staffId, staffName: staff.find((x) => x.id === s.staffId)!.name, sharePercent: s.sharePercent, createdByName: actor.name || null })) })
    }
    // Payments on this membership that payroll looked at and credited to nobody can now be looked at again.
    const payments = await db.transaction.findMany({ where: { ownerId, type: 'payment', invoice: { membershipId } }, select: { id: true } })
    if (payments.length) await db.payrollSource.deleteMany({ where: { ownerId, entries: 0, key: { in: payments.map((p) => `${ownerId}:tx:${p.id}`) } } })
    await payrollEvent(db, { ownerId, type: 'attribution_changed', actor, metadata: { membershipId, before: before.map((b) => ({ staffId: b.staffId, staffName: b.staffName, sharePercent: b.sharePercent })), after: input.shares } })
    return { saved: true }
  })
}

export { ApiError }
