import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { dateInput } from '@/lib/schemas'
import { getGymSettings } from '@/lib/services/core'
import { cancelMembership, freezeMembership, resumeMembership, unfreezeMembership } from '@/lib/services/memberships'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('freeze'), until: dateInput.optional(), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('unfreeze') }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('resume') }),
])

const off = (what: string) => new ApiError(403, `${what} is handled at the front desk. Please speak to the team.`, 'self_service_disabled')

// POST - the member manages their own membership. Every rule is the staff rule from
// lib/services/memberships.ts, minus the staff-only overrides: a member can never skip the
// notice period, break a contract, cancel immediately, or pick a plan the gym does not offer publicly.
export const POST = portalHandler({ write: true, body: schema }, async ({ member, ownerId, params, body, actor }) => {
  const owned = await prisma.membership.findFirst({ where: { id: params.id, ownerId, memberId: member.id }, select: { id: true } })
  if (!owned) throw notFound('Membership')
  const settings = await getGymSettings(ownerId)
  const target = { ownerId, membershipId: owned.id, actor }

  const result = await prisma.$transaction(async (db) => {
    switch (body.action) {
      case 'freeze':
        if (!settings.memberSelfFreeze) throw off('Freezing a membership')
        return freezeMembership(db, { ...target, until: body.until, reason: body.reason })
      case 'unfreeze':
        if (!settings.memberSelfFreeze) throw off('Freezing a membership')
        return unfreezeMembership(db, target)
      case 'cancel':
        if (!settings.memberSelfCancel) throw off('Cancelling a membership')
        // Always at the end of the paid period, never with the staff override.
        return (await cancelMembership(db, { ...target, when: 'period_end', reason: body.reason }).catch((error) => {
          if (error instanceof ApiError && error.status === 409) throw new ApiError(409, 'This membership is under contract, so it cannot be cancelled online yet. Please speak to the team.', 'under_contract', error.details)
          throw error
        })).membership
      case 'resume':
        if (!settings.memberSelfCancel) throw off('Cancelling a membership')
        return resumeMembership(db, target)
    }
  }, { timeout: 15_000 })
  await flushOutbox(ownerId)
  const m = result as { status: string; cancelAt?: Date | null; freezeEndsAt?: Date | null; currentPeriodEnd?: Date | null }
  return { status: m.status, cancelsAt: m.cancelAt || null, frozenUntil: m.freezeEndsAt || null, nextBillingAt: m.currentPeriodEnd || null }
})
