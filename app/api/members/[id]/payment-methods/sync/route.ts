import { z } from 'zod'
import { assertOwned, handler } from '@/lib/api'
import { publicPaymentMethod, syncSetupIntent } from '@/lib/payments/stripe-connect'
import { logActivity } from '@/lib/services/core'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// POST /api/members/:id/payment-methods/sync - store the method Stripe just confirmed
export const POST = handler({ permission: 'billing.manage', write: true, body: z.object({ setupIntentId: z.string().min(5).max(200) }) }, async ({ ownerId, params, body, actor, audit }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  const result = await syncSetupIntent(ownerId, params.id, body.setupIntentId)
  if (result.status === 'saved') {
    const label = result.paymentMethod.type === 'card' ? 'card' : 'bank account'
    await logActivity(prisma, { ownerId, memberId: params.id, type: 'payment_method_added', title: `Added a ${label} ending ${result.paymentMethod.last4}`, actor })
    await audit('payment_method.add', `Saved a ${label} ending ${result.paymentMethod.last4}`, { entityType: 'member', entityId: params.id })
  }
  return { status: result.status, method: result.paymentMethod && publicPaymentMethod(result.paymentMethod) }
})
