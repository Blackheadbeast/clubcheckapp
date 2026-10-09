import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { badRequest, handler } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { applyPlanChange, cancelScheduledPlanChange, planChangeHistory, previewPlanChange } from '@/lib/services/plan-change'
import { collectInvoice } from '@/lib/services/collections'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const effective = z.enum(['now', 'next_period'])

// GET /api/memberships/:id/plan-change?planId=&effective=now|next_period
// The exact financial effect of a change, before anything happens. Without planId: the history of changes.
export const GET = handler({ permission: 'memberships.manage' }, async ({ ownerId, params, query }) => {
  const planId = query.get('planId')
  if (!planId) return { history: await planChangeHistory(ownerId, params.id) }
  const when = effective.safeParse(query.get('effective') || 'now')
  if (!when.success || !z.string().uuid().safeParse(planId).success) throw badRequest('Choose a plan and when it should start.')
  return previewPlanChange({ ownerId, membershipId: params.id, planId, effective: when.data, source: 'staff' })
})

const applySchema = z.object({
  planId: z.string().uuid(),
  effective,
  // What the preview showed. The change only goes ahead if these are still the real figures.
  expected: z.object({ fromPlanId: z.string().uuid(), amountDueNowCents: z.number().int().min(0), creditCents: z.number().int().min(0) }),
  idempotencyKey: z.string().min(8).max(100),
})

// POST - confirm the change that was previewed
export const POST = handler({ permission: 'memberships.manage', write: true, body: applySchema, rateLimit: { key: 'plan-change', windowMs: 60_000, maxRequests: 30 } }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await applyPlanChange({ ownerId, membershipId: params.id, ...body, source: 'staff', actor })
  if (!result.replayed) {
    await audit('membership.change_plan', result.status === 'scheduled'
      ? `Scheduled a change from ${result.fromPlan} to ${result.toPlan}`
      : `Changed membership from ${result.fromPlan} to ${result.toPlan}${result.amountDueNowCents ? `, ${formatMoney(result.amountDueNowCents)} due` : ''}${result.creditCents ? `, ${formatMoney(result.creditCents)} credit` : ''}`, {
      entityType: 'membership', entityId: params.id,
      before: { plan: result.fromPlan }, after: { plan: result.toPlan, nextBillingDate: result.nextBillingDate, nextBillingCents: result.nextBillingCents },
      metadata: { memberId: result.memberId, planChangeId: result.planChangeId, effective: result.effective, invoiceId: result.invoiceId, creditId: result.creditId, amountDueNowCents: result.amountDueNowCents, creditCents: result.creditCents, accountCreditAppliedCents: result.accountCreditAppliedCents, idempotencyKey: body.idempotencyKey, calculation: result.calc },
    })
  }
  // The change is committed; now charge the saved card or bank account if that is how they pay.
  // Safe on a repeat: an invoice that is paid or already being collected is left alone.
  let charge = null
  if (result.collect && result.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId }, select: { status: true, attemptCount: true } })
    if (invoice?.status === 'open' && invoice.attemptCount === 0) {
      charge = await collectInvoice({ ownerId, invoiceId: result.invoiceId, actor }).catch((error) => ({ status: 'failed' as const, message: error instanceof Error ? error.message : 'The charge could not be attempted.' }))
    }
  }
  await flushOutbox(ownerId)
  const invoice = result.invoiceId ? await prisma.invoice.findUnique({ where: { id: result.invoiceId }, select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true } }) : null
  return { ...result, invoice, charge: charge && { status: charge.status, message: charge.message || null } }
})

// DELETE - withdraw a change that was waiting for the next billing date
export const DELETE = handler({ permission: 'memberships.manage', write: true }, async ({ ownerId, params, actor, audit }) => {
  const membership = await prisma.$transaction((db) => cancelScheduledPlanChange(db, { ownerId, membershipId: params.id, actor }))
  await audit('membership.change_plan_cancel', `Withdrew the scheduled plan change (staying on ${membership.plan.name})`, { entityType: 'membership', entityId: params.id, metadata: { memberId: membership.memberId } })
  return { cancelled: true }
})
