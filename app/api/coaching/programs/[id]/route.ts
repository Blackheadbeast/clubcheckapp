import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, handler } from '@/lib/api'
import { archiveProgram, assignProgram, assignSchema, programDetail, programUpdateSchema, updateProgram } from '@/lib/services/programs'
import { flushOutbox } from '@/lib/services/automations'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, params, actor }) => {
  const detail = await programDetail(ownerId, params.id)
  const own = ownDiaryOnly(actor)
  return { ...detail, canEdit: !own || detail.createdById === own }
})

export const PATCH = handler({ permission: 'workouts.manage', write: true, body: programUpdateSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const { before, program } = await prisma.$transaction((db) => updateProgram(db, ownerId, params.id, body, ownDiaryOnly(actor)), { timeout: 30_000 })
  await audit('program.update', `Updated the program ${program.name}`, { entityType: 'program', entityId: program.id, before: { name: before.name, weeks: before.weeks, days: before.days.length }, after: { name: program.name, weeks: program.weeks } })
  return { id: program.id }
})

export const DELETE = handler({ permission: 'workouts.manage', write: true }, async ({ ownerId, params, actor, audit }) => {
  const program = await archiveProgram(prisma, ownerId, params.id, true, ownDiaryOnly(actor))
  await audit('program.archive', `Archived the program ${program.name}`, { entityType: 'program', entityId: program.id })
  return { archived: true }
})

const actionSchema = z.union([
  z.object({ action: z.literal('restore') }),
  z.object({ action: z.literal('assign'), assignment: assignSchema }),
])

// POST { action: "assign", assignment } - put members on this program. { action: "restore" } - bring it back from the archive.
export const POST = handler({ permission: 'workouts.manage', write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  if (body.action === 'restore') {
    await archiveProgram(prisma, ownerId, params.id, false, ownDiaryOnly(actor))
    return { restored: true }
  }
  const own = ownDiaryOnly(actor)
  // A coach assigning a program coaches it themselves; they cannot hand members to another coach.
  if (own && body.assignment.coachId && body.assignment.coachId !== own) throw new ApiError(403, 'You can only assign members to yourself.', 'forbidden')
  const result = await prisma.$transaction((db) => assignProgram(db, { ownerId, programId: params.id, ...body.assignment, coachId: own || body.assignment.coachId, actor }), { timeout: 60_000 })
  await audit('program.assign', `Assigned ${result.program.name} to ${result.created.length} member${result.created.length === 1 ? '' : 's'}`, {
    entityType: 'program', entityId: params.id, metadata: { memberIds: result.created.map((c) => c.member.id), startDate: body.assignment.startDate, coachId: result.coach?.id || null, planId: body.assignment.planId || null },
  })
  await flushOutbox(ownerId)
  return { assigned: result.created.length, alreadyOn: result.already.map((m) => m.name) }
})
