import { bookingRoute } from '@/lib/public-booking/http'
import { publicAppointmentTypes } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

export const GET = bookingRoute({ limit: 'read', viewer: 'optional' }, async ({ site, viewer }) => publicAppointmentTypes(site, viewer))
