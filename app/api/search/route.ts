import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

interface Hit {
  type: 'member' | 'lead' | 'class' | 'invoice' | 'product'
  id: string
  title: string
  subtitle: string
  href: string
}

// Global search across everything the caller is allowed to see.
export const GET = handler({ permission: null }, async ({ ownerId, query, can }) => {
  const q = (query.get('q') || '').trim()
  if (q.length < 2) return []
  const contains = { contains: q, mode: 'insensitive' as const }
  const take = 5

  const [members, leads, classes, invoices, products] = await Promise.all([
    can('members.view')
      ? prisma.member.findMany({
          where: { ownerId, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
          orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
          select: { id: true, name: true, email: true, status: true, archivedAt: true },
          take: 6,
        })
      : [],
    can('leads.view')
      ? prisma.prospect.findMany({
          where: { ownerId, status: { not: 'converted' }, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
          select: { id: true, name: true, email: true, status: true },
          take,
        })
      : [],
    can('classes.view')
      ? prisma.classType.findMany({ where: { ownerId, isActive: true, name: contains }, select: { id: true, name: true, category: true }, take })
      : [],
    can('billing.view')
      ? prisma.invoice.findMany({
          where: { ownerId, OR: [{ number: contains }, { member: { name: contains } }] },
          orderBy: { createdAt: 'desc' },
          select: { id: true, number: true, totalCents: true, status: true, member: { select: { name: true } } },
          take,
        })
      : [],
    can('pos.sell') || can('pos.manage')
      ? prisma.product.findMany({ where: { ownerId, isActive: true, OR: [{ name: contains }, { sku: contains }] }, select: { id: true, name: true, sku: true, priceCents: true }, take })
      : [],
  ])

  const hits: Hit[] = [
    ...members.map((m) => ({ type: 'member' as const, id: m.id, title: m.name, subtitle: `${m.archivedAt ? 'Archived' : m.status.replace('_', ' ')} · ${m.email}`, href: `/members/${m.id}` })),
    ...leads.map((l) => ({ type: 'lead' as const, id: l.id, title: l.name, subtitle: `Lead · ${l.status.replace('_', ' ')}`, href: `/leads?lead=${l.id}` })),
    ...classes.map((c) => ({ type: 'class' as const, id: c.id, title: c.name, subtitle: 'Class', href: `/schedule?classTypeId=${c.id}` })),
    ...invoices.map((i) => ({ type: 'invoice' as const, id: i.id, title: i.number, subtitle: `${formatMoney(i.totalCents)} · ${i.status}${i.member ? ` · ${i.member.name}` : ''}`, href: `/billing/invoices?invoice=${i.id}` })),
    ...products.map((p) => ({ type: 'product' as const, id: p.id, title: p.name, subtitle: `${formatMoney(p.priceCents)}${p.sku ? ` · ${p.sku}` : ''}`, href: `/pos/products?q=${encodeURIComponent(p.name)}` })),
  ]
  return hits
})
