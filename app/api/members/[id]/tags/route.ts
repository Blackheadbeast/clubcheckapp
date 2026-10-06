import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertAllOwned, assertOwned, handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

// Replace the member's tags with the given set.
export const PUT = handler(
  { permission: 'members.manage', write: true, body: z.object({ tagIds: z.array(z.string().uuid()).max(50) }) },
  async ({ ownerId, params, body }) => {
    await assertOwned(ownerId, 'member', params.id, 'Member')
    await assertAllOwned(ownerId, 'tag', body.tagIds, 'Tag')
    await prisma.$transaction([
      prisma.memberTag.deleteMany({ where: { memberId: params.id, tagId: { notIn: body.tagIds } } }),
      prisma.memberTag.createMany({ data: body.tagIds.map((tagId) => ({ memberId: params.id, tagId })), skipDuplicates: true }),
    ])
    return { tagIds: body.tagIds }
  }
)
