// Membership lifecycle: sell, bill, freeze, cancel, expire.
//
//   Lead -> Trial -> Active -> Past Due -> Frozen -> Cancelled -> Archived
//
// Member.status is derived from the member's memberships (syncMemberStatus) so
// the directory, check-in and booking rules all read one consistent value.

import type { Membership, MembershipPlan } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, conflict, notFound } from '@/lib/api'
import { addDays, addInterval, addMonths } from '@/lib/dates'
import { formatDate, formatMoney } from '@/lib/format'
import { getPaymentProvider } from '@/lib/payments/provider'
import { Db, ActorRef, SYSTEM, getGymSettings, logActivity, notify } from './core'
import { LineItem, PaymentMethod, createInvoice, quoteCoupon, recordFailedPayment, recordPayment } from './payments'

export const PLAN_TYPES = ['recurring', 'class_pack', 'drop_in', 'trial', 'free', 'pt_package'] as const
export type PlanType = (typeof PLAN_TYPES)[number]

/** Statuses in which a membership still "belongs" to the member. */
export const LIVE_STATUSES = ['trial', 'active', 'past_due', 'frozen']

const CREDIT_PLANS = ['class_pack', 'drop_in', 'pt_package']

export function isCreditPlan(plan: Pick<MembershipPlan, 'type' | 'credits'>) {
  return CREDIT_PLANS.includes(plan.type) || (plan.type === 'trial' && plan.credits !== null)
}

export function intervalLabel(plan: Pick<MembershipPlan, 'type' | 'billingInterval' | 'intervalCount'>): string {
  if (plan.type !== 'recurring') return 'one-time'
  const n = plan.intervalCount
  const unit = plan.billingInterval
  if (n === 1) return unit === 'week' ? 'weekly' : unit === 'year' ? 'annual' : 'monthly'
  return `every ${n} ${unit}s`
}

export function effectivePrice(priceCents: number, discountPercent: number) {
  return Math.max(0, Math.round((priceCents * (100 - discountPercent)) / 100))
}

/** Derive Member.status from memberships. Members with no memberships keep their manual status. */
export async function syncMemberStatus(db: Db, memberId: string) {
  const memberships = await db.membership.findMany({ where: { memberId }, select: { status: true } })
  if (memberships.length === 0) return
  const has = (s: string) => memberships.some((m) => m.status === s)
  const status = has('active')
    ? 'active'
    : has('trial')
      ? 'trial'
      : has('past_due')
        ? 'past_due'
        : has('frozen')
          ? 'frozen'
          : 'cancelled'
  await db.member.updateMany({ where: { id: memberId, status: { not: status } }, data: { status } })
}

export interface SellInput {
  ownerId: string
  memberId: string
  planId: string
  startDate?: Date
  paymentMethod: PaymentMethod
  discountPercent?: number
  couponCode?: string | null
  /** Take payment for the first invoice now (not valid for card: no processor is connected). */
  collectNow?: boolean
  skipTrial?: boolean
  locationId?: string | null
  actor?: ActorRef
}

