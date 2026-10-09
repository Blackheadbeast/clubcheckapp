// Payroll: the earnings ledger and the pay periods it is paid through.
//
// Nothing here moves money or keeps a second set of books. Earnings are read from what the rest
// of the system has already recorded (payments, refunds, completed appointments, classes taught)
// and written to the ledger once:
//
// - Every event is worked out exactly once, with the pay rates and commission rules in force at
//   that moment. A marker (PayrollSource) is written with it in the same transaction, so a retry,
//   a duplicate webhook or two people opening the page together cannot enter it twice; the
//   ledger's unique key on each line is the second guard.
// - Ledger lines are only ever added. A refund adds a reversal; a correction adds an adjustment.
// - A line is paid in the open pay period its date falls in. If that period has already been
//   locked, it is carried into the next open one and marked as carried.
// - Approving a period stops anything further being placed in it; finalizing records the totals
//   that were approved. Both are safe to repeat.

import { createHash, randomUUID } from 'crypto'
import { z } from 'zod'
import { Prisma, type CommissionRule, type PayrollEntry, type PayrollPeriod, type Staff, type StaffCompensation } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, conflict, notFound } from '@/lib/api'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import { getGymSettings, type ActorRef, type Db } from './core'
import { assignmentOn, compFor, payrollEvent, type Trigger } from './payroll-config'

export const PERIOD_STATUSES = ['open', 'review', 'approved', 'finalized'] as const
export type PeriodStatus = (typeof PERIOD_STATUSES)[number]
export const ADJUSTMENT_TYPES = ['bonus', 'deduction', 'commission_adjustment', 'correction', 'other'] as const
export const ADJUSTMENT_LABELS: Record<(typeof ADJUSTMENT_TYPES)[number], string> = { bonus: 'Bonus', deduction: 'Deduction', commission_adjustment: 'Commission adjustment', correction: 'Correction', other: 'Other' }
export const KIND_LABELS: Record<string, string> = {
  base_hourly: 'Hourly pay', base_salary: 'Salary', base_flat: 'Flat pay', session_pay: 'Appointment pay', class_pay: 'Class pay',
  commission: 'Commission', refund_reversal: 'Refund reversal', adjustment: 'Adjustment',
}
const BASE_KINDS = ['base_hourly', 'base_salary', 'base_flat', 'session_pay', 'class_pay']
const PACKAGE_TYPES = ['class_pack', 'drop_in', 'pt_package']
const UNLOCKED: PeriodStatus[] = ['open', 'review']

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, 'That is not a real date')
export const periodCreateSchema = z.object({ name: z.string().trim().max(80).nullish(), startDate: day, endDate: day, notes: z.string().trim().max(500).nullish() })
export const adjustmentSchema = z.object({
  staffId: z.string().uuid(),
  type: z.enum(ADJUSTMENT_TYPES),
  // Always entered as a positive figure; "direction" says whether it adds to or takes from their pay. A deduction always takes.
  amountCents: z.number().int().min(1, 'Enter an amount').max(100_000_000),
  direction: z.enum(['add', 'subtract']).default('add'),
  reason: z.string().trim().min(3, 'Say why, so the record explains itself').max(500),
})
export const timeSchema = z.object({
  staffId: z.string().uuid(), workDate: day,
  minutes: z.number().int().min(1, 'Enter the time worked').max(24 * 60, 'A day has 24 hours'),
  locationId: z.string().uuid().nullish(), note: z.string().trim().max(300).nullish(),
})
export const periodActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }), z.object({ action: z.literal('submit') }), z.object({ action: z.literal('send_back') }),
  z.object({ action: z.literal('approve') }), z.object({ action: z.literal('finalize') }),
  z.object({ action: z.literal('reopen'), reason: z.string().trim().min(3, 'Say why it is being reopened').max(500) }),
])

