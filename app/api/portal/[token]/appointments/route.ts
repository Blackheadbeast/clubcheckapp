import { z } from 'zod'
import { portalHandler } from '@/lib/portal'
import { dateInput, optionalText } from '@/lib/schemas'
import { assertOwned } from '@/lib/api'
import { bookAppointment, getAppointment, listAppointments, memberView, settleAppointmentPayment } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

// GET - the member's own appointments: upcoming, past and cancelled
export const GET = portalHandler({}, async ({ member, ownerId }) => {
  const now = new Date()
  const all = await listAppointments(ownerId, { memberId: member.id, from: new Date(now.getTime() - 365 * 86_400_000), take: 300 })
  const views = all.map((a) => memberView(a, now))
  return {
    upcoming: views.filter((a) => a.status === 'booked' && a.endsAt > now),
    past: views.filter((a) => ['completed', 'no_show'].includes(a.status) || (a.status === 'booked' && a.endsAt <= now)).reverse().slice(0, 30),
    cancelled: views.filter((a) => ['cancelled', 'late_cancelled'].includes(a.status)).reverse().slice(0, 30),
  }
})

const schema = z.object({
  typeId: z.string().uuid(),
  /** Omit or null for "any available". */
  staffId: z.string().uuid().nullish(),
  startsAt: dateInput,
  locationId: z.string().uuid().nullish(),
  notes: optionalText(500),
})

// POST - the member books for themselves. No override exists on this route:
// the type's notice, advance limit and the coach's working hours always apply.
export const POST = portalHandler({ write: true, body: schema }, async ({ member, ownerId, body, actor }) => {
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const result = await bookAppointment({ ownerId, memberId: member.id, typeId: body.typeId, staffId: body.staffId, startsAt: body.startsAt, locationId: body.locationId, notes: body.notes, source: 'member', actor })
  const payment = await settleAppointmentPayment(ownerId, result.appointment.id, 'member', actor)
  return { appointment: memberView(await getAppointment(ownerId, result.appointment.id)), creditsRemaining: result.creditsRemaining, payment }
})
