// Changing a recurring membership from one plan to another.
//
// previewPlanChange and applyPlanChange both go through computePlanChange, which gathers the facts
// (what was paid for the current period, the new price, who holds the credit) and hands them to the
// one proration calculation in lib/billing/proration.ts. The invoice raised and the amount charged
// are taken from that same result, and applying checks it against what the person was shown.
//
// Applying holds a row lock on the membership, so two changes at once run one after the other, and
// the second is refused because the membership is no longer what its preview described.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { addInterval } from '@/lib/dates'
import { formatDate, formatMoney } from '@/lib/format'
import { Proration, calculateProration, calculateScheduledChange, prorate } from '@/lib/billing/proration'
import { ActorRef, Db, SYSTEM, getGymSettings, lockRow, logActivity } from './core'
import { membershipEvent } from './events'
import { LineItem, createInvoice } from './payments'
import { applyCreditsToInvoice, creditAvailable, grantCredit } from './account-credit'
import { billingPayer } from './households'
import { requestHash, withIdempotency } from './idempotency'
import { effectivePrice, intervalLabel } from './memberships'

export type Effective = 'now' | 'next_period'

export interface PlanSummary { id: string; name: string; priceCents: number; interval: string; intervalCount: number; label: string }

export interface PlanChangePreview {
  membershipId: string
  member: { id: string; name: string }
  from: PlanSummary
  to: PlanSummary
  effective: Effective
  /** False when the change cannot go ahead; `blocked` says why. The numbers are still shown. */
  allowed: boolean
  blocked: { code: string; message: string } | null
  /** Where "what was paid for this period" came from. */
  basis: { invoiceId: string | null; invoiceNumber: string | null; paidCents: number; assumed: boolean; from: string; note: string }
  calc: Proration
  /** Who is charged, and who holds any credit: the household payer when there is one. */
  payer: { id: string; name: string; viaHousehold: boolean }
  /** How the amount due will be collected. */
  collection: { method: string; automatic: boolean; description: string }
  currentPeriodEnd: string | null
  scheduled: { planId: string; name: string } | null
}

const summary = (plan: { id: string; name: string; billingInterval: string; intervalCount: number; type: string }, priceCents: number): PlanSummary =>
  ({ id: plan.id, name: plan.name, priceCents, interval: plan.billingInterval, intervalCount: plan.intervalCount, label: intervalLabel(plan) })

const block = (code: string, message: string) => ({ code, message })

export interface ComputeInput {
  ownerId: string
  membershipId: string
  planId: string
  effective: Effective
  /** Members choosing for themselves only see plans the gym offers publicly, and need a real paid invoice to prorate from. */
  source: 'staff' | 'member'
  at?: Date
}

