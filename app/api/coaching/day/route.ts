import { handler } from '@/lib/api'
import { coachingDay } from '@/lib/services/coaching'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/coaching/day?date=YYYY-MM-DD - who had a workout that day, and who did it
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, query, actor }) => coachingDay(ownerId, { own: ownDiaryOnly(actor), date: query.get('date') }))
