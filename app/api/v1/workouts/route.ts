import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { workoutOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/workouts?search=&archived=&updatedSince=
export const GET = publicHandler({ scope: 'workouts:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const updatedSince = dateParam(query, 'updatedSince')
  const archived = oneOf(query, 'archived', ['true', 'false', 'all'] as const) || 'false'
  const search = (query.get('search') || '').trim().slice(0, 100)
  const where: Prisma.WorkoutWhereInput = {
    ownerId,
    ...(archived === 'true' ? { archivedAt: { not: null } } : archived === 'false' ? { archivedAt: null } : {}),
    ...(search && { name: { contains: search, mode: 'insensitive' } }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
  }
  const [rows, total] = await Promise.all([prisma.workout.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take }), prisma.workout.count({ where })])
  const versions = await prisma.workoutVersion.findMany({ where: { id: { in: rows.map((r) => r.currentVersionId).filter(Boolean) as string[] } } })
  return new Page(rows.map((w) => workoutOut(w, versions.find((v) => v.id === w.currentVersionId) || null)), total, page, pageSize)
})
