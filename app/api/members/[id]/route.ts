import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { normalizeMemberStatus } from '@/lib/format'
import { memberUpdateSchema, updateMember } from '@/lib/services/members'
import { memberBalance } from '@/lib/services/payments'

export const dynamic = 'force-dynamic'

// GET /api/members/:id - full profile
export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params, can }) => {
  const member = await prisma.member.findFirst({
    where: { id: params.id, ownerId },
    include: {
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      homeLocation: { select: { id: true, name: true } },
      assignedStaff: { select: { id: true, name: true } },
      memberships: { orderBy: { createdAt: 'desc' }, include: { plan: { select: { id: true, name: true, type: true, billingInterval: true, intervalCount: true, freezeAllowed: true, contractMonths: true } } } },
      _count: { select: { checkins: true } },
    },
  })
  if (!member) throw notFound('Member')
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [visits30, upcoming, noShows, profile, balance, paid, qrCodeUrl] = await Promise.all([
    prisma.checkin.count({ where: { memberId: member.id, timestamp: { gte: since } } }),
    prisma.booking.count({ where: { memberId: member.id, status: { in: ['booked', 'offered', 'waitlisted'] }, session: { startsAt: { gt: new Date() } } } }),
    prisma.booking.count({ where: { memberId: member.id, status: 'no_show' } }),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { waiverEnabled: true } }),
    can('billing.view') ? memberBalance(ownerId, member.id) : null,
    can('billing.view')
      ? prisma.transaction.aggregate({ where: { ownerId, memberId: member.id, type: 'payment', status: 'succeeded' }, _sum: { amountCents: true, refundedCents: true } })
      : null,
    QRCode.toDataURL(member.qrCode, { width: 320, margin: 2 }),
  ])

  // Sensitive columns never leave the server.
  const { password: _p, waiverSignature, accessToken, stripeCustomerId, stripeSubscriptionId, _count, tags, ...rest } = member as typeof member & { password?: string }
  return {
    ...rest,
    status: normalizeMemberStatus(member.status),
    tags: tags.map((t) => t.tag),
    waiverEnabled: profile?.waiverEnabled || false,
    portalUrl: accessToken ? `/member/${accessToken}` : null,
    qrCodeUrl,
    stats: { totalVisits: _count.checkins, visitsLast30Days: visits30, upcomingBookings: upcoming, noShows },
    billing: balance && {
      ...balance,
      lifetimePaidCents: (paid?._sum.amountCents || 0) - (paid?._sum.refundedCents || 0),
    },
  }
})

// PATCH /api/members/:id - edit profile, set status, archive or restore
export const PATCH = handler({ permission: 'members.manage', write: true, body: memberUpdateSchema }, async ({ ownerId, params, body, actor, audit, can }) => {
  const { before, member, changed, archived } = await updateMember(ownerId, params.id, body, { actor, mayArchive: can('members.delete') })
  await audit(
    archived !== undefined ? (archived ? 'member.archive' : 'member.restore') : 'member.update',
    archived !== undefined ? `${archived ? 'Archived' : 'Restored'} ${member.name}` : `Updated ${member.name}${changed.length ? ` (${changed.join(', ')})` : ''}`,
    {
      entityType: 'member',
      entityId: member.id,
      before: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, (member as any)[k]])),
    }
  )
  return { id: member.id }
})

// DELETE /api/members/:id - permanent removal (archive is the usual route)
export const DELETE = handler({ permission: 'members.delete', write: true }, async ({ ownerId, params, audit }) => {
  const member = await prisma.member.findFirst({ where: { id: params.id, ownerId }, select: { id: true, name: true, email: true } })
  if (!member) throw notFound('Member')
  await prisma.member.delete({ where: { id: member.id } })
  await audit('member.delete', `Permanently deleted ${member.name}`, { entityType: 'member', entityId: member.id, before: member })
  return { deleted: true }
})
