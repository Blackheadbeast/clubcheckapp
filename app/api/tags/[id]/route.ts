import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const DELETE = handler({ permission: 'members.manage', write: true }, async ({ ownerId, params }) => {
  const result = await prisma.tag.deleteMany({ where: { id: params.id, ownerId } })
  if (result.count === 0) throw notFound('Tag')
  return { deleted: true }
})
