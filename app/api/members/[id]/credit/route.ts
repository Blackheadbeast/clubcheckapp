import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { adjustCredit } from '@/lib/services/payments'
import { listCredits, setCreditAutoApply } from '@/lib/services/account-credit'
import { requestHash, withIdempotency } from '@/lib/services/idempotency'
import { lockRow } from '@/lib/services/core'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/credit - every credit on the account: what it was for, what is left, and where each part went
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, params }) => listCredits(prisma, ownerId, params.id))

const schema = z.object({
  amountCents: z.number().int().min(-1_000_000).max(1_000_000),
  note: z.string().trim().max(300).nullish(),
  /** Spend it automatically on the next membership invoice (the default), or hold it until staff use it. */
  autoApply: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
})

// POST - add account credit, or with a negative amount take some back
export const POST = handler({ permission: 'billing.refund', write: true, body: schema }, async ({ ownerId, params, body, actor, audit }) => {
  const { idempotencyKey, ...change } = body
  const { result, replayed } = await prisma.$transaction(async (db) => {
    await lockRow(db, 'Member', params.id)
    return withIdempotency(db, { ownerId, scope: 'credit', key: idempotencyKey, hash: requestHash({ m: params.id, ...change }) }, async () => {
      const before = (await listCredits(db, ownerId, params.id)).balanceCents
      const transaction = await adjustCredit(db, { ownerId, memberId: params.id, ...change, actor })
      return { transactionId: transaction.id, beforeCents: before, afterCents: before + change.amountCents }
    })
  })
  if (!replayed) {
    await audit('credit.adjust', `${body.amountCents > 0 ? 'Added' : 'Removed'} ${formatMoney(Math.abs(body.amountCents))} account credit${body.note ? `: ${body.note}` : ''}`, {
      entityType: 'member', entityId: params.id, before: { creditCents: result.beforeCents }, after: { creditCents: result.afterCents },
      metadata: { transactionId: result.transactionId, amountCents: body.amountCents, note: body.note, idempotencyKey },
    })
  }
  return { ...result, replayed }
})

// PATCH - hold one credit back from automatic use, or release it
export const PATCH = handler({ permission: 'billing.refund', write: true, body: z.object({ creditId: z.string().uuid(), autoApply: z.boolean() }) }, async ({ ownerId, params, body, audit }) => {
  const credit = await prisma.accountCredit.findFirst({ where: { id: body.creditId, ownerId, memberId: params.id }, select: { id: true } })
  if (!credit) return { updated: false }
  await setCreditAutoApply(prisma, { ownerId, creditId: credit.id, autoApply: body.autoApply })
  await audit('credit.hold', body.autoApply ? 'Released a credit for automatic use' : 'Held a credit back from automatic use', { entityType: 'member', entityId: params.id, metadata: { creditId: credit.id } })
  return { updated: true }
})
