import { z } from 'zod'
import { ApiError, handler } from '@/lib/api'
import { collectInvoice } from '@/lib/services/collections'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

const schema = z.object({ paymentMethodId: z.string().uuid().nullish() })

// POST /api/billing/invoices/:id/charge - charge (or retry) the member's saved card or bank account
export const POST = handler(
  { permission: 'billing.manage', write: true, body: schema, rateLimit: { key: 'charge', windowMs: 60_000, maxRequests: 30 } },
  async ({ ownerId, params, body, actor, audit }) => {
    const result = await collectInvoice({ ownerId, invoiceId: params.id, paymentMethodId: body.paymentMethodId, actor })
    if (result.status === 'not_connected') throw new ApiError(409, result.message!, 'payments_not_connected')
    if (result.status === 'no_method') throw new ApiError(409, result.message!, 'no_payment_method')
    if (result.status === 'skipped') throw new ApiError(409, result.message!, 'nothing_to_collect')
    if (result.transactionId) {
      await audit(
        result.status === 'failed' ? 'payment.failed' : 'payment.charge',
        result.status === 'failed' ? `Charge of ${formatMoney(result.amountCents || 0)} failed: ${result.message}` : `Charged ${formatMoney(result.amountCents || 0)} to the payment method on file`,
        { entityType: 'transaction', entityId: result.transactionId, metadata: { invoiceId: params.id } }
      )
    }
    return result
  }
)
