import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { classOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'classes:read' }, async ({ ownerId, params }) => {
  const row = await prisma.classSession.findFirst({ where: { id: params.id, ownerId }, include: { classType: { select: { name: true, category: true } }, coach: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } } })
  if (!row) throw notFound('Class')
  const counts = await prisma.booking.groupBy({ by: ['status'], where: { ownerId, sessionId: row.id, status: { in: ['booked', 'offered', 'attended', 'waitlisted'] } }, _count: { _all: true } })
  const of = (statuses: string[]) => counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0)
  return classOut(row, { booked: of(['booked', 'offered', 'attended']), waitlisted: of(['waitlisted']) })
})
