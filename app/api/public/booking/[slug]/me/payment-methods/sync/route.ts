import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { bookingRoute } from '@/lib/public-booking/http'
import { publicPaymentMethod, syncSetupIntent } from '@/lib/payments/stripe-connect'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true, body: z.object({ setupIntentId: z.string().min(5).max(200) }) }, async ({ site, viewer, body }) => {
  if (!viewer!.hasAccount) throw new ApiError(403, 'Sign in or create an account to save a card.', 'account_required')
  const result = await syncSetupIntent(site.ownerId, viewer!.member.id, body.setupIntentId)
  if (result.status === 'saved') {
    const label = result.paymentMethod.type === 'card' ? 'card' : 'bank account'
    await logActivity(prisma, { ownerId: site.ownerId, memberId: viewer!.member.id, type: 'payment_method_added', title: `Added a ${label} ending ${result.paymentMethod.last4}`, actor: { type: 'member', id: viewer!.member.id, name: viewer!.member.name } })
  }
  return { status: result.status, method: result.paymentMethod && publicPaymentMethod(result.paymentMethod) }
})
