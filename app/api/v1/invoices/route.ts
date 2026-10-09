import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { invoiceOut } from '@/lib/public-api/serialize'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/v1/invoices?memberId=&membershipId=&status=&number=&createdSince=&updatedSince=   Read only.
export const GET = publicHandler({ scope: 'invoices:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const createdSince = dateParam(query, 'createdSince')
  const updatedSince = dateParam(query, 'updatedSince')
  const status = oneOf(query, 'status', ['draft', 'open', 'paid', 'void', 'uncollectible'] as const)
  const where: Prisma.InvoiceWhereInput = {
    ownerId,
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('membershipId') && { membershipId: query.get('membershipId')! }),
    ...(query.get('number') && { number: query.get('number')! }),
    ...(status && { status }),
    ...(createdSince && { createdAt: { gte: createdSince } }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
  }
  const [rows, total, settings] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: updatedSince ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }], skip, take, include: { items: true } }),
    prisma.invoice.count({ where }),
    getGymSettings(ownerId),
  ])
  return new Page(rows.map((r) => invoiceOut(r, settings.currency)), total, page, pageSize)
})
