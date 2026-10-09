import { portalHandler } from '@/lib/portal'
import { createSetupIntent, getConnectStatus, listPaymentMethods } from '@/lib/payments/stripe-connect'

export const dynamic = 'force-dynamic'

// GET - the member's own saved cards and bank accounts
export const GET = portalHandler({}, async ({ member, ownerId }) => {
  const [methods, connect] = await Promise.all([listPaymentMethods(ownerId, member.id), getConnectStatus(ownerId)])
  return { methods, canPay: connect.chargesEnabled }
})

// POST - begin adding one
export const POST = portalHandler({ write: true }, async ({ member, ownerId }) => createSetupIntent(ownerId, member.id))
