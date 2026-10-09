import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { Created, Page, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { assignmentOut } from '@/lib/public-api/serialize'
import { assignProgram, assignSchema } from '@/lib/services/programs'

export const dynamic = 'force-dynamic'

// GET /api/v1/programs/:id/assignments?memberId=&status= - who is on the program
export const GET = publicHandler({ scope: 'programs:read' }, async ({ ownerId, params, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  if (!(await prisma.program.findFirst({ where: { id: params.id, ownerId }, select: { id: true } }))) throw notFound('Program')
  const status = oneOf(query, 'status', ['scheduled', 'active', 'paused', 'completed', 'cancelled'] as const)
  const where: Prisma.ProgramAssignmentWhereInput = { ownerId, programId: params.id, ...(query.get('memberId') && { memberId: query.get('memberId')! }), ...(status && { status }) }
  const [rows, total] = await Promise.all([prisma.programAssignment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }), prisma.programAssignment.count({ where })])
  return new Page(rows.map(assignmentOut), total, page, pageSize)
})

// POST /api/v1/programs/:id/assignments - put members (or everyone on a membership plan) on the program
export const POST = publicHandler({ scope: 'programs:write', write: true, body: assignSchema, idempotent: true }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await prisma.$transaction((db) => assignProgram(db, { ownerId, programId: params.id, ...body, actor }), { timeout: 30_000 })
  await audit('program.assign', `Assigned ${result.program.name} to ${result.created.length} member${result.created.length === 1 ? '' : 's'} through the API`, { entityType: 'program', entityId: params.id })
  return new Created({ assigned: result.created.map((c) => assignmentOut(c.assignment)), alreadyOn: result.already.map((m) => m.id) })
})
