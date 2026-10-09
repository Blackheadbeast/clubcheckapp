import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { publicPaymentMethod, syncSetupIntent } from '@/lib/payments/stripe-connect'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const POST = portalHandler({ write: true, body: z.object({ setupIntentId: z.string().min(5).max(200) }) }, async ({ member, ownerId, body, actor }) => {
  const result = await syncSetupIntent(ownerId, member.id, body.setupIntentId)
  if (result.status === 'saved') {
    const label = result.paymentMethod.type === 'card' ? 'card' : 'bank account'
    await logActivity(prisma, { ownerId, memberId: member.id, type: 'payment_method_added', title: `Added a ${label} ending ${result.paymentMethod.last4}`, actor })
  }
  return { status: result.status, method: result.paymentMethod && publicPaymentMethod(result.paymentMethod) }
})