/** The facts and the calculation for one plan change. Reads only. */
export async function computePlanChange(db: Db, input: ComputeInput): Promise<PlanChangePreview> {
  const at = input.at || new Date()
  const membership = await db.membership.findFirst({ where: { id: input.membershipId, ownerId: input.ownerId }, include: { plan: true, member: { select: { id: true, name: true } } } })
  if (!membership) throw notFound('Membership')
  const plan = await db.membershipPlan.findFirst({ where: { id: input.planId, ownerId: input.ownerId, ...(input.source === 'member' && { isPublic: true }) } })
  if (!plan) throw notFound('Membership plan')
  const settings = await getGymSettings(input.ownerId, db)
  const tz = settings.timezone
  const newPrice = effectivePrice(plan.priceCents, membership.discountPercent)
  const newTaxRateBps = plan.taxRateBps || settings.defaultTaxRateBps
  const periodStart = membership.currentPeriodStart || membership.startDate
  const periodEnd = membership.currentPeriodEnd || addInterval(periodStart, membership.plan.billingInterval, membership.plan.intervalCount)
  const sameCycle = plan.billingInterval === membership.plan.billingInterval && plan.intervalCount === membership.plan.intervalCount
  const inTrial = membership.status === 'trial'

  let blocked: PlanChangePreview['blocked'] = null
  if (membership.plan.type !== 'recurring') blocked = block('not_recurring', 'Only recurring memberships can change plan.')
  else if (plan.type !== 'recurring') blocked = block('not_recurring', 'Choose a recurring plan to switch to.')
  else if (!plan.isActive) blocked = block('plan_inactive', 'That plan is no longer offered.')
  else if (plan.id === membership.planId) blocked = block('same_plan', `${membership.member.name} is already on ${plan.name}.`)
  else if (['cancelled', 'expired'].includes(membership.status)) blocked = block('already_ended', 'This membership has ended.')
  else if (membership.status === 'frozen') blocked = block('frozen', 'This membership is frozen. Resume it before changing plan.')
  else if (membership.status === 'past_due') blocked = block('past_due', 'This membership has an unpaid invoice. Collect or void it before changing plan.')
  else if (membership.cancelAt) blocked = block('cancelling', 'This membership is set to cancel. Withdraw the cancellation before changing plan.')
  else if (!membership.currentPeriodEnd) blocked = block('no_period', 'This membership has no billing period to work from.')
  else if (input.effective === 'now' && membership.currentPeriodEnd <= at) blocked = block('renewal_due', 'This membership is due to renew right now. Try again once the renewal has gone through.')

  // What was paid for the time the member still has. After an earlier change in this period, that is
  // what the earlier change charged for the days from then on; otherwise it is the period's own invoice.
  // A change that waits for the billing date prorates nothing, so it does not depend on what was paid.
  const proratedNow = input.effective === 'now'
  let window = { start: periodStart, paidCents: 0, invoiceId: null as string | null, invoiceNumber: null as string | null, assumed: false, from: 'trial', note: 'Free trial: nothing has been paid yet.' }
  if (!inTrial) {
    const earlier = await db.planChange.findFirst({
      where: { ownerId: input.ownerId, membershipId: membership.id, effective: 'now', status: 'applied', createdAt: { gte: periodStart } },
      orderBy: { createdAt: 'desc' },
    })
    if (earlier) {
      const calc = earlier.calculation as unknown as Proration
      const invoice = earlier.invoiceId ? await db.invoice.findUnique({ where: { id: earlier.invoiceId }, select: { id: true, number: true, status: true, refundedCents: true } }) : null
      if (invoice?.status === 'open' && !blocked && proratedNow) blocked = block('unpaid_invoice', `${invoice.number} from the last plan change is unpaid. Collect or void it before changing plan again.`)
      window = {
        start: new Date(calc.effectiveAt), paidCents: Math.max(0, calc.newChargeCents - (invoice?.refundedCents || 0)), invoiceId: invoice?.id || null, invoiceNumber: invoice?.number || null,
        assumed: false, from: 'plan_change', note: `Based on the plan change on ${formatDate(new Date(calc.effectiveAt), tz)}${invoice ? ` (${invoice.number})` : ''}.`,
      }
    } else {
      const invoice = await db.invoice.findFirst({ where: { ownerId: input.ownerId, membershipId: membership.id, periodStart }, include: { items: { select: { type: true, amountCents: true } } } })
      if (!invoice) {
        // Billed outside ClubCheck (imported or migrated). Staff may go ahead on the plan's own price; a member may not.
        window = { start: periodStart, paidCents: membership.priceCents, invoiceId: null, invoiceNumber: null, assumed: true, from: 'assumed', note: `No invoice is on record for this period, so it is taken as paid at ${formatMoney(membership.priceCents)}. Check before confirming.` }
        if (input.source === 'member' && !blocked && proratedNow) blocked = block('no_invoice', 'Please ask the team to make this change for you.')
      } else {
        if (invoice.status === 'open' && !blocked && proratedNow) blocked = block('unpaid_invoice', `${invoice.number} for this period is unpaid. Collect or void it before changing plan.`)
        if (invoice.status === 'draft' && !blocked && proratedNow) blocked = block('unpaid_invoice', `${invoice.number} for this period is still a draft.`)
        // Only the membership's share of what was paid counts: not an enrollment fee, and less any refund.
        const lines = invoice.items.reduce((sum, i) => sum + Math.max(0, i.amountCents), 0)
        const membershipLines = invoice.items.filter((i) => i.type === 'membership').reduce((sum, i) => sum + Math.max(0, i.amountCents), 0)
        const kept = invoice.status === 'void' ? 0 : Math.max(0, invoice.amountPaidCents - invoice.refundedCents)
        window = {
          start: periodStart, paidCents: lines > 0 ? prorate(kept, membershipLines, lines) : 0, invoiceId: invoice.id, invoiceNumber: invoice.number, assumed: false, from: 'invoice',
          note: `Based on ${invoice.number}: ${formatMoney(kept)} paid${invoice.refundedCents ? ' after refunds' : ''}${membershipLines < lines ? ', membership part only' : ''}.`,
        }
      }
    }
  }

  const payerRef = await billingPayer(db, input.ownerId, membership.memberId)
  const payer = payerRef.viaHousehold ? await db.member.findFirst({ where: { id: payerRef.payerId, ownerId: input.ownerId }, select: { id: true, name: true } }) : membership.member
  const ownCredit = await creditAvailable(db, input.ownerId, membership.memberId)
  const payerCredit = payerRef.viaHousehold ? await creditAvailable(db, input.ownerId, payerRef.payerId) : { autoCents: 0 }
  const availableCreditCents = ownCredit.autoCents + payerCredit.autoCents

  const calc = input.effective === 'next_period'
    ? calculateScheduledChange({ at, tz, periodStart, periodEnd, newPriceCents: newPrice, newTaxRateBps, availableCreditCents })
    : calculateProration({
        tz, at, periodStart, paidFrom: window.start, periodEnd, oldPaidCents: window.paidCents, newPriceCents: newPrice, newTaxRateBps, sameCycle,
        newPeriodEnd: addInterval(at, plan.billingInterval, plan.intervalCount), inTrial, availableCreditCents,
      })

  const automatic = membership.paymentMethod === 'card' || membership.paymentMethod === 'ach'
  const pending = membership.pendingPlanId ? await db.membershipPlan.findFirst({ where: { id: membership.pendingPlanId, ownerId: input.ownerId }, select: { id: true, name: true } }) : null
  return {
    membershipId: membership.id,
    member: membership.member,
    from: summary(membership.plan, membership.priceCents),
    to: summary(plan, newPrice),
    effective: input.effective,
    allowed: !blocked,
    blocked,
    basis: { invoiceId: window.invoiceId, invoiceNumber: window.invoiceNumber, paidCents: window.paidCents, assumed: window.assumed, from: window.from, note: window.note },
    calc,
    payer: { id: payer?.id || membership.memberId, name: payer?.name || membership.member.name, viaHousehold: payerRef.viaHousehold },
    collection: {
      method: membership.paymentMethod, automatic,
      description: calc.amountDueNowCents === 0 ? 'Nothing to pay now.'
        : automatic ? `${formatMoney(calc.amountDueNowCents)} will be charged to ${payerRef.viaHousehold ? `${payer?.name}'s` : 'the'} saved ${membership.paymentMethod === 'ach' ? 'bank account' : 'card'} straight away.`
        : `An invoice for ${formatMoney(calc.amountDueNowCents)} will be raised to pay at the desk.`,
    },
    currentPeriodEnd: membership.currentPeriodEnd?.toISOString() || null,
    scheduled: pending ? { planId: pending.id, name: pending.name } : null,
  }
}

