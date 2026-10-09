import { handler } from '@/lib/api'
import { getConnectStatus, startOnboarding } from '@/lib/payments/stripe-connect'

export const dynamic = 'force-dynamic'

// GET /api/billing/connect - is this gym able to charge cards and bank accounts?
export const GET = handler({ permission: ['billing.view', 'settings.manage'] }, async ({ ownerId, query }) => getConnectStatus(ownerId, query.get('refresh') === '1'))

// POST /api/billing/connect - start (or resume) Stripe onboarding; returns a hosted link
export const POST = handler({ permission: 'settings.manage', write: true, rateLimit: { key: 'connect', windowMs: 60_000, maxRequests: 10 } }, async ({ ownerId, req, audit }) => {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const link = await startOnboarding(ownerId, origin)
  await audit('payments.connect', 'Started connecting a Stripe account', { entityType: 'settings' })
  return link
})
