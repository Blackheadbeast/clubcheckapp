import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Page, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { programOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/programs?search=&archived=
export const GET = publicHandler({ scope: 'programs:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const archived = oneOf(query, 'archived', ['true', 'false', 'all'] as const) || 'false'
  const search = (query.get('search') || '').trim().slice(0, 100)
  const where: Prisma.ProgramWhereInput = { ownerId, ...(archived === 'true' ? { archivedAt: { not: null } } : archived === 'false' ? { archivedAt: null } : {}), ...(search && { name: { contains: search, mode: 'insensitive' } }) }
  const [rows, total] = await Promise.all([prisma.program.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take }), prisma.program.count({ where })])
  return new Page(rows.map((p) => programOut(p)), total, page, pageSize)
})
