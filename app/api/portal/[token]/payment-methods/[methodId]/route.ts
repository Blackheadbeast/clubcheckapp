import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { removePaymentMethod, setDefaultPaymentMethod } from '@/lib/payments/stripe-connect'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// The handler resolves the member from the token; the method must belong to that member.
export const PATCH = portalHandler({ write: true }, async ({ member, ownerId, params }) => setDefaultPaymentMethod(ownerId, member.id, params.methodId))

export const DELETE = portalHandler({ write: true }, async ({ member, ownerId, params, actor }) => {
  await removePaymentMethod(ownerId, member.id, params.methodId)
  await logActivity(prisma, { ownerId, memberId: member.id, type: 'payment_method_removed', title: 'Removed a saved payment method', actor })
  return { ok: true }
})
