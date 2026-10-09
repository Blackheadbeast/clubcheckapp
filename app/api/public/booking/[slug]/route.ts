import { bookingRoute, tokenFor } from '@/lib/public-booking/http'
import { publicSite, recordVisit, viewerOut } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET /api/public/booking/:slug - what the page needs to draw itself, and who (if anyone) is signed in.
// A member who arrives already signed in to the member app on this site is handed a booking token to use from here on.
export const GET = bookingRoute({ limit: 'read', viewer: 'optional' }, async ({ site, viewer, query }) => {
  if (query.get('visit') === '1') await recordVisit(site)
  return { site: await publicSite(site), viewer: viewerOut(viewer), token: viewer ? await tokenFor(viewer) : null }
})
