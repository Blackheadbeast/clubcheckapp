import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { createProgram, listPrograms, programSchema } from '@/lib/services/programs'
import { ownDiaryOnly } from '@/lib/appointments-http'

export const dynamic = 'force-dynamic'

// GET /api/coaching/programs?search=&archived=1
export const GET = handler({ permission: 'workouts.view' }, async ({ ownerId, query, actor }) => {
  const { page, pageSize, skip, take } = paging(query, 50)
  const list = await listPrograms(ownerId, { search: query.get('search'), archived: query.get('archived') === '1', skip, take })
  const own = ownDiaryOnly(actor)
  return new Paginated(list.rows.map((p) => ({ ...p, canEdit: !own || p.createdById === own })), list.total, page, pageSize)
})

export const POST = handler({ permission: 'workouts.manage', write: true, body: programSchema }, async ({ ownerId, body, actor, audit }) => {
  const program = await prisma.$transaction((db) => createProgram(db, ownerId, body, actor), { timeout: 15_000 })
  await audit('program.create', `Created the program ${program.name}`, { entityType: 'program', entityId: program.id })
  return { id: program.id }
})
