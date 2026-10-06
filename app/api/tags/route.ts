import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'members.view' }, async ({ ownerId }) => {
  const tags = await prisma.tag.findMany({ where: { ownerId }, orderBy: { name: 'asc' }, include: { _count: { select: { members: true } } } })
  return tags.map(({ _count, ...t }) => ({ ...t, memberCount: _count.members }))
})

export const POST = handler(
  {
    permission: 'members.manage',
    write: true,
    body: z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }),
  },
  async ({ ownerId, body }) => prisma.tag.create({ data: { ownerId, ...body } })
)
