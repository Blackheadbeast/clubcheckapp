import { prisma } from '@/lib/prisma'
import { Page, pageOf, publicHandler } from '@/lib/public-api/handler'
import { planOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/membership-plans?active= - what a membership can be sold on
export const GET = publicHandler({ scope: 'memberships:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const where = { ownerId, ...(query.get('active') === 'false' ? {} : { isActive: true }) }
  const [rows, total] = await Promise.all([prisma.membershipPlan.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], skip, take }), prisma.membershipPlan.count({ where })])
  return new Page(rows.map(planOut), total, page, pageSize)
})
