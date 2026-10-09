import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Paginated, assertOwned, handler, paging } from '@/lib/api'
import { cents, dateInput, optionalText } from '@/lib/schemas'
import { createInvoice, quoteCoupon } from '@/lib/services/payments'
import { getGymSettings, logActivity } from '@/lib/services/core'
import { formatMoney } from '@/lib/format'
import { csvResponse } from '@/lib/csv'
import { effectiveLocation, homeScope } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

// GET /api/billing/invoices?status=&search=&overdue=1&format=csv
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, query, actor }) => {
  const { page, pageSize, skip, take } = paging(query)
  // Invoices carry no location of their own; they follow the member's home location.
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const home = scope.locationId ? { member: homeScope(scope) } : {}
  const status = query.get('status')
  const search = (query.get('search') || '').trim()
  const where: Prisma.InvoiceWhereInput = {
    ownerId,
    ...home,
    ...(status === 'overdue' ? { status: 'open', dueDate: { lt: new Date() } } : status && status !== 'all' ? { status } : {}),
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(search && { OR: [{ number: { contains: search, mode: 'insensitive' } }, { member: { name: { contains: search, mode: 'insensitive' } } }] }),
  }
  const select = {
    id: true, number: true, status: true, subtotalCents: true, discountCents: true, taxCents: true, totalCents: true, amountPaidCents: true,
    refundedCents: true, dueDate: true, paidAt: true, createdAt: true, attemptCount: true, nextAttemptAt: true,
    member: { select: { id: true, name: true } },
    items: { select: { description: true }, take: 1 },
  } as const

  if (query.get('format') === 'csv') {
    const rows = await prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20_000, select })
    return csvResponse(
      'invoices',
      ['Number', 'Member', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Refunded', 'Due', 'Created'],
      rows.map((i) => [i.number, i.member?.name, i.status, i.subtotalCents / 100, i.discountCents / 100, i.taxCents / 100, i.totalCents / 100, i.amountPaidCents / 100, i.refundedCents / 100, i.dueDate?.toISOString().slice(0, 10), i.createdAt.toISOString().slice(0, 10)])
    )
  }

  const [invoices, total, open] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { ownerId, status: 'open', ...home }, _sum: { totalCents: true, amountPaidCents: true }, _count: true }),
  ])
  return new Paginated(invoices, total, page, pageSize, {
    outstandingCents: (open._sum.totalCents || 0) - (open._sum.amountPaidCents || 0),
    openCount: open._count,
  })
})

const createSchema = z.object({
  memberId: z.string().uuid(),
  items: z
    .array(z.object({ description: z.string().trim().min(1, 'Describe each line').max(200), quantity: z.number().int().min(1).max(1000), unitPriceCents: cents, taxable: z.boolean().optional() }))
    .min(1, 'Add at least one line item')
    .max(50),
  discountCents: cents.optional(),
  couponCode: z.string().trim().max(40).optional(),
  dueDate: dateInput.optional(),
  notes: optionalText(1000),
})

// POST /api/billing/invoices - a one-off invoice
export const POST = handler({ permission: 'billing.manage', write: true, body: createSchema }, async ({ ownerId, body, actor, audit }) => {
  await assertOwned(ownerId, 'member', body.memberId, 'Member')
  const settings = await getGymSettings(ownerId)
  const invoice = await prisma.$transaction(async (db) => {
    const items = body.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, type: 'other', taxRateBps: i.taxable ? settings.defaultTaxRateBps : 0 }))
    const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0)
    const coupon = await quoteCoupon(db, ownerId, body.couponCode, 'products', subtotal)
    const created = await createInvoice(db, {
      ownerId, memberId: body.memberId, items, discountCents: (body.discountCents || 0) + (coupon?.discountCents || 0),
      couponCode: coupon?.code, dueDate: body.dueDate, notes: body.notes, actor,
    })
    await logActivity(db, {
      ownerId, memberId: body.memberId, type: 'invoice_created', title: `Invoice ${created.number} for ${formatMoney(created.totalCents)}`,
      detail: body.items[0].description, metadata: { invoiceId: created.id }, actor,
    })
    return created
  })
  await audit('invoice.create', `Created invoice ${invoice.number} for ${formatMoney(invoice.totalCents)}`, { entityType: 'invoice', entityId: invoice.id })
  return { id: invoice.id, number: invoice.number, totalCents: invoice.totalCents, status: invoice.status }
})
