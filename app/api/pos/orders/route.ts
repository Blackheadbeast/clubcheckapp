import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Paginated, assertOwned, handler, paging } from '@/lib/api'
import { resolveRange } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import { checkout } from '@/lib/services/pos'
import { getGymSettings } from '@/lib/services/core'
import { effectiveLocation } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: ['pos.sell', 'pos.manage'] }, async ({ ownerId, query, actor }) => {
  const { page, pageSize, skip, take } = paging(query)
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const settings = await getGymSettings(ownerId)
  const range = query.get('range') ? resolveRange(query.get('range'), query.get('from'), query.get('to'), settings.timezone) : null
  const search = (query.get('search') || '').trim()
  const where: Prisma.OrderWhereInput = {
    ownerId,
    ...(range && { createdAt: { gte: range.start, lt: range.end } }),
    ...(scope.locationId && { locationId: scope.locationId }),
    ...(search && { OR: [{ number: { contains: search, mode: 'insensitive' } }, { member: { name: { contains: search, mode: 'insensitive' } } }] }),
  }
  const [orders, total, sums] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: { createdAt: 'desc' }, skip, take,
      select: { id: true, number: true, status: true, totalCents: true, paymentMethod: true, staffName: true, createdAt: true, member: { select: { id: true, name: true } }, items: { select: { name: true, quantity: true } }, location: { select: { name: true } } },
    }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where: { ...where, status: 'completed' }, _sum: { totalCents: true }, _count: true }),
  ])
  return new Paginated(orders, total, page, pageSize, { salesCents: sums._sum.totalCents || 0, completed: sums._count })
})

const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(999) })).min(1, 'The cart is empty').max(100),
  memberId: z.string().uuid().nullish(),
  paymentMethod: z.enum(['card', 'cash', 'check', 'account_credit', 'other']),
  couponCode: z.string().trim().max(40).optional(),
  discountCents: z.number().int().min(0).max(100_000_000).optional(),
  locationId: z.string().uuid().nullish(),
})

// POST /api/pos/orders - ring up a sale
export const POST = handler({ permission: 'pos.sell', write: true, body: checkoutSchema }, async ({ ownerId, body, actor, audit, can }) => {
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  // Ad-hoc discounts need the same authority as refunds; coupons are fine for anyone at the till.
  const discountCents = can('billing.refund') ? body.discountCents : 0
  // A sale rung up by staff locked to a location is recorded there.
  const till = await effectiveLocation(ownerId, actor, body.locationId)
  const result = await prisma.$transaction((db) => checkout(db, { ownerId, ...body, ...(till.locked && { locationId: till.locationId }), discountCents, actor }), { timeout: 20_000 })
  await audit('order.create', `Sale ${result.order.number} for ${formatMoney(result.totals.totalCents)}`, { entityType: 'order', entityId: result.order.id })
  return { id: result.order.id, number: result.order.number, ...result.totals }
})
