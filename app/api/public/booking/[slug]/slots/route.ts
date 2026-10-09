import { ApiError } from '@/lib/api'
import { bookingRoute } from '@/lib/public-booking/http'
import { publicSlots } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET ?typeId=&date=YYYY-MM-DD&staffId=&locationId= - free start times, from the appointment engine
export const GET = bookingRoute({ limit: 'availability', viewer: 'optional' }, async ({ site, viewer, query }) => {
  const typeId = query.get('typeId')
  if (!typeId) throw new ApiError(400, 'Choose what to book.', 'invalid_parameter')
  return publicSlots(site, viewer, { typeId, date: query.get('date') || '', staffId: query.get('staffId'), locationId: query.get('locationId') })
})
