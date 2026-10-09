import { portalHandler } from '@/lib/portal'
import { memberRecords } from '@/lib/services/workout-sessions'

export const dynamic = 'force-dynamic'

// GET - the member's bests. ?exerciseId= gives the history of one exercise.
export const GET = portalHandler({}, async ({ member, ownerId, req }) => {
  const exerciseId = req.nextUrl.searchParams.get('exerciseId')
  return memberRecords(ownerId, member.id, { exerciseId: exerciseId && /^[0-9a-f-]{36}$/i.test(exerciseId) ? exerciseId : null })
})
