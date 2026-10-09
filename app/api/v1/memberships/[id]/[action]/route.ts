import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { membershipOut } from '@/lib/public-api/serialize'
import { dateInput } from '@/lib/schemas'
import { cancelMembership, freezeMembership, resumeMembership, unfreezeMembership } from '@/lib/services/memberships'
import { applyPlanChange, previewPlanChange } from '@/lib/services/plan-change'
import { collectInvoice } from '@/lib/services/collections'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

// One body for the five actions; each reads the fields it needs and ignores the rest.
const schema = z.object({
  /** freeze: when it thaws by itself. Omitted: until someone unfreezes it. */
  until: dateInput.nullish(),
  reason: z.string().trim().max(300).nullish(),
  /** cancel */
  when: z.enum(['now', 'period_end']).optional(),
  /** change-plan */
  planId: z.string().uuid().optional(),
  effective: z.enum(['now', 'next_period']).optional(),
  /** change-plan: work out the figures and change nothing. */
  preview: z.boolean().optional(),
}).default({})

const ACTIONS = ['freeze', 'unfreeze', 'cancel', 'resume', 'change-plan']

// POST /api/v1/memberships/:id/freeze | unfreeze | cancel | resume | change-plan
export const POST = publicHandler({ scope: 'memberships:write', write: true, body: schema, idempotent: true }, async ({ ownerId, params, body, actor, audit, req }) => {
  const membershipId = params.id
  const action = params.action
  if (!ACTIONS.includes(action)) throw new ApiError(404, `No such endpoint: POST ${req.nextUrl.pathname}`, 'not_found')
  const shown = async () => membershipOut(await prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { plan: true } }))
  if (!(await prisma.membership.findFirst({ where: { id: membershipId, ownerId }, select: { id: true } }))) throw notFound('Membership')

  if (action === 'change-plan') {
    if (!body.planId) throw new ApiError(400, 'planId: choose the plan to change to.', 'validation_error')
    const input = { ownerId, membershipId, planId: body.planId, effective: body.effective || 'next_period', source: 'staff' as const }
    const preview = await previewPlanChange(input)
    if (body.preview) return { object: 'plan_change_preview', ...preview }
    if (preview.blocked) throw new ApiError(409, preview.blocked.message, preview.blocked.code)
    // The idempotency key is handled by the API layer; the figures just worked out are what gets applied.
    const result = await applyPlanChange({ ...input, expected: { fromPlanId: preview.from.id, amountDueNowCents: preview.calc.amountDueNowCents, creditCents: preview.calc.creditCents }, actor })
    await audit('membership.change_plan', `${result.status === 'scheduled' ? 'Scheduled a change' : 'Changed membership'} from ${result.fromPlan} to ${result.toPlan} through the API`, { entityType: 'membership', entityId: membershipId, metadata: { memberId: result.memberId, planChangeId: result.planChangeId, invoiceId: result.invoiceId } })
    let charge = null
    if (result.collect && result.invoiceId) {
      const invoice = await prisma.invoice.findUnique({ where: { id: result.invoiceId }, select: { status: true, attemptCount: true } })
      if (invoice?.status === 'open' && invoice.attemptCount === 0) charge = await collectInvoice({ ownerId, invoiceId: result.invoiceId, actor }).catch((error) => ({ status: 'failed' as const, message: error instanceof Error ? error.message : 'The charge could not be attempted.' }))
    }
    await flushOutbox(ownerId)
    return { ...(await shown()), planChange: { id: result.planChangeId, status: result.status, effective: result.effective, invoiceId: result.invoiceId, amountDueNowCents: result.amountDueNowCents, creditCents: result.creditCents, nextBillingDate: result.nextBillingDate, nextBillingCents: result.nextBillingCents, charge: charge && { status: charge.status, message: charge.message || null } } }
  }

  if (action === 'cancel' && !body.when) throw new ApiError(400, 'when: say "now" or "period_end".', 'validation_error')
  await prisma.$transaction(async (db) => {
    if (action === 'freeze') return freezeMembership(db, { ownerId, membershipId, until: body.until, reason: body.reason, actor })
    if (action === 'unfreeze') return unfreezeMembership(db, { ownerId, membershipId, actor })
    // The notice period and contract term apply: an integration cannot waive them.
    if (action === 'cancel') return cancelMembership(db, { ownerId, membershipId, when: body.when!, reason: body.reason, actor })
    return resumeMembership(db, { ownerId, membershipId, actor })
  }, { timeout: 15_000 })
  await audit(`membership.${action}`, `Membership ${action} through the API`, { entityType: 'membership', entityId: membershipId, metadata: body.reason ? { reason: body.reason } : undefined })
  await flushOutbox(ownerId)
  return shown()
})