const sourceKey = (ownerId: string, key: string) => `${ownerId}:${key}`
/** One payroll calculation per gym at a time. Held until the surrounding transaction ends. */
const lockLedger = (db: Db, ownerId: string) => db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${ownerId}`}))`
const lockPeriod = (db: Db, id: string) => db.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${id} FOR NO KEY UPDATE`
const round = Math.round

// ---------------------------------------------------------------------------
// Working out earnings from what has happened
// ---------------------------------------------------------------------------

interface Config {
  tz: string
  staff: Map<string, Staff>
  comps: StaffCompensation[]
  assignments: { staffId: string; planId: string; startsOn: string; endsOn: string | null }[]
  plans: Map<string, { id: string; name: string; isActive: boolean; rules: CommissionRule[] }>
}

async function loadConfig(db: Db, ownerId: string): Promise<Config> {
  const [settings, staff, comps, assignments, plans] = await Promise.all([
    getGymSettings(ownerId, db),
    db.staff.findMany({ where: { ownerId } }),
    db.staffCompensation.findMany({ where: { ownerId } }),
    db.commissionAssignment.findMany({ where: { ownerId } }),
    db.commissionPlan.findMany({ where: { ownerId }, include: { rules: { orderBy: { sortOrder: 'asc' } } } }),
  ])
  return { tz: settings.timezone, staff: new Map(staff.map((s) => [s.id, s])), comps, assignments, plans: new Map(plans.map((p) => [p.id, p])) }
}

/** The commission rules that apply to one person for one kind of event on one day. Nobody who has left earns anything new. */
function rulesFor(config: Config, staffId: string, at: Date, trigger: Trigger, match: (r: CommissionRule) => boolean) {
  const staff = config.staff.get(staffId)
  if (!staff || !staff.active) return null
  const assignment = assignmentOn(config.assignments.filter((a) => a.staffId === staffId), zonedParts(at, config.tz).date)
  const plan = assignment ? config.plans.get(assignment.planId) : null
  if (!plan || !plan.isActive) return null
  const rules = plan.rules.filter((r) => r.trigger === trigger && match(r))
  return rules.length ? { staff, plan, rules } : null
}

type NewEntry = Omit<Prisma.PayrollEntryCreateManyInput, 'ownerId'>

async function writeEntries(db: Db, ownerId: string, entries: NewEntry[]) {
  if (!entries.length) return 0
  // The unique key on each line means the same event cannot be entered twice, whatever else goes wrong.
  const result = await db.payrollEntry.createMany({ data: entries.filter((e) => e.amountCents !== 0).map((e) => ({ ownerId, ...e })), skipDuplicates: true })
  return result.count
}

const mark = (db: Db, ownerId: string, key: string, entries: number) => db.payrollSource.createMany({ data: [{ key: sourceKey(ownerId, key), ownerId, entries }], skipDuplicates: true })
const marked = async (db: Db, ownerId: string, key: string) => !!(await db.payrollSource.findUnique({ where: { key: sourceKey(ownerId, key) }, select: { key: true } }))

function commissionLine(input: {
  staff: Staff; plan: { id: string; name: string }; rule: CommissionRule; index: number; trigger: Trigger; key: string; share: number
  basisCents: number; grossCents: number; payFlat: boolean; earnedAt: Date; description: string
  sourceType: string; sourceId: string; invoiceId?: string | null; memberId?: string | null; memberName?: string | null; locationId?: string | null
}): NewEntry | null {
  const { rule, share } = input
  const amount = rule.rateType === 'percent' ? round((input.basisCents * rule.percentBps * share) / 1_000_000) : input.payFlat ? round((rule.flatCents * share) / 100) : 0
  if (amount <= 0) return null
  return {
    staffId: input.staff.id, staffName: input.staff.name, kind: 'commission', sourceKey: `${input.key}:${input.staff.id}:${input.index}`, sourceType: input.sourceType, sourceId: input.sourceId,
    invoiceId: input.invoiceId || null, memberId: input.memberId || null, memberName: input.memberName || null, locationId: input.locationId || null,
    trigger: input.trigger, commissionPlanId: input.plan.id, commissionPlanName: input.plan.name, rateType: rule.rateType, percentBps: rule.rateType === 'percent' ? rule.percentBps : null, flatCents: rule.rateType === 'flat' ? rule.flatCents : null,
    sharePercent: share, basisCents: rule.rateType === 'percent' ? input.basisCents : 0, grossCents: input.grossCents, amountCents: amount, description: input.description, earnedAt: input.earnedAt,
  }
}

/** A payment the gym received: commission on a membership sale, an upgrade, a renewal or a package. */
async function processPayment(db: Db, ownerId: string, config: Config, id: string) {
  const tx = await db.transaction.findFirst({
    where: { id, ownerId, type: 'payment', status: 'succeeded' },
    include: { member: { select: { name: true } }, invoice: { include: { items: true, appointments: { include: { type: { select: { name: true } } } } } } },
  })
  const invoice = tx?.invoice
  if (!tx || !invoice || invoice.orderId || invoice.totalCents <= 0) return 0
  // Commission is on what the gym keeps, so sales tax is taken out in the same proportion it was charged.
  const basis = round((tx.amountCents * (invoice.totalCents - invoice.taxCents)) / invoice.totalCents)
  const common = { basisCents: basis, grossCents: tx.amountCents, earnedAt: tx.createdAt, sourceType: 'transaction', sourceId: tx.id, invoiceId: invoice.id, memberId: tx.memberId, memberName: tx.member?.name || null, locationId: tx.locationId, key: `tx:${tx.id}` }
  const entries: NewEntry[] = []

  const appointment = invoice.appointments[0]
  if (appointment) {
    // Appointment revenue is earned when the appointment is delivered, and counted then. A payment
    // that arrives after that (an invoice settled late) is counted here instead; never both.
    if (!(await marked(db, ownerId, `appt:${appointment.id}`))) return 0
    if (appointment.status !== 'completed' && appointment.status !== 'no_show') return 0
    const found = rulesFor(config, appointment.staffId, appointment.startsAt, 'appointment', (r) => r.rateType === 'percent' && (!r.appointmentTypeIds.length || r.appointmentTypeIds.includes(appointment.typeId)) && (appointment.status === 'completed' || r.includeNoShow))
    if (!found) return 0
    found.rules.forEach((rule) => {
      const line = commissionLine({ ...common, staff: found.staff, plan: found.plan, rule, index: found.plan.rules.indexOf(rule), trigger: 'appointment', share: 100, payFlat: false, locationId: appointment.locationId, description: `${appointment.type.name} · payment received ${invoice.number}` })
      if (line) entries.push(line)
    })
    return writeEntries(db, ownerId, entries)
  }
  if (!invoice.membershipId) return 0

  const sold = invoice.items.find((i) => i.planId && i.amountCents > 0)
  const plan = sold?.planId ? await db.membershipPlan.findFirst({ where: { id: sold.planId, ownerId }, select: { id: true, name: true, type: true } }) : null
  if (!plan) return 0
  const change = await db.planChange.findFirst({ where: { ownerId, invoiceId: invoice.id }, select: { byId: true } })
  let trigger: Trigger
  if (change) trigger = 'membership_upgrade'
  else if (PACKAGE_TYPES.includes(plan.type)) trigger = 'package_sale'
  else {
    // The first invoice a membership ever had is the sale; every later one is a renewal.
    const first = await db.invoice.findFirst({ where: { ownerId, membershipId: invoice.membershipId, status: { not: 'void' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
    trigger = !first || first.id === invoice.id ? 'membership_sale' : 'membership_renewal'
  }

  // Who is credited: whoever is recorded as having sold the membership. An upgrade goes to the
  // person who made the change, and a sale with nobody recorded to the person who took the payment.
  const credited = await db.saleAttribution.findMany({ where: { ownerId, membershipId: invoice.membershipId }, orderBy: { staffId: 'asc' } })
  const acting = [tx.staffId, change?.byId].find((s) => s && config.staff.has(s)) || null
  let shares: { staffId: string; share: number }[]
  if (trigger === 'membership_upgrade' && acting) shares = [{ staffId: acting, share: 100 }]
  else if (credited.length) shares = credited.map((c) => ({ staffId: c.staffId, share: c.sharePercent }))
  else if (trigger !== 'membership_renewal' && acting) shares = [{ staffId: acting, share: 100 }]
  else return 0

  // A fixed amount per sale is paid once per invoice, with the first money received, not once per instalment.
  const earlier = await db.transaction.count({ where: { ownerId, invoiceId: invoice.id, type: 'payment', status: 'succeeded', OR: [{ createdAt: { lt: tx.createdAt } }, { createdAt: tx.createdAt, id: { lt: tx.id } }] } })
  const what = { membership_sale: 'Sale', membership_upgrade: 'Upgrade', membership_renewal: 'Renewal', package_sale: 'Sale' }[trigger as 'membership_sale']
  for (const { staffId, share } of shares) {
    const found = rulesFor(config, staffId, tx.createdAt, trigger, (r) => !r.planIds.length || r.planIds.includes(plan.id))
    if (!found) continue
    found.rules.forEach((rule) => {
      const line = commissionLine({ ...common, staff: found.staff, plan: found.plan, rule, index: found.plan.rules.indexOf(rule), trigger, share, payFlat: earlier === 0, description: `${what}: ${plan.name} · ${invoice.number}` })
      if (line) entries.push(line)
    })
  }
  return writeEntries(db, ownerId, entries)
}

/** Money given back: the commission that was paid on it is taken back in the same proportion. */
async function processRefund(db: Db, ownerId: string, id: string) {
  const refund = await db.transaction.findFirst({ where: { id, ownerId, type: 'refund', status: 'succeeded' }, include: { parent: true, invoice: { select: { number: true } } } })
  const parent = refund?.parent
  if (!refund || !parent) return 0
  const lines = await db.payrollEntry.findMany({
    where: {
      ownerId, kind: 'commission',
      OR: [{ sourceType: 'transaction', sourceId: parent.id }, ...(parent.invoiceId ? [{ sourceType: 'appointment', invoiceId: parent.invoiceId, grossCents: { gt: 0 } }] : [])],
    },
  })
  if (!lines.length) return 0
  const reversed = await db.payrollEntry.groupBy({ by: ['reversesEntryId'], where: { ownerId, reversesEntryId: { in: lines.map((l) => l.id) } }, _sum: { amountCents: true } })
  const whole = parent.refundedCents >= parent.amountCents
  const entries: NewEntry[] = []
  for (const line of lines) {
    const left = line.amountCents + (reversed.find((r) => r.reversesEntryId === line.id)?._sum.amountCents || 0)
    if (left <= 0 || line.grossCents <= 0) continue
    // The same share of the commission as the share of the money that went back; never more than is left of it.
    const share = line.sourceType === 'transaction' && whole ? left : Math.min(left, round((line.amountCents * refund.amountCents) / line.grossCents))
    if (share <= 0) continue
    entries.push({
      staffId: line.staffId, staffName: line.staffName, kind: 'refund_reversal', sourceKey: `refund:${refund.id}:${line.id}`, sourceType: 'transaction', sourceId: refund.id, invoiceId: line.invoiceId,
      memberId: line.memberId, memberName: line.memberName, locationId: line.locationId, trigger: line.trigger, commissionPlanId: line.commissionPlanId, commissionPlanName: line.commissionPlanName,
      rateType: line.rateType, percentBps: line.percentBps, flatCents: line.flatCents, sharePercent: line.sharePercent, basisCents: 0, grossCents: refund.amountCents,
      amountCents: -share, description: `Refund of ${formatMoney(refund.amountCents)}${refund.invoice ? ` on ${refund.invoice.number}` : ''}: ${line.description}`, reversesEntryId: line.id, earnedAt: refund.createdAt,
    })
  }
  return writeEntries(db, ownerId, entries)
}

/** A refund the processor reported as done and then failed: the money never went back, so the commission is restored. */
async function processRefundFailed(db: Db, ownerId: string, id: string) {
  const lines = await db.payrollEntry.findMany({ where: { ownerId, sourceType: 'transaction', sourceId: id, kind: 'refund_reversal' } })
  return writeEntries(db, ownerId, lines.map((line) => ({
    staffId: line.staffId, staffName: line.staffName, kind: 'commission', sourceKey: `refundfail:${id}:${line.id}`, sourceType: 'transaction', sourceId: id, invoiceId: line.invoiceId, memberId: line.memberId, memberName: line.memberName,
    locationId: line.locationId, trigger: line.trigger, commissionPlanId: line.commissionPlanId, commissionPlanName: line.commissionPlanName, rateType: line.rateType, percentBps: line.percentBps, flatCents: line.flatCents, sharePercent: line.sharePercent,
    // Counted against the original line, so what is left of it to reverse is right again.
    amountCents: -line.amountCents, description: `Refund did not go through: ${line.description}`, reversesEntryId: line.reversesEntryId, earnedAt: new Date(),
  })))
}

/** An appointment that took place (or a no-show the member still pays for): pay per session and commission. */
async function processAppointment(db: Db, ownerId: string, config: Config, id: string) {
  const a = await db.appointment.findFirst({ where: { id, ownerId, status: { in: ['completed', 'no_show'] } }, include: { type: { select: { name: true } }, member: { select: { name: true } }, invoice: { include: { transactions: true } } } })
  const staff = a ? config.staff.get(a.staffId) : null
  if (!a || !staff) return 0
  const entries: NewEntry[] = []
  const base = { staffId: staff.id, staffName: staff.name, sourceType: 'appointment', sourceId: a.id, invoiceId: a.invoiceId, memberId: a.memberId, memberName: a.member.name, locationId: a.locationId, earnedAt: a.startsAt }
  const when = a.status === 'no_show' ? ' (no-show)' : ''

  const comp = compFor(config.comps, staff.id, a.locationId)
  if (a.status === 'completed' && staff.active && comp && comp.perSessionCents > 0) {
    entries.push({ ...base, kind: 'session_pay', sourceKey: `appt:${a.id}:session`, rateCents: comp.perSessionCents, amountCents: comp.perSessionCents, description: `${a.type.name} with ${a.member.name}` })
  }

  // What the member has actually paid for it, after anything already given back.
  const payments = (a.invoice?.transactions || []).filter((t) => t.type === 'payment' && t.status === 'succeeded')
  const gross = payments.reduce((sum, t) => sum + t.amountCents - t.refundedCents, 0)
  const basis = a.invoice && a.invoice.totalCents > 0 ? round((gross * (a.invoice.totalCents - a.invoice.taxCents)) / a.invoice.totalCents) : 0
  const found = rulesFor(config, staff.id, a.startsAt, 'appointment', (r) => (!r.appointmentTypeIds.length || r.appointmentTypeIds.includes(a.typeId)) && (a.status === 'completed' || r.includeNoShow))
  found?.rules.forEach((rule) => {
    const line = commissionLine({ ...base, staff, plan: found.plan, rule, index: found.plan.rules.indexOf(rule), trigger: 'appointment', key: `appt:${a.id}`, share: 100, basisCents: basis, grossCents: rule.rateType === 'percent' ? gross : 0, payFlat: true, description: `${a.type.name} with ${a.member.name}${when}` })
    if (line) entries.push(line)
  })
  return writeEntries(db, ownerId, entries)
}

/** A class that was taught. */
async function processClass(db: Db, ownerId: string, config: Config, id: string) {
  const session = await db.classSession.findFirst({ where: { id, ownerId, status: 'scheduled' }, include: { classType: { select: { name: true } } } })
  const staff = session?.coachId ? config.staff.get(session.coachId) : null
  if (!session || !staff || !staff.active) return 0
  const entries: NewEntry[] = []
  const title = session.title || session.classType.name
  const base = { staffId: staff.id, staffName: staff.name, sourceType: 'class', sourceId: session.id, locationId: session.locationId, earnedAt: session.startsAt }
  const comp = compFor(config.comps, staff.id, session.locationId)
  if (comp && comp.perClassCents > 0) entries.push({ ...base, kind: 'class_pay', sourceKey: `class:${session.id}:pay`, rateCents: comp.perClassCents, amountCents: comp.perClassCents, description: `Taught ${title}` })
  const found = rulesFor(config, staff.id, session.startsAt, 'class', (r) => r.rateType === 'flat' && (!r.classTypeIds.length || r.classTypeIds.includes(session.classTypeId)))
  found?.rules.forEach((rule) => {
    const line = commissionLine({ ...base, staff, plan: found.plan, rule, index: found.plan.rules.indexOf(rule), trigger: 'class', key: `class:${session.id}`, share: 100, basisCents: 0, grossCents: 0, payFlat: true, description: `Taught ${title}` })
    if (line) entries.push(line)
  })
  return writeEntries(db, ownerId, entries)
}

/** A class that was paid for and then cancelled after the fact: take the pay back. */
async function processClassCancelled(db: Db, ownerId: string, id: string) {
  const lines = await db.payrollEntry.findMany({ where: { ownerId, sourceType: 'class', sourceId: id, kind: { in: ['class_pay', 'commission'] } } })
  return writeEntries(db, ownerId, lines.map((line) => ({
    staffId: line.staffId, staffName: line.staffName, kind: line.kind === 'commission' ? 'refund_reversal' : 'class_pay', sourceKey: `classvoid:${id}:${line.id}`, sourceType: 'class', sourceId: id, locationId: line.locationId,
    trigger: line.trigger, commissionPlanId: line.commissionPlanId, commissionPlanName: line.commissionPlanName, rateType: line.rateType, flatCents: line.flatCents, rateCents: line.rateCents,
    amountCents: -line.amountCents, description: `Class cancelled: ${line.description}`, reversesEntryId: line.id, earnedAt: new Date(),
  })))
}

/** Salary and flat pay for one period: brought to what it should be, by adding a line for any difference. */
async function basePay(db: Db, ownerId: string, config: Config, period: PayrollPeriod) {
  let created = 0
  const days = Math.round((period.endsAt.getTime() - period.startsAt.getTime()) / 86_400_000)
  const existing = await db.payrollEntry.groupBy({ by: ['staffId', 'kind'], where: { ownerId, periodId: period.id, sourceType: 'period' }, _sum: { amountCents: true }, _count: { _all: true } })
  for (const staff of config.staff.values()) {
    const comp = compFor(config.comps, staff.id, null)
    for (const kind of ['base_salary', 'base_flat'] as const) {
      const row = existing.find((e) => e.staffId === staff.id && e.kind === kind)
      const have = row?._sum.amountCents || 0
      // Someone who has left keeps what was already entered for the period; nothing is added or taken away for them here.
      if (!staff.active) continue
      const want = !comp ? 0 : kind === 'base_salary' ? (comp.basePay === 'salary' ? round((comp.annualSalaryCents * days) / 365) : 0) : comp.basePay === 'flat' ? comp.flatPerPeriodCents : 0
      if (want === have) continue
      const n = row?._count._all || 0
      created += await writeEntries(db, ownerId, [{
        staffId: staff.id, staffName: staff.name, periodId: period.id, kind, sourceKey: `base:${period.id}:${staff.id}:${kind}:${n}`, sourceType: 'period', sourceId: period.id,
        rateCents: kind === 'base_salary' ? comp?.annualSalaryCents || 0 : comp?.flatPerPeriodCents || 0, amountCents: want - have,
        description: n === 0 ? (kind === 'base_salary' ? `Salary for ${days} day${days === 1 ? '' : 's'} at ${formatMoney(comp?.annualSalaryCents || 0)} a year` : 'Flat pay for the period') : `${kind === 'base_salary' ? 'Salary' : 'Flat pay'} changed during the period`,
        earnedAt: new Date(Math.min(Date.now(), period.endsAt.getTime() - 1)),
      }])
    }
  }
  return created
}

/**
 * Bring the ledger up to date for one gym and place new lines in pay periods. Safe to call as
 * often as anyone likes, from anywhere, at the same time.
 */
export async function syncPayroll(ownerId: string): Promise<{ created: number }> {
  let created = 0
  const started = Date.now()
  // A gym's first sync, or one after a long gap, can have thousands of events to work out. They are
  // taken a batch at a time, each batch committed before the next, so the work is never lost to a
  // timeout and whatever is left is picked up by the next call.
  for (let round = 0; round < 60; round++) {
    const batch = await prisma.$transaction(async (db) => {
      await lockLedger(db, ownerId)
      return syncLocked(db, ownerId)
    }, { timeout: 60_000, maxWait: 20_000 })
    created += batch.created
    if (!batch.more || Date.now() - started > 40_000) break
  }
  return { created }
}

/** How many events of each kind one batch works out. */
const BATCH = 250

async function syncLocked(db: Db, ownerId: string) {
  const first = await db.payrollPeriod.findFirst({ where: { ownerId }, orderBy: { startsAt: 'asc' }, select: { startsAt: true } })
  // Payroll starts with the first pay period. Nothing before it is looked at.
  if (!first) return { created: 0, more: false }
  const since = first.startsAt
  const now = new Date()
  const config = await loadConfig(db, ownerId)
  let created = 0
  let more = false
  const fresh = (rows: { id: string }[]) => { if (rows.length >= BATCH) more = true; return rows.map((r) => r.id) }
  const unseen = (prefix: string) => `NOT EXISTS (SELECT 1 FROM "PayrollSource" s WHERE s.key = $1 || ':${prefix}:' || t.id)`
  const each = async (prefix: string, ids: string[], run: (id: string) => Promise<number>) => {
    for (const id of ids) {
      const n = await run(id)
      await mark(db, ownerId, `${prefix}:${id}`, n)
      created += n
    }
  }

  await each('tx', fresh(await db.$queryRawUnsafe(`SELECT t.id FROM "Transaction" t WHERE t."ownerId" = $1 AND t.type = 'payment' AND t.status = 'succeeded' AND t."invoiceId" IS NOT NULL AND t."createdAt" >= $2 AND ${unseen('tx')} ORDER BY t."createdAt", t.id LIMIT ${BATCH}`, ownerId, since)), (id) => processPayment(db, ownerId, config, id))
  await each('appt', fresh(await db.$queryRawUnsafe(`SELECT t.id FROM "Appointment" t WHERE t."ownerId" = $1 AND t.status IN ('completed', 'no_show') AND t."startsAt" >= $2 AND ${unseen('appt')} ORDER BY t."startsAt", t.id LIMIT ${BATCH}`, ownerId, since)), (id) => processAppointment(db, ownerId, config, id))
  await each('class', fresh(await db.$queryRawUnsafe(`SELECT t.id FROM "ClassSession" t WHERE t."ownerId" = $1 AND t.status = 'scheduled' AND t."coachId" IS NOT NULL AND t."startsAt" >= $2 AND t."endsAt" <= $3 AND ${unseen('class')} ORDER BY t."startsAt", t.id LIMIT ${BATCH}`, ownerId, since, now)), (id) => processClass(db, ownerId, config, id))
  await each('classvoid', fresh(await db.$queryRawUnsafe(`SELECT t.id FROM "ClassSession" t WHERE t."ownerId" = $1 AND t.status = 'cancelled' AND EXISTS (SELECT 1 FROM "PayrollEntry" e WHERE e."ownerId" = $1 AND e."sourceType" = 'class' AND e."sourceId" = t.id) AND ${unseen('classvoid')} LIMIT ${BATCH}`, ownerId)), (id) => processClassCancelled(db, ownerId, id))
  // Refunds last, so a payment and its refund arriving together are handled in the right order.
  // A refund can only be worked out after the payment it refunds. If this batch stopped short on
  // payments or appointments, refunds wait for the next batch.
  if (!more) {
    await each('refund', fresh(await db.$queryRawUnsafe(`SELECT t.id FROM "Transaction" t WHERE t."ownerId" = $1 AND t.type = 'refund' AND t.status = 'succeeded' AND t."parentTransactionId" IS NOT NULL AND t."createdAt" >= $2 AND ${unseen('refund')} ORDER BY t."createdAt", t.id LIMIT ${BATCH}`, ownerId, since)), (id) => processRefund(db, ownerId, id))

    await each('refundfail', fresh(await db.$queryRawUnsafe(`SELECT t.id FROM "Transaction" t WHERE t."ownerId" = $1 AND t.type = 'refund' AND t.status = 'failed' AND EXISTS (SELECT 1 FROM "PayrollEntry" e WHERE e."ownerId" = $1 AND e."sourceType" = 'transaction' AND e."sourceId" = t.id AND e.kind = 'refund_reversal') AND ${unseen('refundfail')} LIMIT ${BATCH}`, ownerId)), (id) => processRefundFailed(db, ownerId, id))
  }

  // Place what is not yet in a period. Earliest open period first; anything dated before a
  // period's start belongs to time that is already locked (or never had a period) and is carried.
  const open = await db.payrollPeriod.findMany({ where: { ownerId, status: { in: UNLOCKED } }, orderBy: { startsAt: 'asc' } })
  for (const period of open) {
    created += await basePay(db, ownerId, config, period)
    await db.payrollEntry.updateMany({ where: { ownerId, periodId: null, earnedAt: { gte: since, lt: period.startsAt } }, data: { periodId: period.id, carried: true } })
    await db.payrollEntry.updateMany({ where: { ownerId, periodId: null, earnedAt: { gte: period.startsAt, lt: period.endsAt } }, data: { periodId: period.id } })
  }
  return { created, more }
}

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------

export interface StaffTotals { staffId: string; staffName: string; active: boolean; baseCents: number; commissionCents: number; reversalCents: number; adjustmentCents: number; totalCents: number; lines: number }
export interface Totals { baseCents: number; commissionCents: number; reversalCents: number; adjustmentCents: number; totalCents: number }

function bucket(kind: string): keyof Totals {
  return BASE_KINDS.includes(kind) ? 'baseCents' : kind === 'commission' ? 'commissionCents' : kind === 'refund_reversal' ? 'reversalCents' : 'adjustmentCents'
}

async function totalsFor(db: Db, ownerId: string, where: Prisma.PayrollEntryWhereInput) {
  const rows = await db.payrollEntry.groupBy({ by: ['staffId', 'kind'], where: { ownerId, ...where }, _sum: { amountCents: true }, _count: { _all: true } })
  const names = await db.payrollEntry.findMany({ where: { ownerId, ...where }, distinct: ['staffId'], orderBy: { createdAt: 'desc' }, select: { staffId: true, staffName: true } })
  const staff = await db.staff.findMany({ where: { ownerId, id: { in: names.map((n) => n.staffId) } }, select: { id: true, name: true, active: true } })
  const byStaff = new Map<string, StaffTotals>()
  for (const row of rows) {
    const known = staff.find((s) => s.id === row.staffId)
    const t = byStaff.get(row.staffId) || { staffId: row.staffId, staffName: known?.name || names.find((n) => n.staffId === row.staffId)?.staffName || 'Former staff', active: !!known?.active, baseCents: 0, commissionCents: 0, reversalCents: 0, adjustmentCents: 0, totalCents: 0, lines: 0 }
    const amount = row._sum.amountCents || 0
    t[bucket(row.kind)] += amount
    t.totalCents += amount
    t.lines += row._count._all
    byStaff.set(row.staffId, t)
  }
  const list = Array.from(byStaff.values()).sort((a, b) => a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId))
  const totals = list.reduce<Totals>((sum, s) => ({ baseCents: sum.baseCents + s.baseCents, commissionCents: sum.commissionCents + s.commissionCents, reversalCents: sum.reversalCents + s.reversalCents, adjustmentCents: sum.adjustmentCents + s.adjustmentCents, totalCents: sum.totalCents + s.totalCents }), { baseCents: 0, commissionCents: 0, reversalCents: 0, adjustmentCents: 0, totalCents: 0 })
  return { staff: list, totals }
}

const periodOut = (p: PayrollPeriod) => ({
  id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, status: p.status as PeriodStatus, notes: p.notes, createdByName: p.createdByName,
  submittedAt: p.submittedAt, submittedByName: p.submittedByName, approvedAt: p.approvedAt, approvedByName: p.approvedByName, finalizedAt: p.finalizedAt, finalizedByName: p.finalizedByName,
  reopenedAt: p.reopenedAt, reopenedByName: p.reopenedByName, reopenReason: p.reopenReason, locked: !UNLOCKED.includes(p.status as PeriodStatus),
})

async function ownPeriod(db: Db, ownerId: string, id: string) {
  const period = await db.payrollPeriod.findFirst({ where: { id, ownerId } })
  if (!period) throw notFound('Pay period')
  return period
}

export async function createPeriod(ownerId: string, input: z.infer<typeof periodCreateSchema>, actor: ActorRef) {
  if (input.endDate < input.startDate) throw badRequest('The end date is before the start date.', 'bad_range')
  const settings = await getGymSettings(ownerId)
  const startsAt = zonedToUtc(input.startDate, '00:00', settings.timezone)
  const endsAt = zonedToUtc(addDaysToDate(input.endDate, 1), '00:00', settings.timezone)
  if (endsAt.getTime() - startsAt.getTime() > 93 * 86_400_000) throw badRequest('A pay period can be at most three months long.', 'too_long')
  const period = await prisma.$transaction(async (db) => {
    // Under the gym's payroll lock, so two people cannot create overlapping periods at the same moment.
    await lockLedger(db, ownerId)
    const clash = await db.payrollPeriod.findFirst({ where: { ownerId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })
    if (clash) throw conflict(`Those dates overlap ${clash.name} (${clash.startDate} to ${clash.endDate}).`, 'period_overlap')
    const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const created = await db.payrollPeriod.create({
      data: { ownerId, name: input.name || `${fmt(input.startDate)} – ${fmt(input.endDate)}, ${input.endDate.slice(0, 4)}`, startDate: input.startDate, endDate: input.endDate, startsAt, endsAt, notes: input.notes || null, createdByName: actor.name || null },
    })
    await payrollEvent(db, { ownerId, type: 'period_created', actor, periodId: created.id, metadata: { startDate: input.startDate, endDate: input.endDate } })
    await syncLocked(db, ownerId)
    return created
  }, { timeout: 60_000, maxWait: 20_000 })
  return periodOut(period)
}

export async function listPeriods(ownerId: string) {
  // Looking at payroll brings it up to date. If that fails the page still shows what is on record.
  await syncPayroll(ownerId).catch((error) => console.error('[payroll] sync failed:', (error as Error).message))
  const [periods, sums, settings] = await Promise.all([
    prisma.payrollPeriod.findMany({ where: { ownerId }, orderBy: { startsAt: 'desc' } }),
    prisma.payrollEntry.groupBy({ by: ['periodId', 'kind'], where: { ownerId, periodId: { not: null } }, _sum: { amountCents: true } }),
    getGymSettings(ownerId),
  ])
  const staffCounts = await prisma.payrollEntry.groupBy({ by: ['periodId', 'staffId'], where: { ownerId, periodId: { not: null } } })
  const today = zonedParts(new Date(), settings.timezone).date
  const rows = periods.map((p) => {
    const totals: Totals = { baseCents: 0, commissionCents: 0, reversalCents: 0, adjustmentCents: 0, totalCents: 0 }
    for (const s of sums.filter((x) => x.periodId === p.id)) { totals[bucket(s.kind)] += s._sum.amountCents || 0; totals.totalCents += s._sum.amountCents || 0 }
    return { ...periodOut(p), ...totals, staffCount: staffCounts.filter((c) => c.periodId === p.id).length, current: p.startDate <= today && p.endDate >= today }
  })
  const last = periods[0]
  return {
    periods: rows,
    currentId: rows.find((r) => r.current)?.id || rows.find((r) => !r.locked)?.id || null,
    // The dates the next period would naturally have: straight after the latest, and as long.
    suggestion: last
      ? { startDate: addDaysToDate(last.endDate, 1), endDate: addDaysToDate(last.endDate, Math.round((last.endsAt.getTime() - last.startsAt.getTime()) / 86_400_000)) }
      : { startDate: `${today.slice(0, 8)}01`, endDate: addDaysToDate(`${today.slice(0, 8)}01`, 13) },
    today,
  }
}

export async function periodDetail(ownerId: string, id: string, filter: { locationId?: string | null } = {}) {
  let period = await ownPeriod(prisma, ownerId, id)
  if (UNLOCKED.includes(period.status as PeriodStatus)) {
    await syncPayroll(ownerId).catch((error) => console.error('[payroll] sync failed:', (error as Error).message))
    period = await ownPeriod(prisma, ownerId, id)
  }
  const where: Prisma.PayrollEntryWhereInput = { periodId: period.id, ...(filter.locationId && { locationId: filter.locationId }) }
  const [{ staff, totals }, events, time, comps, roster, locations] = await Promise.all([
    totalsFor(prisma, ownerId, where),
    prisma.payrollEvent.findMany({ where: { ownerId, periodId: period.id }, orderBy: { createdAt: 'desc' }, take: 60 }),
    prisma.payrollTimeEntry.groupBy({ by: ['staffId'], where: { ownerId, periodId: period.id, voidedAt: null }, _sum: { minutes: true } }),
    prisma.staffCompensation.findMany({ where: { ownerId, locationId: null } }),
    prisma.staff.findMany({ where: { ownerId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true } }),
    prisma.location.findMany({ where: { ownerId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  const carried = await prisma.payrollEntry.count({ where: { ownerId, periodId: period.id, carried: true } })
  // What was locked in should still be what the ledger says. If it ever is not, say so rather than show either figure quietly.
  const snapshot = period.totals as { totalCents?: number } | null
  const whole = filter.locationId ? (await totalsFor(prisma, ownerId, { periodId: period.id })).totals : totals
  return {
    ...periodOut(period), staff: staff.map((s) => ({ ...s, minutes: time.find((t) => t.staffId === s.staffId)?._sum.minutes || 0 })), totals, carriedLines: carried,
    integrity: period.status === 'finalized' && snapshot ? { ok: snapshot.totalCents === whole.totalCents, lockedTotalCents: snapshot.totalCents ?? null } : null,
    events: events.map((e) => ({ id: e.id, type: e.type, at: e.createdAt, actorName: e.actorName || (e.actorType === 'system' ? 'System' : null), metadata: e.metadata })),
    roster: roster.map((s) => ({ ...s, hourly: comps.some((c) => c.staffId === s.id && c.basePay === 'hourly') })), locations,
  }
}

const lineOut = (e: PayrollEntry) => ({
  id: e.id, kind: e.kind, adjustmentType: e.adjustmentType, description: e.description, reason: e.reason, earnedAt: e.earnedAt, createdAt: e.createdAt, carried: e.carried,
  memberName: e.memberName, trigger: e.trigger, commissionPlanName: e.commissionPlanName, rateType: e.rateType, percentBps: e.percentBps, flatCents: e.flatCents, sharePercent: e.sharePercent,
  basisCents: e.basisCents, minutes: e.minutes, rateCents: e.rateCents, amountCents: e.amountCents, reversesEntryId: e.reversesEntryId, createdByName: e.createdByName, sourceType: e.sourceType,
})

export async function staffLines(ownerId: string, periodId: string, staffId: string) {
  const period = await ownPeriod(prisma, ownerId, periodId)
  const [entries, time, staff] = await Promise.all([
    prisma.payrollEntry.findMany({ where: { ownerId, periodId: period.id, staffId }, orderBy: [{ earnedAt: 'asc' }, { createdAt: 'asc' }] }),
    prisma.payrollTimeEntry.findMany({ where: { ownerId, periodId: period.id, staffId }, orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }] }),
    prisma.staff.findFirst({ where: { id: staffId, ownerId }, select: { id: true, name: true, active: true, role: true } }),
  ])
  if (!staff && !entries.length) throw notFound('Staff member')
  const totals: Totals = { baseCents: 0, commissionCents: 0, reversalCents: 0, adjustmentCents: 0, totalCents: 0 }
  for (const e of entries) { totals[bucket(e.kind)] += e.amountCents; totals.totalCents += e.amountCents }
  return {
    period: periodOut(period), staff: { id: staffId, name: staff?.name || entries[0]?.staffName || 'Former staff', active: !!staff?.active },
    totals, lines: entries.map(lineOut),
    time: time.map((t) => ({ id: t.id, workDate: t.workDate, minutes: t.minutes, note: t.note, voided: !!t.voidedAt, createdByName: t.createdByName })),
  }
}

/** Finish working out earnings inside the caller's transaction, or refuse the step rather than approve something incomplete. */
async function caughtUp(db: Db, ownerId: string) {
  for (let round = 0; round < 4; round++) if (!(await syncLocked(db, ownerId)).more) return
  throw conflict('Earnings are still being worked out. Try again in a moment.', 'still_syncing')
}

/** Move a period through review, approval and locking. Every step can be repeated without doing anything twice. */
export async function periodAction(ownerId: string, id: string, input: z.infer<typeof periodActionSchema>, actor: ActorRef, may: { reopen: boolean }) {
  if (input.action === 'sync') {
    await ownPeriod(prisma, ownerId, id)
    return { ...(await syncPayroll(ownerId)), changed: true }
  }
  // Anything large is worked out first, in its own committed batches, so the step below only has the last moments to catch up on.
  if (input.action === 'submit' || input.action === 'approve') await syncPayroll(ownerId)
  return prisma.$transaction(async (db) => {
    // The ledger lock first, then the period: the same order everywhere, so nothing can deadlock.
    await lockLedger(db, ownerId)
    await ownPeriod(db, ownerId, id)
    await lockPeriod(db, id)
    const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id } })
    const status = period.status as PeriodStatus
    const now = new Date()
    const done = (p: PayrollPeriod, changed: boolean) => ({ ...periodOut(p), changed })
    const move = async (to: PeriodStatus, data: Prisma.PayrollPeriodUpdateInput, type: string, metadata: Record<string, unknown> = {}) => {
      const updated = await db.payrollPeriod.update({ where: { id }, data: { status: to, ...data } })
      await payrollEvent(db, { ownerId, type, actor, periodId: id, metadata: { from: status, to, ...metadata } })
      return done(updated, true)
    }

    switch (input.action) {
      case 'submit':
        if (status === 'review') return done(period, false)
        if (status !== 'open') throw conflict(`This period is already ${status}.`, 'wrong_status')
        await caughtUp(db, ownerId)
        return move('review', { submittedAt: now, submittedByName: actor.name || null }, 'period_submitted')
      case 'send_back':
        if (status === 'open') return done(period, false)
        if (status !== 'review') throw conflict(`This period is ${status}. Reopen it first.`, 'wrong_status')
        return move('open', {}, 'period_sent_back')
      case 'approve': {
        if (status === 'approved' || status === 'finalized') return done(period, false)
        if (status !== 'review') throw conflict('Send the period for review before approving it.', 'wrong_status')
        // One last look, so what is approved includes everything up to this moment. After this nothing more is placed in it.
        await caughtUp(db, ownerId)
        const { totals } = await totalsFor(db, ownerId, { periodId: id })
        return move('approved', { approvedAt: now, approvedByName: actor.name || null }, 'period_approved', { totalCents: totals.totalCents })
      }
      case 'finalize': {
        if (status === 'finalized') return done(period, false)
        if (status !== 'approved') throw conflict('Approve the period before finalizing it.', 'wrong_status')
        const { staff, totals } = await totalsFor(db, ownerId, { periodId: id })
        const lines = await db.payrollEntry.findMany({ where: { ownerId, periodId: id }, orderBy: { id: 'asc' }, select: { id: true, amountCents: true } })
        const fingerprint = createHash('sha256').update(lines.map((l) => `${l.id}:${l.amountCents}`).join('|')).digest('hex')
        return move('finalized', { finalizedAt: now, finalizedByName: actor.name || null, totals: JSON.parse(JSON.stringify({ ...totals, lines: lines.length, fingerprint, staff })) }, 'period_finalized', { totalCents: totals.totalCents, lines: lines.length, fingerprint })
      }
      case 'reopen': {
        if (!may.reopen) throw new ApiError(403, 'Only the owner or an admin can reopen a pay period.', 'forbidden')
        if (status === 'review' || status === 'open') return done(period, false)
        const was = period.totals as { totalCents?: number } | null
        return move('review', { reopenedAt: now, reopenedByName: actor.name || null, reopenReason: input.reason, approvedAt: null, approvedByName: null, finalizedAt: null, finalizedByName: null, totals: Prisma.DbNull }, 'period_reopened', { reason: input.reason, lockedTotalCents: was?.totalCents ?? null })
      }
    }
  }, { timeout: 60_000, maxWait: 20_000 })
}

/** A period that can still take new lines, held so it cannot be approved while the line is being written. */
async function unlockedPeriod(db: Db, ownerId: string, id: string) {
  await ownPeriod(db, ownerId, id)
  await lockPeriod(db, id)
  const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id } })
  if (!UNLOCKED.includes(period.status as PeriodStatus)) throw conflict(`This pay period is ${period.status} and can no longer be changed. Put it in the next period, or have the owner reopen this one.`, 'period_locked')
  return period
}

// ---------------------------------------------------------------------------
// Adjustments and hours
// ---------------------------------------------------------------------------

export async function addAdjustment(ownerId: string, periodId: string, input: z.infer<typeof adjustmentSchema>, actor: ActorRef, idempotencyKey?: string | null) {
  const signed = input.type === 'deduction' || input.direction === 'subtract' ? -input.amountCents : input.amountCents
  const key = idempotencyKey ? `adj:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40)}` : `adj:${randomUUID()}`
  return prisma.$transaction(async (db) => {
    const period = await unlockedPeriod(db, ownerId, periodId)
    const staff = await db.staff.findFirst({ where: { id: input.staffId, ownerId } })
    if (!staff) throw notFound('Staff member')
    // The same request sent twice (a double click, a retry after a timeout) is one adjustment.
    const earlier = await db.payrollEntry.findUnique({ where: { ownerId_sourceKey: { ownerId, sourceKey: key } } })
    if (earlier) {
      if (earlier.staffId !== staff.id || earlier.amountCents !== signed || earlier.periodId !== period.id || earlier.adjustmentType !== input.type) throw conflict('This request key was already used for a different adjustment.', 'idempotency_key_reused')
      return { ...lineOut(earlier), replayed: true }
    }
    const entry = await db.payrollEntry.create({
      data: {
        ownerId, staffId: staff.id, staffName: staff.name, periodId: period.id, kind: 'adjustment', adjustmentType: input.type, sourceKey: key, sourceType: 'manual',
        amountCents: signed, description: ADJUSTMENT_LABELS[input.type], reason: input.reason, earnedAt: new Date(), createdByType: actor.type, createdById: actor.id || null, createdByName: actor.name || null,
      },
    })
    await payrollEvent(db, { ownerId, type: 'adjustment_added', actor, periodId: period.id, staffId: staff.id, metadata: { entryId: entry.id, staffName: staff.name, adjustmentType: input.type, amountCents: signed, reason: input.reason } })
    return { ...lineOut(entry), replayed: false }
  })
}

export async function addTime(ownerId: string, periodId: string, input: z.infer<typeof timeSchema>, actor: ActorRef) {
  return prisma.$transaction(async (db) => {
    const period = await unlockedPeriod(db, ownerId, periodId)
    if (input.workDate < period.startDate || input.workDate > period.endDate) throw badRequest(`That date is outside this pay period (${period.startDate} to ${period.endDate}).`, 'outside_period')
    const staff = await db.staff.findFirst({ where: { id: input.staffId, ownerId } })
    if (!staff) throw notFound('Staff member')
    if (input.locationId && !(await db.location.findFirst({ where: { id: input.locationId, ownerId } }))) throw notFound('Location')
    const comp = compFor(await db.staffCompensation.findMany({ where: { ownerId, staffId: staff.id } }), staff.id, input.locationId)
    if (!comp || comp.basePay !== 'hourly' || comp.hourlyRateCents <= 0) throw badRequest(`${staff.name} is not set up with an hourly rate${input.locationId ? ' for that location' : ''}. Set it under Compensation first.`, 'not_hourly')
    const worked = await db.payrollTimeEntry.aggregate({ where: { ownerId, staffId: staff.id, workDate: input.workDate, voidedAt: null }, _sum: { minutes: true } })
    if ((worked._sum.minutes || 0) + input.minutes > 24 * 60) throw badRequest(`That would be more than 24 hours for ${staff.name} on ${input.workDate}.`, 'too_many_hours')
    const time = await db.payrollTimeEntry.create({ data: { ownerId, periodId: period.id, staffId: staff.id, workDate: input.workDate, minutes: input.minutes, locationId: input.locationId || null, note: input.note || null, createdByName: actor.name || null } })
    const settings = await getGymSettings(ownerId, db)
    const hours = input.minutes / 60
    await db.payrollEntry.create({
      data: {
        ownerId, staffId: staff.id, staffName: staff.name, periodId: period.id, kind: 'base_hourly', sourceKey: `time:${time.id}`, sourceType: 'time', sourceId: time.id, locationId: input.locationId || null,
        minutes: input.minutes, rateCents: comp.hourlyRateCents, amountCents: round((input.minutes * comp.hourlyRateCents) / 60),
        description: `${Number(hours.toFixed(2))} hour${hours === 1 ? '' : 's'} on ${new Date(`${input.workDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} at ${formatMoney(comp.hourlyRateCents)}/hr${input.note ? ` · ${input.note}` : ''}`,
        earnedAt: zonedToUtc(input.workDate, '12:00', settings.timezone), createdByType: actor.type, createdById: actor.id || null, createdByName: actor.name || null,
      },
    })
    await payrollEvent(db, { ownerId, type: 'hours_added', actor, periodId: period.id, staffId: staff.id, metadata: { staffName: staff.name, workDate: input.workDate, minutes: input.minutes, rateCents: comp.hourlyRateCents } })
    return { id: time.id }
  })
}

