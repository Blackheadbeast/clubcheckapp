import { assertOwned, handler } from '@/lib/api'
import { createSetupIntent, getConnectStatus, listPaymentMethods } from '@/lib/payments/stripe-connect'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/payment-methods - saved cards and bank accounts (display details only)
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  const [methods, connect] = await Promise.all([listPaymentMethods(ownerId, params.id), getConnectStatus(ownerId)])
  return { methods, canCharge: connect.chargesEnabled }
})

// POST /api/members/:id/payment-methods - begin saving a new one; the browser finishes with Stripe.js
export const POST = handler({ permission: 'billing.manage', write: true, rateLimit: { key: 'setup-intent', windowMs: 60_000, maxRequests: 20 } }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  return createSetupIntent(ownerId, params.id)
})
