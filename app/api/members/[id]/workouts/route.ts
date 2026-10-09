import { handler } from '@/lib/api'
import { memberProgress } from '@/lib/services/coaching'
import { assertCoaches, memberRecords, workoutHistory } from '@/lib/services/workout-sessions'
import { assertOwned } from '@/lib/api'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/workouts - a member's training for their coach.
//   ?before=<iso> the next page of history · ?exerciseId= the record history of one exercise
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, params, query, actor }) => {
  const own = ownDiaryOnly(actor)
  const before = query.get('before')
  const exerciseId = query.get('exerciseId')
  if (before || exerciseId) {
    await assertOwned(ownerId, 'member', params.id, 'Member')
    if (own) await assertCoaches(ownerId, own, params.id)
    if (exerciseId) return memberRecords(ownerId, params.id, { exerciseId })
    const at = new Date(before!)
    return workoutHistory(ownerId, params.id, { before: Number.isNaN(at.getTime()) ? null : at })
  }
  return memberProgress(ownerId, params.id, own)
})