/** Take back hours entered by mistake. The original line stays; a line cancelling it is added. */
export async function voidTime(ownerId: string, periodId: string, timeId: string, actor: ActorRef) {
  return prisma.$transaction(async (db) => {
    const period = await unlockedPeriod(db, ownerId, periodId)
    const time = await db.payrollTimeEntry.findFirst({ where: { id: timeId, ownerId, periodId: period.id } })
    if (!time) throw notFound('Hours')
    if (time.voidedAt) return { voided: false }
    const line = await db.payrollEntry.findUnique({ where: { ownerId_sourceKey: { ownerId, sourceKey: `time:${time.id}` } } })
    await db.payrollTimeEntry.update({ where: { id: time.id }, data: { voidedAt: new Date(), voidedByName: actor.name || null } })
    if (line) {
      await db.payrollEntry.createMany({
        skipDuplicates: true,
        data: [{
          ownerId, staffId: line.staffId, staffName: line.staffName, periodId: period.id, kind: 'base_hourly', sourceKey: `time:${time.id}:void`, sourceType: 'time', sourceId: time.id, locationId: line.locationId,
          minutes: -(line.minutes || 0), rateCents: line.rateCents, amountCents: -line.amountCents, description: `Removed: ${line.description}`, reversesEntryId: line.id, earnedAt: new Date(),
          createdByType: actor.type, createdById: actor.id || null, createdByName: actor.name || null,
        }],
      })
    }
    await payrollEvent(db, { ownerId, type: 'hours_removed', actor, periodId: period.id, staffId: time.staffId, metadata: { workDate: time.workDate, minutes: time.minutes } })
    return { voided: true }
  })
}

