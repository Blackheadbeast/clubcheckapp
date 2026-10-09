import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { resolveRange } from '@/lib/dates'
import { getGymSettings } from '@/lib/services/core'
import { csvResponse } from '@/lib/csv'
import { effectiveLocation } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

// GET /api/billing/transactions?range=&type=&status=&method=&search=&locationId=&format=csv
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, query, actor }) => {
  const { page, pageSize, skip, take } = paging(query)
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const settings = await getGymSettings(ownerId)
  const range = query.get('range') ? resolveRange(query.get('range'), query.get('from'), query.get('to'), settings.timezone) : null
  const search = (query.get('search') || '').trim()
  const where: Prisma.TransactionWhereInput = {
    ownerId,
    ...(range && { createdAt: { gte: range.start, lt: range.end } }),
    ...(query.get('type') && { type: query.get('type')! }),
    ...(query.get('status') && { status: query.get('status')! }),
    ...(query.get('method') && { method: query.get('method')! }),
    ...(scope.locationId && { locationId: scope.locationId }),
    ...(search && {
      OR: [
        { id: { startsWith: search.toLowerCase() } },
        { member: { name: { contains: search, mode: 'insensitive' } } },
        { invoice: { number: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  }
  const select = {
    id: true, type: true, status: true, amountCents: true, refundedCents: true, method: true, failureReason: true, note: true, staffName: true, createdAt: true,
    member: { select: { id: true, name: true } },
    invoice: { select: { id: true, number: true } },
    location: { select: { name: true } },
  } as const

  if (query.get('format') === 'csv') {
    const rows = await prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50_000, select })
    return csvResponse(
      'transactions',
      ['Transaction ID', 'Date', 'Member', 'Type', 'Status', 'Amount', 'Refunded', 'Method', 'Invoice', 'Location', 'Staff', 'Note'],
      rows.map((t) => [t.id, t.createdAt.toISOString(), t.member?.name, t.type, t.status, t.amountCents / 100, t.refundedCents / 100, t.method, t.invoice?.number, t.location?.name, t.staffName, t.failureReason || t.note])
    )
  }

  const [transactions, total, sums] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({ by: ['type', 'status'], where, _sum: { amountCents: true }, _count: { _all: true } }),
  ])
  const sum = (type: string, status: string) => sums.find((s) => s.type === type && s.status === status)
  return new Paginated(transactions, total, page, pageSize, {
    collectedCents: sum('payment', 'succeeded')?._sum.amountCents || 0,
    refundedCents: sum('refund', 'succeeded')?._sum.amountCents || 0,
    failedCents: sum('payment', 'failed')?._sum.amountCents || 0,
    failedCount: sum('payment', 'failed')?._count._all || 0,
  })
})
