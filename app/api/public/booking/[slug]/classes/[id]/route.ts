import { bookingRoute } from '@/lib/public-booking/http'
import { publicClass } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET - one class: what it takes to get in and, for someone signed in, whether they can
export const GET = bookingRoute({ limit: 'availability', viewer: 'optional' }, async ({ site, viewer, params }) => publicClass(site, viewer, params.id))
