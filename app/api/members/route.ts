import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { normalizeMemberStatus } from '@/lib/format'
import { addMember, balancesFor, memberFieldsSchema, memberOrder, memberWhere } from '@/lib/services/members'
import { LIVE_STATUSES } from '@/lib/services/memberships'
import { effectiveLocation, homeScope } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

// GET /api/members - paginated directory with search, filters and sort
export const GET = handler({ permission: 'members.view' }, async ({ ownerId, query, can, actor }) => {
  const { page, pageSize, skip, take } = paging(query)
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const home = homeScope(scope)
  const where = memberWhere(ownerId, query, home)
  const [members, total, statusCounts, archived] = await Promise.all([
    prisma.member.findMany({
      where,
      orderBy: memberOrder(query),
      skip,
      take,
      select: {
        id: true, name: true, email: true, phone: true, photoUrl: true, status: true, createdAt: true, lastCheckInAt: true,
        archivedAt: true, waiverSignedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        homeLocation: { select: { id: true, name: true } },
        assignedStaff: { select: { id: true, name: true } },
        memberships: { where: { status: { in: LIVE_STATUSES } }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, plan: { select: { name: true } } } },
      },
    }),
    prisma.member.count({ where }),
    prisma.member.groupBy({ by: ['status'], where: { ownerId, archivedAt: null, ...(scope.locked && home) }, _count: { _all: true } }),
    prisma.member.count({ where: { ownerId, archivedAt: { not: null }, ...(scope.locked && home) } }),
  ])
  const balances = can('billing.view') ? await balancesFor(ownerId, members.map((m) => m.id)) : new Map<string, number>()

  const counts: Record<string, number> = { all: 0, archived }
  for (const row of statusCounts) {
    const key = normalizeMemberStatus(row.status)
    counts[key] = (counts[key] || 0) + row._count._all
    counts.all += row._count._all
  }

  return new Paginated(
    members.map(({ tags, memberships, ...m }) => ({
      ...m,
      status: normalizeMemberStatus(m.status),
      tags: tags.map((t) => t.tag),
      membership: memberships[0]?.plan.name || null,
      balanceCents: balances.get(m.id) ?? (can('billing.view') ? 0 : null),
    })),
    total,
    page,
    pageSize,
    { counts }
  )
})

// POST /api/members - create a member
export const POST = handler({ permission: 'members.manage', write: true, body: memberFieldsSchema }, async ({ ownerId, body, actor, audit }) => {
  const { member, emailSent } = await addMember(ownerId, body, actor)
  await audit('member.create', `Added member ${member.name}`, { entityType: 'member', entityId: member.id })
  return { id: member.id, name: member.name, emailSent }
})
