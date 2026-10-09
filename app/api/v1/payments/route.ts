import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { paymentOut } from '@/lib/public-api/serialize'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/v1/payments?memberId=&invoiceId=&type=&status=&method=&createdSince=&createdBefore=&processorReference=
// Read only. Payments, refunds and failed attempts, newest first (oldest first with createdSince).
export const GET = publicHandler({ scope: 'payments:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const since = dateParam(query, 'createdSince')
  const before = dateParam(query, 'createdBefore')
  const type = oneOf(query, 'type', ['payment', 'refund'] as const)
  const status = oneOf(query, 'status', ['succeeded', 'failed', 'pending', 'processing'] as const)
  const where: Prisma.TransactionWhereInput = {
    ownerId,
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('invoiceId') && { invoiceId: query.get('invoiceId')! }),
    ...(query.get('method') && { method: query.get('method')! }),
    // A processor's own id (a Stripe payment intent, say) finds the payment only inside this gym.
    ...(query.get('processorReference') && { providerReference: query.get('processorReference')! }),
    ...(type && { type }),
    ...(status && { status }),
    ...((since || before) && { createdAt: { ...(since && { gte: since }), ...(before && { lt: before }) } }),
  }
  const [rows, total, settings] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: since ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
    prisma.transaction.count({ where }),
    getGymSettings(ownerId),
  ])
  return new Page(rows.map((r) => paymentOut(r, settings.currency)), total, page, pageSize)
})
