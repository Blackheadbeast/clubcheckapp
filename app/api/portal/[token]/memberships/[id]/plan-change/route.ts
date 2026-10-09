import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { getGymSettings } from '@/lib/services/core'
import { applyPlanChange, previewPlanChange } from '@/lib/services/plan-change'
import { collectInvoice } from '@/lib/services/collections'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const effective = z.enum(['now', 'next_period'])
const off = () => new ApiError(403, 'Changing membership is handled at the front desk. Please speak to the team.', 'self_service_disabled')

/** A member may only change a membership that is their own, and only if the gym lets members do it. */
async function own(ownerId: string, memberId: string, membershipId: string) {
  const settings = await getGymSettings(ownerId)
  if (!settings.memberSelfChangePlan) throw off()
  const owned = await prisma.membership.findFirst({ where: { id: membershipId, ownerId, memberId }, select: { id: true } })
  if (!owned) throw notFound('Membership')
  return owned.id
}

// GET ?planId=&effective= - what the change would cost or credit, worked out by the same calculation staff see
export const GET = portalHandler({}, async ({ member, ownerId, params, req }) => {
  const query = req.nextUrl.searchParams
  const membershipId = await own(ownerId, member.id, params.id)
  const planId = query.get('planId')
  const when = effective.safeParse(query.get('effective') || 'now')
  if (!planId || !z.string().uuid().safeParse(planId).success || !when.success) throw badRequest('Choose a plan.')
  const preview = await previewPlanChange({ ownerId, membershipId, planId, effective: when.data, source: 'member' })
  // The member sees their own figures; not which invoice they came from or who else is in the household.
  return {
    from: preview.from, to: preview.to, effective: preview.effective, allowed: preview.allowed, blocked: preview.blocked, calc: preview.calc,
    collection: preview.collection, billedTo: preview.payer.viaHousehold ? preview.payer.name.split(/\s+/)[0] : null, currentPeriodEnd: preview.currentPeriodEnd,
  }
})

const schema = z.object({
  planId: z.string().uuid(),
  effective,
  expected: z.object({ fromPlanId: z.string().uuid(), amountDueNowCents: z.number().int().min(0), creditCents: z.number().int().min(0) }),
  idempotencyKey: z.string().min(8).max(100),
})

// POST - the member confirms the change they were shown
export const POST = portalHandler({ write: true, body: schema }, async ({ member, ownerId, params, body, actor }) => {
  const membershipId = await own(ownerId, member.id, params.id)
  const result = await applyPlanChange({ ownerId, membershipId, ...body, source: 'member', actor }).catch((error) => {
    // The staff-side detail (which invoice, who pays) is not the member's to see: they just look again.
    if (error instanceof ApiError) throw new ApiError(error.status, error.message, error.code)
    throw error
  })
  let charge = null
  if (result.collect && result.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId }, select: { status: true, attemptCount: true } })
    if (invoice?.status === 'open' && invoice.attemptCount === 0) {
      charge = await collectInvoice({ ownerId, invoiceId: result.invoiceId, actor }).catch((error) => ({ status: 'failed' as const, message: error instanceof Error ? error.message : 'The charge could not be attempted.' }))
    }
  }
  await flushOutbox(ownerId)
  return {
    status: result.status, effective: result.effective, plan: result.toPlan, amountDueNowCents: result.amountDueNowCents, creditCents: result.creditCents,
    nextBillingDate: result.nextBillingDate, nextBillingCents: result.nextBillingCents, invoiceNumber: result.invoiceNumber,
    charge: charge && { status: charge.status, message: charge.message || null },
  }
})
