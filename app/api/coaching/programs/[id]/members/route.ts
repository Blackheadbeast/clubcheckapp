import { handler } from '@/lib/api'
import { programMembers } from '@/lib/services/coaching'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET - who is on this program and how far each has got. A coach sees the members they coach.
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, params, actor }) => programMembers(ownerId, params.id, ownDiaryOnly(actor)))
