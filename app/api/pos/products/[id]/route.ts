import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { productSchema } from '@/lib/schemas'
import { adjustInventory } from '@/lib/services/pos'

export const dynamic = 'force-dynamic'

// GET - product with its recent stock movements
export const GET = handler({ permission: 'pos.manage' }, async ({ ownerId, params }) => {
  const product = await prisma.product.findFirst({ where: { id: params.id, ownerId }, include: { adjustments: { orderBy: { createdAt: 'desc' }, take: 30 } } })
  if (!product) throw notFound('Product')
  return product
})

// PATCH - edit details. Stock changes go through POST so every movement is recorded.
export const PATCH = handler({ permission: 'pos.manage', write: true, body: productSchema.omit({ stock: true }).partial() }, async ({ ownerId, params, body, audit }) => {
  const before = await prisma.product.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Product')
  const product = await prisma.product.update({ where: { id: before.id }, data: body })
  await audit('product.update', `Updated product ${product.name}`, { entityType: 'product', entityId: product.id, before, after: product })
  return product
})

const adjustSchema = z.object({
  delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'Enter a quantity'),
  reason: z.enum(['restock', 'adjustment', 'shrinkage']),
  note: z.string().trim().max(200).nullish(),
})

// POST - receive stock or correct a count
export const POST = handler({ permission: 'pos.manage', write: true, body: adjustSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await prisma.$transaction((db) => adjustInventory(db, { ownerId, productId: params.id, ...body, actor }))
  await audit('inventory.adjust', `${result.product.name} stock ${body.delta > 0 ? '+' : ''}${body.delta} (${body.reason})`, {
    entityType: 'product', entityId: params.id, before: { stock: result.before }, after: { stock: result.product.stock },
  })
  return { stock: result.product.stock }
})

export const DELETE = handler({ permission: 'pos.manage', write: true }, async ({ ownerId, params, audit }) => {
  const product = await prisma.product.findFirst({ where: { id: params.id, ownerId } })
  if (!product) throw notFound('Product')
  const sold = await prisma.orderItem.count({ where: { productId: product.id } })
  if (sold > 0) {
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } })
    await audit('product.archive', `Retired product ${product.name}`, { entityType: 'product', entityId: product.id })
    return { deleted: false, archived: true }
  }
  await prisma.product.delete({ where: { id: product.id } })
  await audit('product.delete', `Deleted product ${product.name}`, { entityType: 'product', entityId: product.id, before: product })
  return { deleted: true, archived: false }
})