export async function sellMembership(db: Db, input: SellInput) {
  const [member, plan, settings] = await Promise.all([
    db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } }),
    db.membershipPlan.findFirst({ where: { id: input.planId, ownerId: input.ownerId } }),
    getGymSettings(input.ownerId, db),
  ])
  if (!member) throw notFound('Member')
  if (!plan) throw notFound('Membership plan')
  if (member.archivedAt) throw badRequest('Restore this member from the archive before selling a membership.', 'member_archived')
  if (!plan.isActive) throw badRequest('This membership plan is no longer for sale.', 'plan_inactive')
  if (input.paymentMethod === 'account_credit') throw badRequest('Choose how renewals will be paid, then pay the first invoice with credit.')

  if (plan.type === 'recurring' || plan.type === 'free') {
    const existing = await db.membership.findFirst({
      where: { memberId: member.id, planId: plan.id, status: { in: LIVE_STATUSES } },
    })
    if (existing) throw conflict(`${member.name} already has the ${plan.name} membership.`, 'duplicate_membership')
  }

  const actor = input.actor || SYSTEM
  const start = input.startDate || new Date()
  const discountPercent = Math.min(100, Math.max(0, input.discountPercent || 0))
  const price = effectivePrice(plan.priceCents, discountPercent)
  const taxRateBps = plan.taxRateBps || settings.defaultTaxRateBps
  const inTrial = plan.type === 'recurring' && plan.trialDays > 0 && !input.skipTrial

  const data: Parameters<typeof db.membership.create>[0]['data'] = {
    ownerId: input.ownerId,
    memberId: member.id,
    planId: plan.id,
    startDate: start,
    priceCents: price,
    discountPercent,
    paymentMethod: input.paymentMethod,
    autoRenew: plan.type === 'recurring' ? plan.autoRenew : false,
    status: 'active',
  }
  const items: LineItem[] = []

  if (plan.type === 'recurring') {
    if (inTrial) {
      data.status = 'trial'
      data.trialEndsAt = addDays(start, plan.trialDays)
      data.currentPeriodStart = start
      data.currentPeriodEnd = data.trialEndsAt
    } else {
      data.currentPeriodStart = start
      data.currentPeriodEnd = addInterval(start, plan.billingInterval, plan.intervalCount)
      items.push({
        description: `${plan.name} (${intervalLabel(plan)}) · ${formatDate(start, settings.timezone)} – ${formatDate(data.currentPeriodEnd as Date, settings.timezone)}`,
        type: 'membership',
        unitPriceCents: price,
        planId: plan.id,
        taxRateBps,
      })
    }
    if (plan.contractMonths > 0) data.contractEndsAt = addMonths(start, plan.contractMonths)
    if (plan.enrollmentFeeCents > 0) {
      items.push({ description: 'Enrollment fee', type: 'enrollment_fee', unitPriceCents: plan.enrollmentFeeCents, planId: plan.id, taxRateBps })
    }
  } else if (plan.type === 'free') {
    // Nothing to bill
  } else {
    if (plan.type === 'trial') data.status = 'trial'
    const days = plan.expiresAfterDays || (plan.type === 'trial' ? plan.trialDays || 7 : null)
    if (days) data.endDate = addDays(start, days)
    if (isCreditPlan(plan)) data.creditsRemaining = plan.credits ?? 1
    if (price > 0) {
      items.push({
        description: plan.credits ? `${plan.name} · ${plan.credits} ${plan.credits === 1 ? 'session' : 'sessions'}` : plan.name,
        type: plan.type === 'trial' ? 'membership' : 'class_pack',
        unitPriceCents: price,
        planId: plan.id,
        taxRateBps,
      })
    }
  }

  const membership = await db.membership.create({ data })

  let invoice = null
  if (items.length > 0) {
    const subtotal = items.reduce((sum, i) => sum + i.unitPriceCents, 0)
    const coupon = await quoteCoupon(db, input.ownerId, input.couponCode, 'memberships', subtotal)
    invoice = await createInvoice(db, {
      ownerId: input.ownerId,
      memberId: member.id,
      membershipId: membership.id,
      items,
      discountCents: coupon?.discountCents,
      couponCode: coupon?.code,
      dueDate: start,
      periodStart: inTrial ? null : (data.currentPeriodStart as Date | undefined) || null,
      periodEnd: inTrial ? null : (data.currentPeriodEnd as Date | undefined) || null,
      actor,
    })
    if (plan.type === 'recurring' && !inTrial) {
      await db.membership.update({ where: { id: membership.id }, data: { lastBilledAt: new Date() } })
    }
    if (input.collectNow && invoice.status === 'open') {
      if (input.paymentMethod === 'card') {
        throw badRequest('No card processor is connected. Take the card on your terminal and record it as "other", or leave the invoice open.', 'card_unavailable')
      }
      await recordPayment(db, {
        ownerId: input.ownerId,
        invoiceId: invoice.id,
        method: input.paymentMethod,
        locationId: input.locationId,
        actor,
      })
    }
  } else if (input.couponCode) {
    throw badRequest('There is nothing to discount on this membership yet.')
  }

  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: member.id,
    type: 'membership_purchased',
    title: inTrial ? `Started ${plan.trialDays}-day trial of ${plan.name}` : `Purchased ${plan.name}`,
    detail: price > 0 ? `${formatMoney(price)} ${intervalLabel(plan)}` : 'Free',
    metadata: { membershipId: membership.id, planId: plan.id, invoiceId: invoice?.id },
    actor,
  })
  await syncMemberStatus(db, member.id)
  if ((await db.membership.count({ where: { memberId: member.id } })) === 1) {
    const { fireTrigger } = await import('./automations')
    await fireTrigger(db, input.ownerId, 'member_joined', { memberId: member.id, dedupeKey: member.id, context: { membership_name: plan.name } })
  }
  return { membership, invoice, plan }
}

