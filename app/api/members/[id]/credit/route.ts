import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { adjustCredit } from '@/lib/services/payments'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

export const POST = handler(
  {
    permission: 'billing.refund',
    write: true,
    body: z.object({ amountCents: z.number().int().min(-1_000_000).max(1_000_000), note: z.string().trim().max(300).nullish() }),
  },
  async ({ ownerId, params, body, actor, audit }) => {
    const transaction = await prisma.$transaction((db) => adjustCredit(db, { ownerId, memberId: params.id, ...body, actor }))
    await audit('credit.adjust', `${body.amountCents > 0 ? 'Added' : 'Removed'} ${formatMoney(Math.abs(body.amountCents))} account credit`, {
      entityType: 'member', entityId: params.id, metadata: { transactionId: transaction.id, note: body.note },
    })
    return { transactionId: transaction.id }
  }
)
