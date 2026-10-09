import { z } from 'zod'
import { portalHandler } from '@/lib/portal'
import { buyPlanWithSavedMethod } from '@/lib/services/purchases'

export const dynamic = 'force-dynamic'

// POST { planId } - the member buys a session package with their saved payment method.
// It is the same sale staff make (sellMembership) and the same charge (collectInvoice):
// nothing here is a second payment path. The sessions only stand if the charge goes through.
export const POST = portalHandler({ write: true, body: z.object({ planId: z.string().uuid() }) }, async ({ member, ownerId, body, actor }) => {
  const { membership, plan, payment } = await buyPlanWithSavedMethod({ ownerId, memberId: member.id, planId: body.planId, types: ['pt_package'], actor, what: 'package' })
  return { membershipId: membership.id, name: plan.name, sessionsRemaining: membership.creditsRemaining ?? 0, expiresAt: membership.endDate, payment }
})
