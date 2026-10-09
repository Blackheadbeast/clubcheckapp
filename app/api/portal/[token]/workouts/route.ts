import { portalHandler } from '@/lib/portal'
import { memberWorkouts } from '@/lib/services/workout-sessions'

export const dynamic = 'force-dynamic'

// GET - the signed-in member's training: today, what is coming, program progress, recent results and records
export const GET = portalHandler({}, async ({ member, ownerId }) => memberWorkouts(ownerId, member.id))
