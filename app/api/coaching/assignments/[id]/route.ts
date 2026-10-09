import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { assignmentActionSchema, changeAssignment } from '@/lib/services/programs'
import { flushOutbox } from '@/lib/services/automations'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// POST { action: pause | resume | cancel | complete | update } - one member's place on a program
export const POST = handler({ permission: 'workouts.manage', write: true, body: assignmentActionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const assignment = await prisma.$transaction((db) => changeAssignment(db, { ownerId, id: params.id, own: ownDiaryOnly(actor), actor, ...body }), { timeout: 15_000 })
  await audit(`program_assignment.${body.action}`, `Program assignment: ${body.action}`, { entityType: 'programAssignment', entityId: assignment.id, metadata: { memberId: assignment.memberId, programId: assignment.programId, status: assignment.status } })
  await flushOutbox(ownerId)
  return { id: assignment.id, status: assignment.status }
})
