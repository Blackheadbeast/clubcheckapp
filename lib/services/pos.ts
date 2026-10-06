// Point of sale: product checkout, inventory movements and order refunds.

import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { Db, ActorRef, getGymSettings, lockRow, logActivity, nextNumber, notify } from './core'
import { PaymentMethod, computeTotals, createInvoice, quoteCoupon, recordPayment, refundTransaction } from './payments'

export interface CheckoutInput {
  ownerId: string
  items: { productId: string; quantity: number }[]
  memberId?: string | null
  paymentMethod: PaymentMethod
  couponCode?: string | null
  discountCents?: number
  locationId?: string | null
  actor?: ActorRef
}

export async function checkout(db: Db, input: CheckoutInput) {
  if (input.items.length === 0) throw badRequest('The cart is empty.')
  if (input.paymentMethod === 'account_credit' && !input.memberId) throw badRequest('Attach a member to pay with account credit.')
  // Merge duplicate lines, then lock products in a stable order so two tills cannot deadlock or oversell.
  const quantities = new Map<string, number>()
  for (const item of input.items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity)
  const ids = Array.from(quantities.keys()).sort()
  for (const id of ids) await lockRow(db, 'Product', id)

  const [products, settings, member] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids }, ownerId: input.ownerId } }),
    getGymSettings(input.ownerId, db),
    input.memberId ? db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId }, select: { id: true, name: true } }) : null,
  ])
  if (products.length !== ids.length) throw notFound('Product')
  if (input.memberId && !member) throw notFound('Member')

  const lines = products.map((p) => {
    const quantity = quantities.get(p.id)!
    if (!p.isActive) throw badRequest(`${p.name} is no longer for sale.`, 'product_inactive')
    if (p.trackInventory && p.stock < quantity) {
      throw new ApiError(409, p.stock === 0 ? `${p.name} is out of stock.` : `Only ${p.stock} of ${p.name} left in stock.`, 'out_of_stock', { productId: p.id, stock: p.stock })
    }
    return { product: p, quantity, taxRateBps: p.taxRateBps || settings.defaultTaxRateBps }
  })

  const invoiceItems = lines.map((l) => ({ description: l.product.name, type: 'product', quantity: l.quantity, unitPriceCents: l.product.priceCents, productId: l.product.id, taxRateBps: l.taxRateBps }))
  const subtotal = invoiceItems.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
  const coupon = await quoteCoupon(db, input.ownerId, input.couponCode, 'products', subtotal)
  const discount = Math.min(subtotal, (input.discountCents || 0) + (coupon?.discountCents || 0))
  const totals = computeTotals(invoiceItems, discount)
  const actor = input.actor
  const staffName = actor?.name || null

  const order = await db.order.create({
    data: {
      ownerId: input.ownerId,
      number: await nextNumber(db, input.ownerId, 'order'),
      memberId: member?.id || null,
      locationId: input.locationId || null,
      staffId: actor && (actor.type === 'staff' || actor.type === 'owner') ? actor.id || null : null,
      staffName,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      paymentMethod: input.paymentMethod,
      couponCode: coupon?.code || null,
      items: { create: lines.map((l) => ({ productId: l.product.id, name: l.product.name, quantity: l.quantity, unitPriceCents: l.product.priceCents, amountCents: l.quantity * l.product.priceCents })) },
    },
  })

  for (const l of lines) {
    if (!l.product.trackInventory) continue
    const updated = await db.product.update({ where: { id: l.product.id }, data: { stock: { decrement: l.quantity } } })
    await db.inventoryAdjustment.create({ data: { productId: l.product.id, delta: -l.quantity, reason: 'sale', note: order.number, staffName } })
    if (l.product.stock > l.product.lowStockThreshold && updated.stock <= l.product.lowStockThreshold) {
      await notify(db, { ownerId: input.ownerId, type: 'low_stock', title: `${l.product.name} is running low`, body: `${updated.stock} left in stock.`, href: '/pos/products?stock=low' })
    }
  }

  const invoice = await createInvoice(db, { ownerId: input.ownerId, memberId: member?.id, orderId: order.id, items: invoiceItems, discountCents: discount, couponCode: coupon?.code, actor })
  if (invoice.status === 'open') {
    await recordPayment(db, { ownerId: input.ownerId, invoiceId: invoice.id, method: input.paymentMethod, locationId: input.locationId, note: order.number, actor })
  }
  if (member) {
    await logActivity(db, {
      ownerId: input.ownerId, memberId: member.id, type: 'purchase', title: `Bought ${lines.map((l) => (l.quantity > 1 ? `${l.quantity}× ${l.product.name}` : l.product.name)).join(', ')}`,
      detail: `${order.number} · ${formatMoney(totals.totalCents)}`, metadata: { orderId: order.id }, actor,
    })
  }
  return { order, invoice, totals }
}

