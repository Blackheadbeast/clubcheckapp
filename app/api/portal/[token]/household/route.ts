import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { LIVE_STATUSES, intervalLabel } from '@/lib/services/memberships'
import { invoiceBalance } from '@/lib/services/payments'

export const dynamic = 'force-dynamic'

// GET - what the signed-in member may know about their household.
// Someone billed to another person learns only that person's first name. The payer sees what they are
// paying for: each person's plan and invoices. Nobody sees another member's bookings, visits, messages,
// contact details or notes here.
export const GET = portalHandler({}, async ({ member, ownerId }) => {
  if (!member.householdId) return { household: null }
  const household = await prisma.household.findFirst({ where: { id: member.householdId, ownerId }, select: { id: true, name: true, payerMemberId: true } })
  if (!household) return { household: null }
  if (household.payerMemberId !== member.id) {
    const payer = household.payerMemberId ? await prisma.member.findFirst({ where: { id: household.payerMemberId, ownerId, householdId: household.id }, select: { name: true } }) : null
    return { household: { name: household.name, role: 'member' as const, billedTo: payer ? payer.name.split(/\s+/)[0] : null, members: [] } }
  }
  const others = await prisma.member.findMany({
    where: { ownerId, householdId: household.id, id: { not: member.id } },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true,
      memberships: { where: { status: { in: LIVE_STATUSES } }, select: { status: true, priceCents: true, currentPeriodEnd: true, plan: { select: { name: true, type: true, billingInterval: true, intervalCount: true } } } },
      invoices: { where: { status: { in: ['open', 'paid'] } }, orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true, refundedCents: true, dueDate: true, createdAt: true, items: { select: { description: true }, take: 1 } } },
    },
  })
  return {
    household: {
      name: household.name, role: 'payer' as const, billedTo: null,
      members: others.map((m) => ({
        name: m.name,
        memberships: m.memberships.map((x) => ({ plan: x.plan.name, status: x.status, priceCents: x.priceCents, interval: intervalLabel(x.plan), nextBillingDate: x.plan.type === 'recurring' ? x.currentPeriodEnd : null })),
        amountDueCents: m.invoices.filter((i) => i.status === 'open').reduce((sum, i) => sum + invoiceBalance(i), 0),
        invoices: m.invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, totalCents: i.totalCents, balanceCents: i.status === 'open' ? invoiceBalance(i) : 0, refundedCents: i.refundedCents, dueDate: i.dueDate, createdAt: i.createdAt, description: i.items[0]?.description || null })),
      })),
    },
  }
})
