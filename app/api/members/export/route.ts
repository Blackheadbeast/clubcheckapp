import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { csvResponse } from '@/lib/csv'
import { memberOrder, memberWhere } from '@/lib/services/members'
import { LIVE_STATUSES } from '@/lib/services/memberships'

export const dynamic = 'force-dynamic'

// GET /api/members/export - CSV of the directory, honouring the current filters
export const GET = handler({ permission: 'members.delete', rateLimit: { key: 'export', windowMs: 5 * 60_000, maxRequests: 10 } }, async ({ ownerId, query, audit }) => {
  const members = await prisma.member.findMany({
    where: memberWhere(ownerId, query),
    orderBy: memberOrder(query),
    take: 20_000,
    select: {
      name: true, email: true, phone: true, status: true, createdAt: true, lastCheckInAt: true, dateOfBirth: true,
      addressLine1: true, city: true, state: true, postalCode: true, emergencyContactName: true, emergencyContactPhone: true,
      tags: { select: { tag: { select: { name: true } } } },
      memberships: { where: { status: { in: LIVE_STATUSES } }, take: 1, orderBy: { createdAt: 'desc' }, select: { plan: { select: { name: true } } } },
    },
  })
  await audit('export_data', `Exported ${members.length} members to CSV`, { entityType: 'member' })
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')
  return csvResponse(
    'members',
    ['Name', 'Email', 'Phone', 'Status', 'Membership', 'Tags', 'Joined', 'Last check-in', 'Date of birth', 'Address', 'City', 'State', 'Postal code', 'Emergency contact', 'Emergency phone'],
    members.map((m) => [
      m.name, m.email, m.phone, m.status, m.memberships[0]?.plan.name, m.tags.map((t) => t.tag.name).join('; '), day(m.createdAt), day(m.lastCheckInAt),
      day(m.dateOfBirth), m.addressLine1, m.city, m.state, m.postalCode, m.emergencyContactName, m.emergencyContactPhone,
    ])
  )
})
