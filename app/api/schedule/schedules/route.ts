import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { addDays, zonedToUtc } from '@/lib/dates'
import { scheduleSchema } from '@/lib/schemas'
import { GENERATION_HORIZON_DAYS, generateSessions } from '@/lib/services/classes'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'classes.view' }, async ({ ownerId }) =>
  prisma.classSchedule.findMany({
    where: { ownerId },
    orderBy: [{ isActive: 'desc' }, { startTime: 'asc' }],
    include: { classType: { select: { name: true, color: true } }, coach: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
  })
)

// POST - create a weekly recurring class and generate its upcoming sessions
export const POST = handler({ permission: 'classes.manage', write: true, body: scheduleSchema }, async ({ ownerId, body, audit }) => {
  await assertOwned(ownerId, 'classType', body.classTypeId, 'Class')
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  await assertOwned(ownerId, 'staff', body.coachId, 'Coach')
  const settings = await getGymSettings(ownerId)
  const { startDate, endDate, ...rest } = body
  const result = await prisma.$transaction(async (db) => {
    const schedule = await db.classSchedule.create({
      data: {
        ownerId, ...rest,
        daysOfWeek: Array.from(new Set(rest.daysOfWeek)).sort(),
        startDate: zonedToUtc(startDate, '00:00', settings.timezone),
        endDate: endDate ? zonedToUtc(endDate, '23:59', settings.timezone) : null,
      },
    })
    const created = await generateSessions(db, schedule, settings, addDays(new Date(), GENERATION_HORIZON_DAYS))
    return { schedule, created }
  }, { timeout: 20_000 })
  await audit('schedule.create', `Created a recurring class schedule (${result.created} sessions generated)`, { entityType: 'classSchedule', entityId: result.schedule.id })
  return { id: result.schedule.id, sessionsCreated: result.created }
})