// ---------------------------------------------------------------------------
// Export and each person's own earnings
// ---------------------------------------------------------------------------

const dollars = (cents: number) => (cents / 100).toFixed(2)

export async function exportPeriod(ownerId: string, id: string, format: 'summary' | 'detail', actor: ActorRef) {
  const period = await ownPeriod(prisma, ownerId, id)
  const settings = await getGymSettings(ownerId)
  await payrollEvent(prisma, { ownerId, type: 'period_exported', actor, periodId: id, metadata: { format } })
  if (format === 'summary') {
    const { staff, totals } = await totalsFor(prisma, ownerId, { periodId: id })
    const people = await prisma.staff.findMany({ where: { ownerId, id: { in: staff.map((s) => s.staffId) } }, select: { id: true, email: true, role: true } })
    const time = await prisma.payrollTimeEntry.groupBy({ by: ['staffId'], where: { ownerId, periodId: id, voidedAt: null }, _sum: { minutes: true } })
    return {
      filename: `payroll-${period.startDate}-to-${period.endDate}`,
      headers: ['Staff', 'Email', 'Role', 'Period start', 'Period end', 'Status', 'Hours', 'Base pay', 'Commissions', 'Refund reversals', 'Adjustments', 'Total payable'],
      rows: [
        ...staff.map((s) => [s.staffName, people.find((p) => p.id === s.staffId)?.email || '', people.find((p) => p.id === s.staffId)?.role || '', period.startDate, period.endDate, period.status, ((time.find((t) => t.staffId === s.staffId)?._sum.minutes || 0) / 60).toFixed(2), dollars(s.baseCents), dollars(s.commissionCents), dollars(s.reversalCents), dollars(s.adjustmentCents), dollars(s.totalCents)]),
        ['TOTAL', '', '', period.startDate, period.endDate, period.status, '', dollars(totals.baseCents), dollars(totals.commissionCents), dollars(totals.reversalCents), dollars(totals.adjustmentCents), dollars(totals.totalCents)],
      ],
    }
  }
  const entries = await prisma.payrollEntry.findMany({ where: { ownerId, periodId: id }, orderBy: [{ staffName: 'asc' }, { earnedAt: 'asc' }, { createdAt: 'asc' }] })
  return {
    filename: `payroll-lines-${period.startDate}-to-${period.endDate}`,
    headers: ['Staff', 'Date', 'Type', 'Description', 'Member', 'Revenue basis', 'Rate', 'Share %', 'Hours', 'Amount', 'Reason', 'Entered by', 'Carried from earlier period', 'Line ID'],
    rows: entries.map((e) => [
      e.staffName, zonedParts(e.earnedAt, settings.timezone).date, e.kind === 'adjustment' && e.adjustmentType ? ADJUSTMENT_LABELS[e.adjustmentType as 'bonus'] : KIND_LABELS[e.kind] || e.kind, e.description, e.memberName || '',
      e.basisCents ? dollars(e.basisCents) : '', e.rateType === 'percent' ? `${(e.percentBps || 0) / 100}%` : e.rateType === 'flat' ? dollars(e.flatCents || 0) : e.rateCents ? dollars(e.rateCents) : '',
      e.kind === 'commission' || e.kind === 'refund_reversal' ? e.sharePercent : '', e.minutes ? (e.minutes / 60).toFixed(2) : '', dollars(e.amountCents), e.reason || '', e.createdByName || 'System', e.carried ? 'yes' : '', e.id,
    ]),
  }
}