async function loadMembership(db: Db, ownerId: string, id: string) {
  const membership = await db.membership.findFirst({ where: { id, ownerId }, include: { plan: true, member: { select: { name: true } } } })
  if (!membership) throw notFound('Membership')
  return membership
}

export async function freezeMembership(
  db: Db,
  input: { ownerId: string; membershipId: string; until?: Date | null; reason?: string | null; actor?: ActorRef }
) {
  const membership = await loadMembership(db, input.ownerId, input.membershipId)
  if (!['active', 'trial'].includes(membership.status)) {
    throw badRequest(`Only active memberships can be frozen (this one is ${membership.status.replace('_', ' ')}).`, 'not_freezable')
  }
  if (!membership.plan.freezeAllowed) throw badRequest(`${membership.plan.name} does not allow freezes.`, 'freeze_not_allowed')
  const now = new Date()
  if (input.until) {
    if (input.until <= now) throw badRequest('The freeze end date must be in the future.')
    const days = Math.ceil((input.until.getTime() - now.getTime()) / 86_400_000)
    if (days > membership.plan.maxFreezeDays) {
      throw badRequest(`${membership.plan.name} can be frozen for at most ${membership.plan.maxFreezeDays} days.`, 'freeze_too_long')
    }
  }
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { status: 'frozen', frozenAt: now, freezeEndsAt: input.until || addDays(now, membership.plan.maxFreezeDays) },
  })
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: membership.memberId,
    type: 'membership_frozen',
    title: `${membership.plan.name} frozen`,
    detail: [input.until ? `Until ${formatDate(input.until)}` : null, input.reason].filter(Boolean).join(' · ') || undefined,
    metadata: { membershipId: membership.id },
    actor: input.actor,
  })
  await syncMemberStatus(db, membership.memberId)
  return updated
}

export async function unfreezeMembership(db: Db, input: { ownerId: string; membershipId: string; actor?: ActorRef }) {
  const membership = await loadMembership(db, input.ownerId, input.membershipId)
  if (membership.status !== 'frozen') throw badRequest('This membership is not frozen.', 'not_frozen')
  const now = new Date()
  // Time spent frozen is not billed: push the billing date and any end dates out by the same amount.
  const frozenMs = membership.frozenAt ? Math.max(0, now.getTime() - membership.frozenAt.getTime()) : 0
  const shift = (d: Date | null) => (d ? new Date(d.getTime() + frozenMs) : d)
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: {
      status: membership.trialEndsAt && shift(membership.trialEndsAt)! > now ? 'trial' : 'active',
      frozenAt: null,
      freezeEndsAt: null,
      currentPeriodEnd: shift(membership.currentPeriodEnd),
      trialEndsAt: shift(membership.trialEndsAt),
      endDate: shift(membership.endDate),
      contractEndsAt: shift(membership.contractEndsAt),
    },
  })
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: membership.memberId,
    type: 'membership_unfrozen',
    title: `${membership.plan.name} resumed`,
    metadata: { membershipId: membership.id },
    actor: input.actor,
  })
  await syncMemberStatus(db, membership.memberId)
  return updated
}

