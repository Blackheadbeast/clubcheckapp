import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  const now = new Date()
  const select = {
    id: true, status: true, creditUsed: true, offerExpiresAt: true,
    session: { select: { id: true, title: true, startsAt: true, endsAt: true, status: true, classType: { select: { name: true, color: true } }, coach: { select: { name: true } } } },
  } as const
  const [upcoming, past] = await Promise.all([
    prisma.booking.findMany({
      where: { memberId: params.id, ownerId, status: { in: ['booked', 'offered', 'waitlisted'] }, session: { startsAt: { gte: now } } },
      orderBy: { session: { startsAt: 'asc' } }, take: 50, select,
    }),
    prisma.booking.findMany({
      where: { memberId: params.id, ownerId, OR: [{ session: { startsAt: { lt: now } } }, { status: { in: ['cancelled', 'late_cancelled', 'no_show', 'attended'] } }] },
      orderBy: { session: { startsAt: 'desc' } }, take: 50, select,
    }),
  ])
  return { upcoming, past }
})