/** Refund a whole order: money back on every payment, and optionally the stock back on the shelf. */
export async function refundOrder(db: Db, input: { ownerId: string; orderId: string; restock: boolean; reason?: string | null; actor?: ActorRef }) {
  const order = await db.order.findFirst({ where: { id: input.orderId, ownerId: input.ownerId }, include: { items: true, invoice: { include: { transactions: true } } } })
  if (!order) throw notFound('Order')
  if (order.status === 'refunded') throw badRequest('This order has already been refunded.', 'already_refunded')
  let refunded = 0
  for (const t of order.invoice?.transactions || []) {
    if (t.type !== 'payment' || t.status !== 'succeeded' || t.refundedCents >= t.amountCents) continue
    const { refund } = await refundTransaction(db, { ownerId: input.ownerId, transactionId: t.id, reason: input.reason || `Refund of ${order.number}`, actor: input.actor })
    refunded += refund.amountCents
  }
  if (input.restock) {
    for (const item of order.items) {
      if (!item.productId) continue
      const product = await db.product.findUnique({ where: { id: item.productId } })
      if (!product?.trackInventory) continue
      await db.product.update({ where: { id: product.id }, data: { stock: { increment: item.quantity } } })
      await db.inventoryAdjustment.create({ data: { productId: product.id, delta: item.quantity, reason: 'refund', note: order.number, staffName: input.actor?.name || null } })
    }
  }
  const updated = await db.order.update({ where: { id: order.id }, data: { status: 'refunded' } })
  return { order: updated, refundedCents: refunded }
}

export async function adjustInventory(db: Db, input: { ownerId: string; productId: string; delta: number; reason: string; note?: string | null; actor?: ActorRef }) {
  await lockRow(db, 'Product', input.productId)
  const product = await db.product.findFirst({ where: { id: input.productId, ownerId: input.ownerId } })
  if (!product) throw notFound('Product')
  if (product.stock + input.delta < 0) throw badRequest(`That would take stock below zero (${product.stock} on hand).`)
  const updated = await db.product.update({ where: { id: product.id }, data: { stock: { increment: input.delta } } })
  await db.inventoryAdjustment.create({ data: { productId: product.id, delta: input.delta, reason: input.reason, note: input.note || null, staffName: input.actor?.name || null } })
  return { product: updated, before: product.stock }
}

export async function inventorySummary(ownerId: string) {
  const products = await prisma.product.findMany({ where: { ownerId, isActive: true }, select: { stock: true, costCents: true, priceCents: true, trackInventory: true, lowStockThreshold: true } })
  const tracked = products.filter((p) => p.trackInventory)
  return {
    products: products.length,
    lowStock: tracked.filter((p) => p.stock <= p.lowStockThreshold).length,
    outOfStock: tracked.filter((p) => p.stock === 0).length,
    costValueCents: tracked.reduce((s, p) => s + p.stock * p.costCents, 0),
    retailValueCents: tracked.reduce((s, p) => s + p.stock * p.priceCents, 0),
  }
}
