import { assertOwned, badRequest, handler } from '@/lib/api'
import { getSlots } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

// GET /api/appointments/slots?typeId=&date=YYYY-MM-DD&staffId=&locationId=&memberId=&ignore=&override=1
export const GET = handler({ permission: 'appointments.view' }, async ({ ownerId, query }) => {
  const typeId = query.get('typeId')
  const date = query.get('date')
  if (!typeId || !date) throw badRequest('typeId and date are required.')
  await assertOwned(ownerId, 'member', query.get('memberId'), 'Member')
  const slots = await getSlots({
    ownerId, typeId, date, staffId: query.get('staffId'), locationId: query.get('locationId'), memberId: query.get('memberId'),
    ignoreAppointmentId: query.get('ignore') || undefined, ignoreBookingWindow: query.get('override') === '1',
  })
  return slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, staff: s.staff.map((p) => ({ id: p.id, name: p.name })) }))
})
