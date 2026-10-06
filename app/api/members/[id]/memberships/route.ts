import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { dateInput } from '@/lib/schemas'
import { sellMembership } from '@/lib/services/memberships'
import { flushOutbox } from '@/lib/services/automations'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

const sellSchema = z.object({
  planId: z.string().uuid(),
  startDate: dateInput.optional(),
  paymentMethod: z.enum(['card', 'cash', 'check', 'ach', 'other']),
  discountPercent: z.number().int().min(0).max(100).optional(),
  couponCode: z.string().trim().max(40).optional(),
  collectNow: z.boolean().optional(),
  skipTrial: z.boolean().optional(),
  locationId: z.string().uuid().nullish(),
})

// POST /api/members/:id/memberships - sell a membership, pack or drop-in
export const POST = handler({ permission: 'memberships.manage', write: true, body: sellSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await prisma.$transaction((db) => sellMembership(db, { ownerId, memberId: params.id, ...body, actor }), { timeout: 15_000 })
  await audit('membership.sell', `Sold ${result.plan.name}${result.invoice ? ` (${formatMoney(result.invoice.totalCents)})` : ''}`, {
    entityType: 'membership',
    entityId: result.membership.id,
    metadata: { memberId: params.id, planId: result.plan.id, invoiceId: result.invoice?.id },
  })
  await flushOutbox(ownerId)
  return { membershipId: result.membership.id, status: result.membership.status, invoice: result.invoice && { id: result.invoice.id, number: result.invoice.number, status: result.invoice.status, totalCents: result.invoice.totalCents } }
})
