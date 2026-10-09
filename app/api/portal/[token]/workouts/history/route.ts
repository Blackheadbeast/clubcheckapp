import { portalHandler } from '@/lib/portal'
import { workoutHistory } from '@/lib/services/workout-sessions'

export const dynamic = 'force-dynamic'

// GET ?before=<iso> - finished workouts, newest first, a page at a time
export const GET = portalHandler({}, async ({ member, ownerId, req }) => {
  const before = req.nextUrl.searchParams.get('before')
  const at = before ? new Date(before) : null
  return workoutHistory(ownerId, member.id, { before: at && !Number.isNaN(at.getTime()) ? at : null })
})
