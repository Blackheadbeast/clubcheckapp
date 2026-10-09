import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, handler, type Actor } from '@/lib/api'
import { availabilitySchema } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

/** Managers set anyone's hours; any staff member may set their own. */
function assertMayEdit(actor: Actor, can: (p: 'appointments.configure') => boolean, staffId: string) {
  if (can('appointments.configure') || (actor.type === 'staff' && actor.id === staffId)) return
  throw new ApiError(403, 'You do not have permission to do that.', 'forbidden')
}

// GET /api/appointments/availability/:staffId - weekly hours, breaks and upcoming time off
export const GET = handler({ permission: ['appointments.view', 'appointments.configure'] }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'staff', params.staffId, 'Staff member')
  const [rows, timeOff, types] = await Promise.all([
    prisma.staffAvailability.findMany({ where: { ownerId, staffId: params.staffId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
    prisma.staffTimeOff.findMany({ where: { ownerId, staffId: params.staffId, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } }),
    prisma.appointmentTypeStaff.findMany({ where: { ownerId, staffId: params.staffId }, select: { type: { select: { id: true, name: true, isActive: true } } } }),
  ])
  return {
    hours: rows.filter((r) => r.kind === 'work').map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute, locationId: r.locationId })),
    breaks: rows.filter((r) => r.kind === 'break').map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute })),
    timeOff: timeOff.map((t) => ({ id: t.id, startsAt: t.startsAt, endsAt: t.endsAt, kind: t.kind, note: t.note })),
    types: types.map((t) => t.type).filter((t) => t.isActive),
  }
})

// PUT - replace the whole week
export const PUT = handler({ permission: null, write: true, body: availabilitySchema }, async ({ ownerId, params, body, actor, can, audit }) => {
  assertMayEdit(actor, can, params.staffId)
  await assertOwned(ownerId, 'staff', params.staffId, 'Staff member')
  for (const h of body.hours) await assertOwned(ownerId, 'location', h.locationId, 'Location')
  await prisma.$transaction([
    prisma.staffAvailability.deleteMany({ where: { ownerId, staffId: params.staffId } }),
    prisma.staffAvailability.createMany({
      data: [
        ...body.hours.map((h) => ({ ownerId, staffId: params.staffId, weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute, kind: 'work', locationId: h.locationId || null })),
        ...body.breaks.map((b) => ({ ownerId, staffId: params.staffId, weekday: b.weekday, startMinute: b.startMinute, endMinute: b.endMinute, kind: 'break', locationId: null })),
      ],
    }),
  ])
  await audit('staff_availability.update', 'Updated appointment availability', { entityType: 'staff', entityId: params.staffId })
  return { saved: true }
})
