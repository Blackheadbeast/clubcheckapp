// A member buying a plan for themselves with the card or bank account they have saved.
//
// It is the same sale staff make (sellMembership) and the same charge (collectInvoice): nothing
// here is a second payment path. What is bought only stands if the charge goes through; a decline
// undoes the sale rather than leaving sessions or a membership behind an unpaid invoice.

import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { getPaymentProvider } from '@/lib/payments/provider'
import type { ActorRef } from './core'
import { sellMembership, type PlanType } from './memberships'
import { collectInvoice } from './collections'
import { voidInvoice } from './payments'
import { flushOutbox } from './automations'

export async function buyPlanWithSavedMethod(input: { ownerId: string; memberId: string; planId: string; types: readonly PlanType[]; actor?: ActorRef; what?: string }) {
  const { ownerId, memberId } = input
  const what = input.what || 'plan'
  const plan = await prisma.membershipPlan.findFirst({ where: { id: input.planId, ownerId, isActive: true, isPublic: true, type: { in: [...input.types] } } })
  if (!plan) throw notFound(what === 'package' ? 'Package' : 'Plan')
  // Something already held is not sold twice: a second trial, or a second copy of a live membership.
  const held = await prisma.membership.findMany({ where: { ownerId, memberId, planId: plan.id }, select: { status: true } })
  if (['trial', 'free'].includes(plan.type) && held.length > 0) throw new ApiError(409, `You have already used ${plan.name}.`, 'already_used')
  if (plan.type === 'recurring' && held.some((m) => ['trial', 'active', 'past_due', 'frozen'].includes(m.status))) throw new ApiError(409, `You already have ${plan.name}.`, 'already_held')

  // A plan that costs nothing needs no card. One with a free trial that renews for money still does.
  const free = plan.priceCents + plan.enrollmentFeeCents === 0
  // The agreement for this plan, if the gym requires one, is signed before anything is sold or charged.
  const { requireDocuments } = await import('./documents')
  await requireDocuments(ownerId, memberId, { trigger: 'membership_purchase', planId: plan.id })
  if (!free) {
    const provider = await getPaymentProvider(ownerId)
    if (!provider.canAutoCharge) throw new ApiError(409, what === 'package' ? 'Packages are sold at the front desk here. Ask the team and they will set it up.' : 'This is sold at the front desk here. Ask the team and they will set it up.', 'payments_not_connected')
    const method = await prisma.paymentMethod.count({ where: { ownerId, memberId } })
    if (!method) throw new ApiError(409, what === 'package' ? 'Add a card or bank account under Membership first.' : 'Add a card or bank account first.', 'no_payment_method')
  }

  const sale = await prisma.$transaction((db) => sellMembership(db, { ownerId, memberId, planId: plan.id, paymentMethod: 'card', actor: input.actor }), { timeout: 15_000 })
  let charge: { status: string; message?: string } = { status: 'succeeded' }
  if (sale.invoice && sale.invoice.status === 'open') {
    charge = await collectInvoice({ ownerId, invoiceId: sale.invoice.id, actor: input.actor }).catch((error) => ({ status: 'failed', message: error instanceof Error ? error.message : 'The payment could not be attempted.' }))
  }
  if (charge.status !== 'succeeded' && charge.status !== 'processing') {
    await prisma.$transaction(async (db) => {
      await db.membership.update({ where: { id: sale.membership.id }, data: { status: 'cancelled', creditsRemaining: 0, cancelledAt: new Date(), cancelReason: 'Payment declined' } })
      if (sale.invoice) await voidInvoice(db, ownerId, sale.invoice.id).catch(() => {})
      const { syncMemberStatus } = await import('./memberships')
      await syncMemberStatus(db, memberId)
    })
    throw new ApiError(402, `${charge.message || 'Your payment was declined.'} The ${what} was not added.`, 'payment_failed')
  }
  await flushOutbox(ownerId)
  const membership = await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id }, select: { id: true, status: true, creditsRemaining: true, endDate: true } })
  return { membership, plan, payment: charge.status, invoiceId: sale.invoice?.id || null }
}
