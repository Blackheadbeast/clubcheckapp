import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertOwned } from '@/lib/api'
import { Created, Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { appointmentOut } from '@/lib/public-api/serialize'
import { dateInput, optionalText } from '@/lib/schemas'
import { bookAppointment, settleAppointmentPayment } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

const STATUSES = ['booked', 'completed', 'cancelled', 'late_cancelled', 'no_show'] as const
const names = { type: { select: { name: true } }, staff: { select: { id: true, name: true } } } as const

// GET /api/v1/appointments?from=&to=&memberId=&staffId=&locationId=&status=&updatedSince=
export const GET = publicHandler({ scope: 'appointments:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const from = dateParam(query, 'from')
  const to = dateParam(query, 'to')
  const updatedSince = dateParam(query, 'updatedSince')
  const status = oneOf(query, 'status', STATUSES)
  const where: Prisma.AppointmentWhereInput = {
    ownerId,
    ...(from && { endsAt: { gt: from } }),
    ...(to && { startsAt: { lt: to } }),
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('staffId') && { staffId: query.get('staffId')! }),
    ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    ...(status && { status }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
  }
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({ where, orderBy: updatedSince ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ startsAt: 'asc' }, { id: 'asc' }], skip, take, include: names }),
    prisma.appointment.count({ where }),
  ])
  return new Page(rows.map(appointmentOut), total, page, pageSize)
})

const schema = z.object({
  typeId: z.string().uuid(),
  memberId: z.string().uuid(),
  /** Omitted: whoever is free, the coach with the lightest day first. */
  staffId: z.string().uuid().nullish(),
  startsAt: dateInput,
  locationId: z.string().uuid().nullish(),
  notes: optionalText(500),
})

// POST /api/v1/appointments - book one. Working hours, notice, clashes, session credits and payment
// are enforced as they are for staff; nothing can be overridden from here.
export const POST = publicHandler({ scope: 'appointments:write', write: true, body: schema, idempotent: true }, async ({ ownerId, body, actor, audit }) => {
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const result = await bookAppointment({ ownerId, ...body, source: 'staff', actor })
  const payment = await settleAppointmentPayment(ownerId, result.appointment.id, 'staff', actor)
  await audit('appointment.book', `Booked ${result.member.name} for ${result.type.name} with ${result.staff.name} through the API`, { entityType: 'appointment', entityId: result.appointment.id, metadata: { memberId: result.member.id, staffId: result.staff.id } })
  // A payment that could not be taken cancels the appointment; say what is true now.
  const row = await prisma.appointment.findUniqueOrThrow({ where: { id: result.appointment.id }, include: names })
  return new Created({ ...appointmentOut(row), creditsRemaining: result.creditsRemaining, payment })
})
