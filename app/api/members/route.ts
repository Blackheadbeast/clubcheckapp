import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { ApiError, Paginated, assertOwned, handler, paging } from '@/lib/api'
import { checkMemberLimit } from '@/lib/billing'
import { normalizeMemberStatus } from '@/lib/format'
import { balancesFor, createMember, memberFieldsSchema, memberOrder, memberWhere } from '@/lib/services/members'
import { LIVE_STATUSES } from '@/lib/services/memberships'

export const dynamic = 'force-dynamic'

// GET /api/members - paginated directory with search, filters and sort
export const GET = handler({ permission: 'members.view' }, async ({ ownerId, query, can }) => {
  const { page, pageSize, skip, take } = paging(query)
  const where = memberWhere(ownerId, query)
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
    prisma.member.groupBy({ by: ['status'], where: { ownerId, archivedAt: null }, _count: { _all: true } }),
    prisma.member.count({ where: { ownerId, archivedAt: { not: null } } }),
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
  const limit = await checkMemberLimit(ownerId)
  if (!limit.allowed) throw new ApiError(403, limit.error, 'member_limit')
  await assertOwned(ownerId, 'location', body.homeLocationId, 'Location')
  await assertOwned(ownerId, 'staff', body.assignedStaffId, 'Coach')

  const duplicate = await prisma.member.findFirst({ where: { ownerId, email: body.email, archivedAt: null }, select: { id: true, name: true } })
  if (duplicate) throw new ApiError(409, `${duplicate.name} already uses that email address.`, 'duplicate_email', { memberId: duplicate.id })

  const member = await prisma.$transaction((db) => createMember(db, ownerId, body, actor))
  await audit('member.create', `Added member ${member.name}`, { entityType: 'member', entityId: member.id })

  // Welcome email with their QR code. Delivery problems never fail the request.
  let emailSent = false
  try {
    const qrCodeUrl = await QRCode.toDataURL(member.qrCode, { width: 300, margin: 2 })
    const { sendMemberWelcomeEmail } = await import('@/lib/email')
    emailSent = (await sendMemberWelcomeEmail(member.email, member.name, qrCodeUrl, member.accessToken || undefined)).success
  } catch (error) {
    console.error('Welcome email failed:', error)
  }
  return { id: member.id, name: member.name, emailSent }
})
