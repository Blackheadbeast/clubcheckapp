import { bookingRoute } from '@/lib/public-booking/http'
import { publicClasses } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET ?date=YYYY-MM-DD&days=&locationId=&category=&classTypeId= - the public timetable
export const GET = bookingRoute({ limit: 'availability', viewer: 'optional' }, async ({ site, viewer, query }) =>
  publicClasses(site, viewer, { date: query.get('date'), days: parseInt(query.get('days') || '7', 10) || 7, locationId: query.get('locationId'), category: query.get('category'), classTypeId: query.get('classTypeId') }))
