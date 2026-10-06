import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { cents, dateInput, optionalText } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

const couponSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Use 3-30 letters, numbers, dashes or underscores'),
    description: optionalText(200),
    percentOff: z.number().int().min(1).max(100).nullish(),
    amountOffCents: cents.min(1).nullish(),
    appliesTo: z.enum(['all', 'memberships', 'products']).default('all'),
    maxRedemptions: z.number().int().min(1).max(100_000).nullish(),
    expiresAt: dateInput.nullish(),
  })
  .refine((c) => !!c.percentOff !== !!c.amountOffCents, { message: 'Set either a percentage or a fixed amount off' })

export const GET = handler({ permission: 'billing.view' }, async ({ ownerId }) =>
  prisma.coupon.findMany({ where: { ownerId }, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] })
)

export const POST = handler({ permission: 'billing.manage', write: true, body: couponSchema }, async ({ ownerId, body, audit }) => {
  const coupon = await prisma.coupon.create({ data: { ownerId, ...body } })
  await audit('coupon.create', `Created coupon ${coupon.code}`, { entityType: 'coupon', entityId: coupon.id, after: coupon })
  return coupon
})
