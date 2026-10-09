import { z } from 'zod'
import { ApiError, assertOwned, handler } from '@/lib/api'
import { dateInput, optionalText } from '@/lib/schemas'
import { ownDiaryOnly } from '@/lib/appointments-http'
import { bookAppointment, listAppointments, settleAppointmentPayment } from '@/lib/services/appointments'
import { effectiveLocation } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined)

// GET /api/appointments?from=&to=&staffId=&memberId=&locationId=&status=
export const GET = handler({ permission: 'appointments.view' }, async ({ ownerId, query, actor }) => {
  await assertOwned(ownerId, 'member', query.get('memberId'), 'Member')
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  return listAppointments(ownerId, {
    from: iso(query.get('from')), to: iso(query.get('to')), memberId: query.get('memberId'), locationId: scope.locationId, status: query.get('status'),
    // Coaches and trainers only ever see their own diary.
    staffId: ownDiaryOnly(actor) || query.get('staffId'),
  })
})

const bookSchema = z.object({
  typeId: z.string().uuid(),
  memberId: z.string().uuid(),
  staffId: z.string().uuid().nullish(),
  startsAt: dateInput,
  locationId: z.string().uuid().nullish(),
  notes: optionalText(500),
  /** Book outside the type's notice and advance limits or the coach's working hours. Never overrides a clash. */
  override: z.boolean().optional(),
})

// POST /api/appointments - staff book a member in
export const POST = handler({ permission: 'appointments.manage', write: true, body: bookSchema }, async ({ ownerId, body, actor, audit }) => {
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const limit = ownDiaryOnly(actor)
  if (limit && body.staffId && body.staffId !== limit) throw new ApiError(403, 'You can only book appointments in your own diary.', 'forbidden')
  const result = await bookAppointment({ ownerId, ...body, staffId: limit || body.staffId, source: 'staff', actor })
  const payment = await settleAppointmentPayment(ownerId, result.appointment.id, 'staff', actor)
  await audit('appointment.book', `Booked ${result.member.name} for ${result.type.name} with ${result.staff.name}`, { entityType: 'appointment', entityId: result.appointment.id, metadata: { memberId: result.member.id, staffId: result.staff.id } })
  return { id: result.appointment.id, status: result.appointment.status, startsAt: result.appointment.startsAt, staff: { id: result.staff.id, name: result.staff.name }, creditsRemaining: result.creditsRemaining, payment }
})
