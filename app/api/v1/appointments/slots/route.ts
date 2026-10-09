import { ApiError } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { getSlots } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

// GET /api/v1/appointments/slots?typeId=&date=YYYY-MM-DD&staffId=&locationId=&memberId=
// Start times that are genuinely free on that day (in the gym's timezone), and who is free at each.
export const GET = publicHandler({ scope: 'appointments:read' }, async ({ ownerId, query }) => {
  const typeId = query.get('typeId')
  const date = query.get('date') || ''
  if (!typeId) throw new ApiError(400, 'typeId is required.', 'invalid_parameter')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'date must be YYYY-MM-DD.', 'invalid_parameter')
  const slots = await getSlots({ ownerId, typeId, date, staffId: query.get('staffId'), locationId: query.get('locationId'), memberId: query.get('memberId') })
  return slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), staff: s.staff.map((p) => ({ id: p.id, name: p.name, locationId: p.locationId })) }))
})
