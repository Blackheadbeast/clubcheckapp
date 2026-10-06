import { prisma } from '@/lib/prisma'
import { assertOwned, handler, notFound } from '@/lib/api'
import { zonedToUtc } from '@/lib/dates'
import { scheduleSchema } from '@/lib/schemas'
import { resyncSchedule } from '@/lib/services/classes'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// PATCH - edit a recurring class; future sessions are brought in line with it
export const PATCH = handler({ permission: 'classes.manage', write: true, body: scheduleSchema.partial() }, async ({ ownerId, params, body, audit }) => {
  const before = await prisma.classSchedule.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Schedule')
  await assertOwned(ownerId, 'classType', body.classTypeId, 'Class')
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  await assertOwned(ownerId, 'staff', body.coachId, 'Coach')
  const settings = await getGymSettings(ownerId)
  const { startDate, endDate, ...rest } = body
  const result = await prisma.$transaction(async (db) => {
    const schedule = await db.classSchedule.update({
      where: { id: before.id },
      data: {
        ...rest,
        ...(rest.daysOfWeek && { daysOfWeek: Array.from(new Set(rest.daysOfWeek)).sort() }),
        ...(startDate && { startDate: zonedToUtc(startDate, '00:00', settings.timezone) }),
        ...(endDate !== undefined && { endDate: endDate ? zonedToUtc(endDate, '23:59', settings.timezone) : null }),
      },
    })
    return { schedule, ...(await resyncSchedule(db, schedule, settings)) }
  }, { timeout: 30_000 })
  await audit('schedule.update', 'Updated a recurring class schedule', { entityType: 'classSchedule', entityId: before.id, before, after: result.schedule })
  return { id: before.id, regenerated: result.regenerated, keptWithBookings: result.keptWithBookings }
})

// DELETE - stop the recurrence; future sessions nobody has booked are removed
export const DELETE = handler({ permission: 'classes.manage', write: true }, async ({ ownerId, params, audit }) => {
  const schedule = await prisma.classSchedule.findFirst({ where: { id: params.id, ownerId } })
  if (!schedule) throw notFound('Schedule')
  const settings = await getGymSettings(ownerId)
  const result = await prisma.$transaction(async (db) => {
    const stopped = await db.classSchedule.update({ where: { id: schedule.id }, data: { isActive: false } })
    return resyncSchedule(db, stopped, settings)
  }, { timeout: 30_000 })
  await audit('schedule.delete', 'Stopped a recurring class schedule', { entityType: 'classSchedule', entityId: schedule.id })
  return { stopped: true, keptWithBookings: result.keptWithBookings }
})
