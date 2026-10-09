import { handler } from '@/lib/api'
import { ownDiaryOnly } from '@/lib/appointments-http'
import { effectiveLocation, getToday } from '@/lib/services/today'
import { expireOffers } from '@/lib/services/bookings'
import { ensureSessions } from '@/lib/services/classes'
import { drainOutbox } from '@/lib/services/outbox'

export const dynamic = 'force-dynamic'

// GET /api/today?locationId=&mine=1 - the day's classes, appointments and check-ins for the
// signed-in staff member. Each section only appears if their role may see it, coaches' appointments
// are always their own, and staff tied to one location only ever get that location.
export const GET = handler({ permission: null }, async ({ ownerId, actor, query, can }) => {
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const now = new Date()
  await ensureSessions(ownerId, new Date(now.getTime() + 2 * 86_400_000), now)
  await expireOffers(ownerId, now)
  // An open staff screen keeps reminders and scheduled messages moving between cron runs.
  await drainOutbox(ownerId, 15).catch((error) => console.error('[today] outbox', error instanceof Error ? error.message : error))
  const own = ownDiaryOnly(actor)
  const mine = actor.type === 'staff' && query.get('mine') === '1'
  const today = await getToday(ownerId, {
    locationId: scope.locationId,
    staffId: mine ? actor.id : null,
    includeClasses: can('classes.view'),
    includeAppointments: can('appointments.view'),
    includeCheckins: can('attendance.manage') || can('members.view'),
  })
  // Coaches and trainers see every class if asked, but only ever their own appointments.
  const appointments = own ? today.appointments.filter((a) => a.staff.id === own) : today.appointments
  return { ...today, appointments, locationLocked: scope.locked, mine, canSeeAllAppointments: !own }
})
