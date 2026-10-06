import { prisma } from '@/lib/prisma'
import { Paginated, assertOwned, handler, paging } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params, query, can }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  const { page, pageSize, skip, take } = paging(query, 30)
  const type = query.get('type')
  // People without billing access do not see money on the timeline.
  const hidden = can('billing.view') ? [] : ['payment', 'payment_failed', 'refund', 'credit']
  const where = { ownerId, memberId: params.id, ...(type ? { type } : hidden.length ? { type: { notIn: hidden } } : {}) }
  const [items, total] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.activity.count({ where }),
  ])
  return new Paginated(items, total, page, pageSize)
})
