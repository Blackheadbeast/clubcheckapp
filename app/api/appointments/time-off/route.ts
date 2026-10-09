import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, badRequest, handler } from '@/lib/api'
import { dateInput, optionalText } from '@/lib/schemas'
import { TIME_OFF_KINDS } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

const schema = z.object({ staffId: z.string().uuid(), startsAt: dateInput, endsAt: dateInput, kind: z.enum(TIME_OFF_KINDS).default('vacation'), note: optionalText(200) })

// POST /api/appointments/time-off - block a date range for a staff member
export const POST = handler({ permission: null, write: true, body: schema }, async ({ ownerId, body, actor, can, audit }) => {
  if (!can('appointments.configure') && !(actor.type === 'staff' && actor.id === body.staffId)) throw new ApiError(403, 'You do not have permission to do that.', 'forbidden')
  await assertOwned(ownerId, 'staff', body.staffId, 'Staff member')
  if (body.endsAt <= body.startsAt) throw badRequest('The end must be after the start.')
  const row = await prisma.staffTimeOff.create({ data: { ownerId, ...body } })
  // Time off does not cancel anything by itself: tell the caller what is already in that range.
  const affected = await prisma.appointment.count({ where: { ownerId, staffId: body.staffId, status: 'booked', startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt } } })
  await audit('staff_time_off.create', `Added ${body.kind} time off`, { entityType: 'staff', entityId: body.staffId })
  return { id: row.id, affectedAppointments: affected }
})
