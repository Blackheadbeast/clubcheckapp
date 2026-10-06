import { z } from 'zod'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, badRequest, handler, notFound } from '@/lib/api'
import { normalizeMemberStatus } from '@/lib/format'
import { memberData, memberFieldsSchema } from '@/lib/services/members'
import { memberBalance } from '@/lib/services/payments'
import { logActivity } from '@/lib/services/core'

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

const patchSchema = memberFieldsSchema.partial().extend({
  status: z.enum(['active', 'trial', 'past_due', 'frozen', 'cancelled', 'inactive']).optional(),
  archived: z.boolean().optional(),
})

// PATCH /api/members/:id - edit profile, set status, archive or restore
export const PATCH = handler({ permission: 'members.manage', write: true, body: patchSchema }, async ({ ownerId, params, body, actor, audit, can }) => {
  const before = await prisma.member.findFirst({ where: { id: params.id, ownerId }, include: { _count: { select: { memberships: true } } } })
  if (!before) throw notFound('Member')
  const { status, archived, ...fields } = body
  if (archived !== undefined && !can('members.delete')) throw new ApiError(403, 'You do not have permission to archive members.', 'forbidden')
  if (status && before._count.memberships > 0) {
    throw badRequest("This member's status follows their membership. Freeze or cancel the membership instead.", 'status_derived')
  }
  await assertOwned(ownerId, 'location', fields.homeLocationId, 'Location')
  await assertOwned(ownerId, 'staff', fields.assignedStaffId, 'Coach')
  if (fields.email && fields.email !== before.email) {
    const clash = await prisma.member.findFirst({ where: { ownerId, email: fields.email, archivedAt: null, id: { not: before.id } }, select: { name: true } })
    if (clash) throw new ApiError(409, `${clash.name} already uses that email address.`, 'duplicate_email')
  }

  const member = await prisma.$transaction(async (db) => {
    const updated = await db.member.update({
      where: { id: before.id },
      data: {
        ...memberData(fields),
        ...(status && { status }),
        ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
      },
    })
    if (status && status !== before.status) {
      await logActivity(db, { ownerId, memberId: before.id, type: 'status_changed', title: `Status changed to ${status.replace('_', ' ')}`, actor })
    }
    if (archived !== undefined && !!before.archivedAt !== archived) {
      await logActivity(db, { ownerId, memberId: before.id, type: archived ? 'archived' : 'restored', title: archived ? 'Archived' : 'Restored from archive', actor })
    }
    return updated
  })

  const changed = Object.keys(fields).filter((k) => String((before as any)[k] ?? '') !== String((member as any)[k] ?? ''))
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
