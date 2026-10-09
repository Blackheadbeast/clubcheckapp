import { prisma } from '@/lib/prisma'
import { ApiError, handler, notFound } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const DELETE = handler({ permission: null, write: true }, async ({ ownerId, params, actor, can }) => {
  const row = await prisma.staffTimeOff.findFirst({ where: { id: params.id, ownerId } })
  if (!row) throw notFound('Time off')
  if (!can('appointments.configure') && !(actor.type === 'staff' && actor.id === row.staffId)) throw new ApiError(403, 'You do not have permission to do that.', 'forbidden')
  await prisma.staffTimeOff.delete({ where: { id: row.id } })
  return { deleted: true }
})
