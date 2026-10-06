import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, handler } from '@/lib/api'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

const bulkSchema = z
  .object({
    action: z.enum(['archive', 'restore', 'tag', 'untag', 'delete', 'assign_coach']),
    ids: z.array(z.string().uuid()).min(1, 'Select at least one member').max(500),
    tagId: z.string().uuid().optional(),
    staffId: z.string().uuid().nullish(),
  })
  .refine((d) => !['tag', 'untag'].includes(d.action) || !!d.tagId, { message: 'Choose a tag' })

// POST /api/members/bulk - apply one action to many members
export const POST = handler(
  { permission: 'members.manage', write: true, body: bulkSchema, rateLimit: { key: 'bulk', windowMs: 5 * 60_000, maxRequests: 20 } },
  async ({ ownerId, body, actor, audit, can }) => {
    const destructive = ['archive', 'restore', 'delete'].includes(body.action)
    if (destructive && !can('members.delete')) throw new ApiError(403, 'You do not have permission to do that.', 'forbidden')

    // Only ever touch members that belong to this account.
    const owned = await prisma.member.findMany({ where: { id: { in: body.ids }, ownerId }, select: { id: true } })
    const ids = owned.map((m) => m.id)
    if (ids.length === 0) return { affected: 0 }
    let affected = ids.length

    switch (body.action) {
      case 'archive':
      case 'restore': {
        const archive = body.action === 'archive'
        const result = await prisma.member.updateMany({ where: { id: { in: ids }, archivedAt: archive ? null : { not: null } }, data: { archivedAt: archive ? new Date() : null } })
        affected = result.count
        for (const memberId of ids) {
          await logActivity(prisma, { ownerId, memberId, type: archive ? 'archived' : 'restored', title: archive ? 'Archived' : 'Restored from archive', actor })
        }
        break
      }
      case 'tag':
        await assertOwned(ownerId, 'tag', body.tagId, 'Tag')
        affected = (await prisma.memberTag.createMany({ data: ids.map((memberId) => ({ memberId, tagId: body.tagId! })), skipDuplicates: true })).count
        break
      case 'untag':
        await assertOwned(ownerId, 'tag', body.tagId, 'Tag')
        affected = (await prisma.memberTag.deleteMany({ where: { memberId: { in: ids }, tagId: body.tagId } })).count
        break
      case 'assign_coach':
        await assertOwned(ownerId, 'staff', body.staffId, 'Coach')
        affected = (await prisma.member.updateMany({ where: { id: { in: ids } }, data: { assignedStaffId: body.staffId || null } })).count
        break
      case 'delete':
        affected = (await prisma.member.deleteMany({ where: { id: { in: ids }, ownerId } })).count
        break
    }
    await audit(`member.bulk_${body.action}`, `Bulk ${body.action.replace('_', ' ')} on ${ids.length} member${ids.length === 1 ? '' : 's'}`, {
      entityType: 'member', metadata: { ids, tagId: body.tagId, staffId: body.staffId },
    })
    return { affected }
  }
)
