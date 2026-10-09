import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { programOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/programs/:id - the program with its training days (week, weekday 1=Mon..7=Sun, workout)
export const GET = publicHandler({ scope: 'programs:read' }, async ({ ownerId, params }) => {
  const program = await prisma.program.findFirst({ where: { id: params.id, ownerId }, include: { days: { orderBy: [{ week: 'asc' }, { day: 'asc' }] } } })
  if (!program) throw notFound('Program')
  return programOut(program)
})