export async function cancelMembership(
  db: Db,
  input: {
    ownerId: string
    membershipId: string
    when: 'now' | 'period_end'
    reason?: string | null
    /** Skip the notice period and contract term checks. */
    override?: boolean
    actor?: ActorRef
  }
) {
  const membership = await loadMembership(db, input.ownerId, input.membershipId)
  if (!LIVE_STATUSES.includes(membership.status)) throw badRequest('This membership has already ended.', 'already_ended')
  const now = new Date()
  const plan = membership.plan

  let effective = input.when === 'period_end' && membership.currentPeriodEnd && membership.currentPeriodEnd > now ? membership.currentPeriodEnd : now
  if (!input.override) {
    const earliest = addDays(now, plan.cancellationNoticeDays)
    if (plan.cancellationNoticeDays > 0 && effective < earliest) effective = earliest
    if (membership.contractEndsAt && membership.contractEndsAt > effective) {
      throw new ApiError(
        409,
        `${membership.member.name} is under contract until ${formatDate(membership.contractEndsAt)}. Confirm the override to cancel early.`,
        'under_contract',
        { contractEndsAt: membership.contractEndsAt }
      )
    }
  }

  if (effective > now) {
    const updated = await db.membership.update({
      where: { id: membership.id },
      data: { cancelAt: effective, autoRenew: false, cancelReason: input.reason || null },
    })
    await logActivity(db, {
      ownerId: input.ownerId,
      memberId: membership.memberId,
      type: 'membership_cancel_scheduled',
      title: `${plan.name} set to cancel on ${formatDate(effective)}`,
      detail: input.reason || undefined,
      metadata: { membershipId: membership.id },
      actor: input.actor,
    })
    return { membership: updated, effective, immediate: false }
  }

  const updated = await endMembership(db, membership, 'cancelled', input.reason || null, input.actor)
  return { membership: updated, effective: now, immediate: true }
}

/** Undo a scheduled cancellation. */
export async function resumeMembership(db: Db, input: { ownerId: string; membershipId: string; actor?: ActorRef }) {
  const membership = await loadMembership(db, input.ownerId, input.membershipId)
  if (!membership.cancelAt || !LIVE_STATUSES.includes(membership.status)) {
    throw badRequest('This membership is not scheduled to cancel.', 'not_scheduled')
  }
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { cancelAt: null, cancelReason: null, autoRenew: membership.plan.autoRenew },
  })
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: membership.memberId,
    type: 'membership_resumed',
    title: `Cancellation of ${membership.plan.name} withdrawn`,
    metadata: { membershipId: membership.id },
    actor: input.actor,
  })
  return updated
}

async function endMembership(
  db: Db,
  membership: Membership & { plan: MembershipPlan },
  status: 'cancelled' | 'expired',
  reason: string | null,
  actor?: ActorRef
) {
  const now = new Date()
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: {
      status,
      autoRenew: false,
      endDate: membership.endDate && membership.endDate < now ? membership.endDate : now,
      ...(status === 'cancelled' && { cancelledAt: now, cancelReason: reason ?? membership.cancelReason }),
      cancelAt: null,
    },
  })
  await logActivity(db, {
    ownerId: membership.ownerId,
    memberId: membership.memberId,
    type: status === 'cancelled' ? 'membership_cancelled' : 'membership_expired',
    title: `${membership.plan.name} ${status}`,
    detail: reason || undefined,
    metadata: { membershipId: membership.id },
    actor,
  })
  // Upcoming bookings made on this membership no longer have anything to stand on.
  const { releaseBookingsForMembership } = await import('./bookings')
  await releaseBookingsForMembership(db, membership.ownerId, membership.id)
  await syncMemberStatus(db, membership.memberId)
  return updated
}

