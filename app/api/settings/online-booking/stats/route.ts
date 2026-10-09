import { handler } from '@/lib/api'
import { bookingStats } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET /api/settings/online-booking/stats?days=30 - visits, bookings, cancellations and what is coming up from the website
export const GET = handler({ permission: ['settings.manage', 'reports.view'] }, async ({ ownerId, query }) =>
  bookingStats(ownerId, Math.min(365, Math.max(1, parseInt(query.get('days') || '30', 10) || 30))))
