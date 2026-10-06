import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

// Invoices and transactions for the member's billing tab.
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  const [invoices, transactions] = await Promise.all([
    prisma.invoice.findMany({
      where: { ownerId, memberId: params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true, refundedCents: true, dueDate: true, paidAt: true, createdAt: true, items: { select: { description: true } } },
    }),
    prisma.transaction.findMany({
      where: { ownerId, memberId: params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, type: true, status: true, amountCents: true, refundedCents: true, method: true, failureReason: true, note: true, createdAt: true, invoice: { select: { number: true } } },
    }),
  ])
  return { invoices, transactions }
})
