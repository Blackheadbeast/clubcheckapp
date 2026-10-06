import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { productSchema } from '@/lib/schemas'
import { inventorySummary } from '@/lib/services/pos'

export const dynamic = 'force-dynamic'

// GET /api/pos/products?q=&category=&stock=low&all=1
export const GET = handler({ permission: ['pos.sell', 'pos.manage'] }, async ({ ownerId, query, can }) => {
  const q = (query.get('q') || '').trim()
  const where: Prisma.ProductWhereInput = {
    ownerId,
    ...(query.get('all') !== '1' && { isActive: true }),
    ...(query.get('category') && { category: query.get('category')! }),
    ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] }),
  }
  let products = await prisma.product.findMany({ where, orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }], take: 1000 })
  if (query.get('stock') === 'low') products = products.filter((p) => p.trackInventory && p.stock <= p.lowStockThreshold)
  // Cost prices are for people who manage the catalogue, not everyone at the till.
  const shaped = can('pos.manage') ? products : products.map((p) => ({ ...p, costCents: undefined }))
  return { products: shaped, summary: can('pos.manage') ? await inventorySummary(ownerId) : null }
})

export const POST = handler({ permission: 'pos.manage', write: true, body: productSchema }, async ({ ownerId, body, actor, audit }) => {
  const product = await prisma.$transaction(async (db) => {
    const created = await db.product.create({ data: { ownerId, ...body } })
    if (created.trackInventory && created.stock > 0) {
      await db.inventoryAdjustment.create({ data: { productId: created.id, delta: created.stock, reason: 'restock', note: 'Opening stock', staffName: actor.name } })
    }
    return created
  })
  await audit('product.create', `Added product ${product.name}`, { entityType: 'product', entityId: product.id, after: product })
  return product
})
