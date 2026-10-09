import { ApiError } from '@/lib/api'
import { bookingRoute } from '@/lib/public-booking/http'
import { createSetupIntent, getConnectStatus, listPaymentMethods } from '@/lib/payments/stripe-connect'

export const dynamic = 'force-dynamic'

// GET - the signed-in member's own saved cards and bank accounts, and whether this gym takes payment online
export const GET = bookingRoute({ limit: 'read', viewer: 'required' }, async ({ site, viewer }) => {
  if (!viewer!.hasAccount) return { methods: [], canPay: false }
  const [methods, connect] = await Promise.all([listPaymentMethods(site.ownerId, viewer!.member.id), getConnectStatus(site.ownerId)])
  return { methods, canPay: connect.chargesEnabled }
})

// POST - begin adding one. Card details go from the browser straight to the payment processor; ClubCheck never sees them.
export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true }, async ({ site, viewer }) => {
  if (!viewer!.hasAccount) throw new ApiError(403, 'Sign in or create an account to save a card.', 'account_required')
  return createSetupIntent(site.ownerId, viewer!.member.id)
})
