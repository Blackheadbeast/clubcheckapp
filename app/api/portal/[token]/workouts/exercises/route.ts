import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { ensureSystemExercises, memberExerciseView, visibleTo } from '@/lib/services/exercises'

export const dynamic = 'force-dynamic'

// GET ?search= - exercises a member can pick when they did something else instead. No coach notes.
export const GET = portalHandler({}, async ({ ownerId, req }) => {
  await ensureSystemExercises()
  const search = (req.nextUrl.searchParams.get('search') || '').trim().slice(0, 60)
  return prisma.exercise.findMany({
    where: { isActive: true, AND: [visibleTo(ownerId), ...(search ? [{ name: { contains: search, mode: 'insensitive' as const } }] : [])] },
    orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 25, select: memberExerciseView,
  })
})
