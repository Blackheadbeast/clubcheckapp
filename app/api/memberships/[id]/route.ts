import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { dateInput } from '@/lib/schemas'
import { cancelMembership, freezeMembership, resumeMembership, unfreezeMembership } from '@/lib/services/memberships'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('freeze'), until: dateInput.nullish(), reason: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal('unfreeze') }),
  z.object({ action: z.literal('cancel'), when: z.enum(['now', 'period_end']), reason: z.string().trim().max(300).nullish(), override: z.boolean().optional() }),
  z.object({ action: z.literal('resume') }),
])

// POST /api/memberships/:id - lifecycle actions on one membership.
// Changing plan moves money, so it has its own route with a preview: /api/memberships/:id/plan-change
export const POST = handler({ permission: 'memberships.manage', write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const membershipId = params.id
  const result = await prisma.$transaction(async (db) => {
    switch (body.action) {
      case 'freeze': {
        const m = await freezeMembership(db, { ownerId, membershipId, until: body.until, reason: body.reason, actor })
        return { membership: m, description: 'Froze membership' }
      }
      case 'unfreeze': {
        const m = await unfreezeMembership(db, { ownerId, membershipId, actor })
        return { membership: m, description: 'Resumed frozen membership' }
      }
      case 'cancel': {
        const r = await cancelMembership(db, { ownerId, membershipId, when: body.when, reason: body.reason, override: body.override, actor })
        return { membership: r.membership, description: r.immediate ? 'Cancelled membership' : 'Scheduled membership cancellation', effective: r.effective, immediate: r.immediate }
      }
      case 'resume': {
        const m = await resumeMembership(db, { ownerId, membershipId, actor })
        return { membership: m, description: 'Withdrew scheduled cancellation' }
      }
    }
  }, { timeout: 15_000 })

  await audit(`membership.${body.action}`, result.description, {
    entityType: 'membership',
    entityId: membershipId,
    before: 'before' in result ? result.before : undefined,
    after: 'after' in result ? result.after : undefined,
    metadata: { memberId: result.membership.memberId, ...('reason' in body && body.reason ? { reason: body.reason } : {}) },
  })
  await flushOutbox(ownerId)
  return { status: result.membership.status, effective: 'effective' in result ? result.effective : null, immediate: 'immediate' in result ? result.immediate : null }
})