/** Move to another recurring plan. The new price applies from the next billing date; no proration. */
export async function changePlan(db: Db, input: { ownerId: string; membershipId: string; planId: string; actor?: ActorRef }) {
  const membership = await loadMembership(db, input.ownerId, input.membershipId)
  if (!LIVE_STATUSES.includes(membership.status)) throw badRequest('This membership has ended.', 'already_ended')
  if (membership.plan.type !== 'recurring') throw badRequest('Only recurring memberships can change plan.', 'not_recurring')
  const plan = await db.membershipPlan.findFirst({ where: { id: input.planId, ownerId: input.ownerId, isActive: true } })
  if (!plan) throw notFound('Membership plan')
  if (plan.type !== 'recurring') throw badRequest('Choose a recurring plan to switch to.', 'not_recurring')
  if (plan.id === membership.planId) throw badRequest('The member is already on that plan.')
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { planId: plan.id, priceCents: effectivePrice(plan.priceCents, membership.discountPercent) },
  })
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: membership.memberId,
    type: 'membership_changed',
    title: `Membership changed from ${membership.plan.name} to ${plan.name}`,
    detail: `${formatMoney(updated.priceCents)} ${intervalLabel(plan)} from the next billing date`,
    metadata: { membershipId: membership.id, fromPlanId: membership.planId, toPlanId: plan.id },
    actor: input.actor,
  })
  return { membership: updated, from: membership.plan, to: plan }
}

/**
 * Invoice one billing period. Safe to call twice: Invoice has a unique
 * (membershipId, periodStart) so a retry or overlapping cron run cannot double-bill.
 */
async function billPeriod(db: Db, membership: Membership & { plan: MembershipPlan }, periodStart: Date, tz: string, taxFallbackBps: number) {
  const existing = await db.invoice.findFirst({ where: { membershipId: membership.id, periodStart } })
  const periodEnd = addInterval(periodStart, membership.plan.billingInterval, membership.plan.intervalCount)
  if (existing) return { invoice: existing, periodEnd, created: false }
  const invoice = await createInvoice(db, {
    ownerId: membership.ownerId,
    memberId: membership.memberId,
    membershipId: membership.id,
    items: [
      {
        description: `${membership.plan.name} (${intervalLabel(membership.plan)}) · ${formatDate(periodStart, tz)} – ${formatDate(periodEnd, tz)}`,
        type: 'membership',
        unitPriceCents: membership.priceCents,
        planId: membership.planId,
        taxRateBps: membership.plan.taxRateBps || taxFallbackBps,
      },
    ],
    dueDate: periodStart,
    periodStart,
    periodEnd,
  })
  return { invoice, periodEnd, created: true }
}

export interface BillingRunSummary {
  invoicesCreated: number
  paymentsCollected: number
  paymentsFailed: number
  trialsConverted: number
  markedPastDue: number
  cancelled: number
  expired: number
  unfrozen: number
  errors: string[]
}

/**
 * Advance every membership on an account to `now`: convert finished trials,
 * raise renewal invoices, attempt collection, apply scheduled cancellations,
 * end freezes and expire packs. Each membership runs in its own transaction so
 * one bad record cannot block the rest.
 */
