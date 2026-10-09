import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { paymentOut } from '@/lib/public-api/serialize'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'payments:read' }, async ({ ownerId, params }) => {
  const row = await prisma.transaction.findFirst({ where: { id: params.id, ownerId } })
  if (!row) throw notFound('Payment')
  return paymentOut(row, (await getGymSettings(ownerId)).currency)
})
