import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { coachNoteSchema, saveCoachNote, sessionView } from '@/lib/services/workout-sessions'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET - one member's workout as it was prescribed and as it was done
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, params, actor }) => sessionView(ownerId, params.id, { staff: true, own: ownDiaryOnly(actor) }))

// PATCH { coachNotes?, coachFeedback? } - a private note for staff, and feedback the member reads
export const PATCH = handler({ permission: 'workouts.manage', write: true, body: coachNoteSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const session = await prisma.$transaction((db) => saveCoachNote(db, { ownerId, sessionId: params.id, own: ownDiaryOnly(actor), actor, ...body }))
  await audit('workout.coach_note', body.coachFeedback !== undefined ? 'Left feedback on a workout' : 'Wrote a coach note on a workout', { entityType: 'workoutSession', entityId: session.id, metadata: { memberId: session.memberId } })
  return { saved: true }
})