export async function runMembershipBilling(ownerId: string, now = new Date()): Promise<BillingRunSummary> {
  const summary: BillingRunSummary = {
    invoicesCreated: 0, paymentsCollected: 0, paymentsFailed: 0, trialsConverted: 0,
    markedPastDue: 0, cancelled: 0, expired: 0, unfrozen: 0, errors: [],
  }
  const settings = await getGymSettings(ownerId)
  const provider = getPaymentProvider(ownerId)
  const candidates = await prisma.membership.findMany({
    where: { ownerId, status: { in: LIVE_STATUSES } },
    select: { id: true },
  })

  for (const { id } of candidates) {
    try {
      await prisma.$transaction(async (db) => {
        let m: (Membership & { plan: MembershipPlan }) | null = await db.membership.findUnique({ where: { id }, include: { plan: true } })
        if (!m || !LIVE_STATUSES.includes(m.status)) return

        if (m.status === 'frozen') {
          if (m.freezeEndsAt && m.freezeEndsAt <= now) {
            await unfreezeMembership(db, { ownerId, membershipId: m.id })
            summary.unfrozen++
          }
          return
        }

        if (m.cancelAt && m.cancelAt <= now) {
          await endMembership(db, m, 'cancelled', m.cancelReason)
          summary.cancelled++
          return
        }

        if (m.plan.type !== 'recurring') {
          const usedUp = m.creditsRemaining === 0 && (await db.booking.count({
            where: { membershipId: m.id, status: { in: ['booked', 'offered'] }, session: { startsAt: { gt: now } } },
          })) === 0
          if ((m.endDate && m.endDate <= now) || usedUp) {
            await endMembership(db, m, 'expired', usedUp ? 'All sessions used' : null)
            summary.expired++
          }
          return
        }

        // Recurring: bill every period that has started, catching up at most 3 at a time.
        for (let i = 0; i < 3 && m.currentPeriodEnd && m.currentPeriodEnd <= now; i++) {
          if (!m.autoRenew && m.status !== 'trial') {
            await endMembership(db, m, 'expired', 'Not set to renew')
            summary.expired++
            return
          }
          const periodStart: Date = m.currentPeriodEnd
          const wasTrial: boolean = m.status === 'trial'
          const { invoice, periodEnd, created } = await billPeriod(db, m, periodStart, settings.timezone, settings.defaultTaxRateBps)
          m = await db.membership.update({
            where: { id: m.id },
            data: {
              status: wasTrial ? 'active' : m.status,
              trialEndsAt: wasTrial ? null : m.trialEndsAt,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              lastBilledAt: now,
            },
            include: { plan: true },
          })
          if (created) summary.invoicesCreated++
          if (wasTrial) {
            summary.trialsConverted++
            await logActivity(db, {
              ownerId, memberId: m.memberId, type: 'trial_converted',
              title: `Trial ended, ${m.plan.name} is now active`, metadata: { membershipId: m.id },
            })
            await syncMemberStatus(db, m.memberId)
          }
          if (created && invoice.status === 'open' && m.paymentMethod === 'card' && provider.canAutoCharge) {
            const result = await provider.charge({
              ownerId, invoiceId: invoice.id, memberId: m.memberId, amountCents: invoice.totalCents,
              currency: settings.currency, description: `${m.plan.name} ${invoice.number}`,
            })
            if (result.status === 'succeeded') {
              await recordPayment(db, { ownerId, invoiceId: invoice.id, method: 'card', provider: provider.name, providerReference: result.reference, cardLast4: result.cardLast4 })
              summary.paymentsCollected++
            } else if (result.status === 'failed') {
              await recordFailedPayment(db, { ownerId, invoiceId: invoice.id, method: 'card', failureReason: result.failureReason })
              summary.paymentsFailed++
              m = await db.membership.findUniqueOrThrow({ where: { id: m.id }, include: { plan: true } })
            }
          }
        }

        // Unpaid past the grace period -> past due.
        if (m.status === 'active') {
          const cutoff = addDays(now, -settings.pastDueGraceDays)
          const overdue = await db.invoice.findFirst({
            where: { membershipId: m.id, status: 'open', dueDate: { lt: cutoff } },
            orderBy: { dueDate: 'asc' },
          })
          if (overdue) {
            await db.membership.update({ where: { id: m.id }, data: { status: 'past_due' } })
            const member = await db.member.findUnique({ where: { id: m.memberId }, select: { name: true } })
            await logActivity(db, {
              ownerId, memberId: m.memberId, type: 'membership_past_due',
              title: `${m.plan.name} is past due`,
              detail: `${overdue.number} for ${formatMoney(overdue.totalCents - overdue.amountPaidCents)} was due ${formatDate(overdue.dueDate, settings.timezone)}`,
              metadata: { membershipId: m.id, invoiceId: overdue.id },
            })
            await notify(db, {
              ownerId, type: 'past_due', title: `${member?.name || 'A member'} is past due`,
              body: `${overdue.number} is unpaid.`, href: `/members/${m.memberId}?tab=billing`,
            })
            await syncMemberStatus(db, m.memberId)
            const { fireTrigger } = await import('./automations')
            await fireTrigger(db, ownerId, 'payment_failed', {
              memberId: m.memberId, dedupeKey: `past_due:${overdue.id}`,
              context: { amount: formatMoney(overdue.totalCents - overdue.amountPaidCents), membership_name: m.plan.name },
            })
            summary.markedPastDue++
          }
        }
      }, { timeout: 20_000 })
    } catch (error) {
      summary.errors.push(`membership ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return summary
}
