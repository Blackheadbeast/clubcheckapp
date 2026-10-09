import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { collectInvoice } from '@/lib/services/collections'
import { billingPayer } from '@/lib/services/households'

export const dynamic = 'force-dynamic'

// POST - the member pays one of their own open invoices with a saved method
export const POST = portalHandler({ write: true, body: z.object({ paymentMethodId: z.string().uuid().nullish() }) }, async ({ member, ownerId, params, body, actor }) => {
  // Their own invoice, or one for somebody whose bills they pay as the household payer.
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, ownerId }, select: { id: true, memberId: true } })
  if (!invoice || !invoice.memberId) throw notFound('Invoice')
  const payer = await billingPayer(prisma, ownerId, invoice.memberId)
  if (invoice.memberId !== member.id) {
    if (!payer.viaHousehold || payer.payerId !== member.id) throw notFound('Invoice')
  } else if (payer.viaHousehold) {
    // Their bills go to someone else's card. Only that person can decide to pay.
    throw new ApiError(403, 'This is billed to the person who pays for your household. They can pay it from their own account.', 'billed_to_payer')
  }
  const result = await collectInvoice({ ownerId, invoiceId: invoice.id, paymentMethodId: body.paymentMethodId, actor })
  if (result.status === 'not_connected') throw new ApiError(409, 'Online payments are not available. Please pay at the front desk.', 'payments_not_connected')
  if (result.status === 'no_method') throw new ApiError(409, 'Add a card or bank account first.', 'no_payment_method')
  if (result.status === 'skipped') throw new ApiError(409, 'This invoice has nothing left to pay.', 'nothing_to_collect')
  return { status: result.status, message: result.message || null }
})