export const previewPlanChange = (input: ComputeInput) => computePlanChange(prisma, input)

export interface ApplyInput extends ComputeInput {
  /** What the person confirming was shown. If the real figures differ by now, nothing happens and they are shown the new ones. */
  expected: { fromPlanId: string; amountDueNowCents: number; creditCents: number }
  idempotencyKey?: string | null
  actor?: ActorRef
}

export interface PlanChangeResult {
  planChangeId: string
  membershipId: string
  memberId: string
  status: 'applied' | 'scheduled'
  effective: Effective
  fromPlan: string
  toPlan: string
  invoiceId: string | null
  invoiceNumber: string | null
  creditId: string | null
  amountDueNowCents: number
  creditCents: number
  accountCreditAppliedCents: number
  nextBillingDate: string
  nextBillingCents: number
  /** Charge the invoice to the saved card or bank account after commit. */
  collect: boolean
  calc: Proration
  replayed?: boolean
}

/**
 * Carry out a plan change. Everything that changes (the membership, the invoice, the credit, the
 * record of the change) is written in one transaction under a lock on the membership. The card, if
 * there is one to charge, is charged by the caller afterwards: the processor is never called inside
 * a database transaction.
 */
export async function applyPlanChange(input: ApplyInput): Promise<PlanChangeResult> {
  // A member moving themselves onto a plan signs that plan's agreement first, if one is required.
  if (input.source === 'member') {
    const owned = await prisma.membership.findFirst({ where: { id: input.membershipId, ownerId: input.ownerId }, select: { memberId: true } })
    if (owned) {
      const { requireDocuments } = await import('./documents')
      await requireDocuments(input.ownerId, owned.memberId, { trigger: 'membership_purchase', planId: input.planId })
    }
  }
  const actor = input.actor || SYSTEM
  const hash = requestHash({ m: input.membershipId, p: input.planId, e: input.effective, x: input.expected })
  return prisma.$transaction(async (db) => {
    const owned = await db.membership.findFirst({ where: { id: input.membershipId, ownerId: input.ownerId }, select: { id: true } })
    if (!owned) throw notFound('Membership')
    await lockRow(db, 'Membership', owned.id)
    const { result, replayed } = await withIdempotency(db, { ownerId: input.ownerId, scope: 'plan_change', key: input.idempotencyKey, hash }, async () => {
      const preview = await computePlanChange(db, input)
      if (preview.from.id !== input.expected.fromPlanId) {
        throw new ApiError(409, `This membership has already been changed to ${preview.from.name}. Review it before changing it again.`, 'plan_already_changed', { preview })
      }
      if (!preview.allowed) throw new ApiError(409, preview.blocked!.message, preview.blocked!.code)
      const calc = preview.calc
      if (calc.amountDueNowCents !== input.expected.amountDueNowCents || calc.creditCents !== input.expected.creditCents) {
        throw new ApiError(409, 'The amounts have changed since you looked. Check the new figures and confirm again.', 'preview_changed', { preview })
      }
      const membership = await db.membership.findUniqueOrThrow({ where: { id: owned.id }, include: { plan: true } })
      const plan = await db.membershipPlan.findUniqueOrThrow({ where: { id: input.planId } })
      const settings = await getGymSettings(input.ownerId, db)
      const at = new Date(calc.effectiveAt)
      const base = {
        ownerId: input.ownerId, membershipId: membership.id, memberId: membership.memberId, fromPlanId: membership.planId, toPlanId: plan.id,
        effective: input.effective, source: input.source, calculation: { ...calc, basis: preview.basis, from: preview.from, to: preview.to, payerId: preview.payer.id, idempotencyKey: input.idempotencyKey || null } as unknown as Prisma.InputJsonValue,
        byId: actor.type === 'staff' || actor.type === 'owner' ? actor.id : null, byName: actor.name || null,
      }
      await db.planChange.updateMany({ where: { ownerId: input.ownerId, membershipId: membership.id, status: 'scheduled' }, data: { status: 'cancelled' } })

      if (input.effective === 'next_period') {
        await db.membership.update({ where: { id: membership.id }, data: { pendingPlanId: plan.id } })
        const change = await db.planChange.create({ data: { ...base, status: 'scheduled' } })
        await logActivity(db, {
          ownerId: input.ownerId, memberId: membership.memberId, type: 'membership_changed', actor,
          title: `Membership set to change from ${membership.plan.name} to ${plan.name}`,
          detail: `From ${formatDate(new Date(calc.nextBillingDate), settings.timezone)}: ${formatMoney(calc.nextBillingCents)} ${intervalLabel(plan)}. Nothing charged or credited now.`,
          metadata: { membershipId: membership.id, planChangeId: change.id, fromPlanId: membership.planId, toPlanId: plan.id },
        })
        await membershipEvent(db, input.ownerId, 'membership.updated', membership.id)
        return {
          planChangeId: change.id, membershipId: membership.id, memberId: membership.memberId, status: 'scheduled' as const, effective: input.effective, fromPlan: membership.plan.name, toPlan: plan.name,
          invoiceId: null, invoiceNumber: null, creditId: null, amountDueNowCents: 0, creditCents: 0, accountCreditAppliedCents: 0,
          nextBillingDate: calc.nextBillingDate, nextBillingCents: calc.nextBillingCents, collect: false, calc,
        }
      }

      const restart = calc.mode === 'restart_period'
      const periodEnd = new Date(calc.nextBillingDate)
      await db.membership.update({
        where: { id: membership.id },
        data: {
          planId: plan.id, priceCents: preview.to.priceCents, pendingPlanId: null,
          ...(restart && { currentPeriodStart: at, currentPeriodEnd: periodEnd, lastBilledAt: at }),
        },
      })

      // One invoice tells the whole story: the new plan for the time bought, less the unused part of the old one.
      let invoice = null
      if (calc.newChargeCents > 0) {
        const offset = Math.min(calc.oldUnusedCents, calc.newChargeCents)
        const days = `${calc.remainingDays} of ${calc.totalDays} days`
        const items: LineItem[] = [{
          description: restart
            ? `${plan.name} (${intervalLabel(plan)}) · ${formatDate(at, settings.timezone)} – ${formatDate(periodEnd, settings.timezone)}`
            : `${plan.name} · ${formatDate(at, settings.timezone)} – ${formatDate(periodEnd, settings.timezone)} (${days})`,
          type: 'membership', unitPriceCents: calc.newChargeBaseCents, planId: plan.id, taxRateBps: plan.taxRateBps || settings.defaultTaxRateBps,
        }]
        if (offset > 0) items.push({ description: `Unused time on ${membership.plan.name} (${days})`, type: 'credit', unitPriceCents: -offset, planId: membership.planId, taxRateBps: 0 })
        invoice = await createInvoice(db, {
          ownerId: input.ownerId, memberId: membership.memberId, membershipId: membership.id, items, dueDate: at,
          // A restarted period is the membership's new billing period; a prorated top-up belongs to the period already running.
          periodStart: restart ? at : null, periodEnd: restart ? periodEnd : null,
          notes: `Plan change from ${membership.plan.name} to ${plan.name}`, actor,
        })
        // The invoice and the preview are two readings of one calculation. If they ever disagree, stop.
        if (invoice.totalCents !== calc.dueBeforeCreditCents) throw new Error(`Plan change invoice total ${invoice.totalCents} does not match the calculation ${calc.dueBeforeCreditCents}`)
      }

      let credit = null
      if (calc.creditCents > 0) {
        credit = (await grantCredit(db, {
          ownerId: input.ownerId, memberId: preview.payer.id, amountCents: calc.creditCents, source: 'proration',
          reason: `Unused time on ${membership.plan.name} after moving ${preview.payer.id === membership.memberId ? '' : `${preview.member.name} `}to ${plan.name}`,
          membershipId: membership.id, sourceInvoiceId: invoice?.id || null, actor,
        })).credit
      }
      let applied = 0
      if (invoice && invoice.status === 'open') {
        applied = await applyCreditsToInvoice(db, { ownerId: input.ownerId, invoiceId: invoice.id, actor })
        if (applied !== calc.accountCreditAppliedCents) throw new Error(`Account credit applied ${applied} does not match the calculation ${calc.accountCreditAppliedCents}`)
        invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      }

      const change = await db.planChange.create({ data: { ...base, status: 'applied', appliedAt: at, invoiceId: invoice?.id || null, creditId: credit?.id || null } })
      await logActivity(db, {
        ownerId: input.ownerId, memberId: membership.memberId, type: 'membership_changed', actor,
        title: `Membership changed from ${membership.plan.name} to ${plan.name}`,
        detail: [
          calc.mode === 'trial' ? 'Still in the free trial: nothing charged' : calc.amountDueNowCents > 0 ? `${formatMoney(calc.amountDueNowCents)} due now` : calc.creditCents > 0 ? `${formatMoney(calc.creditCents)} credit` : 'Nothing to pay',
          applied > 0 ? `${formatMoney(applied)} account credit used` : null,
          `next bill ${formatMoney(calc.nextBillingCents)} on ${formatDate(periodEnd, settings.timezone)}`,
        ].filter(Boolean).join(' · '),
        metadata: { membershipId: membership.id, planChangeId: change.id, fromPlanId: membership.planId, toPlanId: plan.id, invoiceId: invoice?.id, creditId: credit?.id },
      })
      await membershipEvent(db, input.ownerId, 'membership.updated', membership.id)
      return {
        planChangeId: change.id, membershipId: membership.id, memberId: membership.memberId, status: 'applied' as const, effective: input.effective, fromPlan: membership.plan.name, toPlan: plan.name,
        invoiceId: invoice?.id || null, invoiceNumber: invoice?.number || null, creditId: credit?.id || null,
        amountDueNowCents: calc.amountDueNowCents, creditCents: calc.creditCents, accountCreditAppliedCents: applied,
        nextBillingDate: calc.nextBillingDate, nextBillingCents: calc.nextBillingCents,
        collect: !!invoice && invoice.status === 'open' && preview.collection.automatic, calc,
      }
    })
    return { ...(result as PlanChangeResult), replayed }
  }, { timeout: 20_000 })
}