/** What one person has earned, period by period. Only ever their own. */
export async function myEarnings(ownerId: string, staffId: string) {
  const [periods, sums] = await Promise.all([
    prisma.payrollPeriod.findMany({ where: { ownerId }, orderBy: { startsAt: 'desc' }, take: 24 }),
    prisma.payrollEntry.groupBy({ by: ['periodId', 'kind'], where: { ownerId, staffId, periodId: { not: null } }, _sum: { amountCents: true } }),
  ])
  return {
    periods: periods.map((p) => {
      const totals: Totals = { baseCents: 0, commissionCents: 0, reversalCents: 0, adjustmentCents: 0, totalCents: 0 }
      for (const s of sums.filter((x) => x.periodId === p.id)) { totals[bucket(s.kind)] += s._sum.amountCents || 0; totals.totalCents += s._sum.amountCents || 0 }
      return { id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, status: p.status, ...totals }
    }),
  }
}

export async function myLines(ownerId: string, staffId: string, periodId: string) {
  const period = await ownPeriod(prisma, ownerId, periodId)
  const entries = await prisma.payrollEntry.findMany({ where: { ownerId, periodId: period.id, staffId }, orderBy: [{ earnedAt: 'asc' }, { createdAt: 'asc' }] })
  // Their own lines, without who entered an adjustment or the member's name on someone else's sale beyond their own.
  return { period: { id: period.id, name: period.name, startDate: period.startDate, endDate: period.endDate, status: period.status }, lines: entries.map((e) => ({ ...lineOut(e), createdByName: undefined })) }
}
