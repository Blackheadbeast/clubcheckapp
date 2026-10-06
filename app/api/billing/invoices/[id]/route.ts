import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { voidInvoice } from '@/lib/services/payments'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, params }) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, ownerId },
    include: {
      member: { select: { id: true, name: true, email: true, creditBalanceCents: true } },
      items: true,
      transactions: { orderBy: { createdAt: 'asc' } },
      membership: { select: { id: true, plan: { select: { name: true } } } },
    },
  })
  if (!invoice) throw notFound('Invoice')
  return invoice
})

// POST { action: "void" }
export const POST = handler({ permission: 'billing.manage', write: true, body: z.object({ action: z.literal('void') }) }, async ({ ownerId, params, audit }) => {
  const invoice = await prisma.$transaction((db) => voidInvoice(db, ownerId, params.id))
  await audit('invoice.void', `Voided invoice ${invoice.number}`, { entityType: 'invoice', entityId: invoice.id })
  return { status: invoice.status }
})