/** Withdraw a change that was waiting for the next billing date. */
export async function cancelScheduledPlanChange(db: Db, input: { ownerId: string; membershipId: string; actor?: ActorRef }) {
  const owned = await db.membership.findFirst({ where: { id: input.membershipId, ownerId: input.ownerId }, select: { id: true } })
  if (!owned) throw notFound('Membership')
  await lockRow(db, 'Membership', owned.id)
  const membership = await db.membership.findUniqueOrThrow({ where: { id: owned.id }, include: { plan: true } })
  if (!membership.pendingPlanId) throw badRequest('No plan change is scheduled for this membership.', 'nothing_scheduled')
  await db.membership.update({ where: { id: membership.id }, data: { pendingPlanId: null } })
  await db.planChange.updateMany({ where: { ownerId: input.ownerId, membershipId: membership.id, status: 'scheduled' }, data: { status: 'cancelled' } })
  await logActivity(db, { ownerId: input.ownerId, memberId: membership.memberId, type: 'membership_changed', actor: input.actor, title: `Scheduled plan change withdrawn`, detail: `Staying on ${membership.plan.name}`, metadata: { membershipId: membership.id } })
  await membershipEvent(db, input.ownerId, 'membership.updated', membership.id)
  return membership
}

/** The plan changes made to a membership, newest first, each with the calculation that was agreed. */
export async function planChangeHistory(ownerId: string, membershipId: string) {
  const rows = await prisma.planChange.findMany({ where: { ownerId, membershipId }, orderBy: { createdAt: 'desc' }, take: 30 })
  const plans = await prisma.membershipPlan.findMany({ where: { ownerId, id: { in: rows.flatMap((r) => [r.fromPlanId, r.toPlanId]) } }, select: { id: true, name: true } })
  const name = (id: string) => plans.find((p) => p.id === id)?.name || 'Deleted plan'
  return rows.map((r) => ({ id: r.id, from: name(r.fromPlanId), to: name(r.toPlanId), effective: r.effective, status: r.status, source: r.source, byName: r.byName, at: r.createdAt, invoiceId: r.invoiceId, creditId: r.creditId, calc: r.calculation as unknown as Proration }))
}
