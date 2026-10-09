import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { invoiceOut } from '@/lib/public-api/serialize'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'invoices:read' }, async ({ ownerId, params }) => {
  const row = await prisma.invoice.findFirst({ where: { id: params.id, ownerId }, include: { items: true } })
  if (!row) throw notFound('Invoice')
  return invoiceOut(row, (await getGymSettings(ownerId)).currency)
})
