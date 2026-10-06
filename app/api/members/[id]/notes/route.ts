import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler, notFound } from '@/lib/api'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const POST = handler(
  { permission: 'members.manage', write: true, body: z.object({ note: z.string().trim().min(1, 'Write a note first').max(4000) }) },
  async ({ ownerId, params, body, actor }) => {
    await assertOwned(ownerId, 'member', params.id, 'Member')
    await logActivity(prisma, { ownerId, memberId: params.id, type: 'note', title: 'Note', detail: body.note, actor })
    return { ok: true }
  }
)

export const DELETE = handler({ permission: 'members.manage', write: true }, async ({ ownerId, params, query }) => {
  const result = await prisma.activity.deleteMany({ where: { id: query.get('activityId') || '', ownerId, memberId: params.id, type: 'note' } })
  if (result.count === 0) throw notFound('Note')
  return { deleted: true }
})
