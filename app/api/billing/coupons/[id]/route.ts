import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const PATCH = handler({ permission: 'billing.manage', write: true, body: z.object({ isActive: z.boolean() }) }, async ({ ownerId, params, body, audit }) => {
  const result = await prisma.coupon.updateMany({ where: { id: params.id, ownerId }, data: body })
  if (result.count === 0) throw notFound('Coupon')
  await audit('coupon.update', `${body.isActive ? 'Enabled' : 'Disabled'} a coupon`, { entityType: 'coupon', entityId: params.id })
  return { ok: true }
})

export const DELETE = handler({ permission: 'billing.manage', write: true }, async ({ ownerId, params, audit }) => {
  const coupon = await prisma.coupon.findFirst({ where: { id: params.id, ownerId } })
  if (!coupon) throw notFound('Coupon')
  await prisma.coupon.delete({ where: { id: coupon.id } })
  await audit('coupon.delete', `Deleted coupon ${coupon.code}`, { entityType: 'coupon', entityId: coupon.id, before: coupon })
  return { deleted: true }
})
