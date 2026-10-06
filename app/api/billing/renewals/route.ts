import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { runMembershipBilling } from '@/lib/services/memberships'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

// GET - recurring memberships in billing-date order (the "membership billing" screen)
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId }) => {
  const memberships = await prisma.membership.findMany({
    where: { ownerId, status: { in: ['active', 'trial', 'past_due', 'frozen'] }, plan: { type: 'recurring' } },
    orderBy: { currentPeriodEnd: 'asc' },
    take: 500,
    select: {
      id: true, status: true, priceCents: true, paymentMethod: true, currentPeriodEnd: true, autoRenew: true, cancelAt: true, trialEndsAt: true,
      failedPaymentCount: true, freezeEndsAt: true,
      member: { select: { id: true, name: true } },
      plan: { select: { name: true, billingInterval: true, intervalCount: true } },
    },
  })
  const monthly = (m: (typeof memberships)[number]) => {
    const per = m.plan.billingInterval === 'week' ? 52 / 12 : m.plan.billingInterval === 'year' ? 1 / 12 : 1
    return (m.priceCents * per) / m.plan.intervalCount
  }
  const billable = memberships.filter((m) => ['active', 'past_due'].includes(m.status) && m.autoRenew && !m.cancelAt)
  return { memberships, mrrCents: Math.round(billable.reduce((sum, m) => sum + monthly(m), 0)), billableCount: billable.length }
})

// POST - run the billing cycle now instead of waiting for the daily job
export const POST = handler(
  { permission: 'billing.manage', write: true, body: z.object({}).optional(), rateLimit: { key: 'billing-run', windowMs: 60_000, maxRequests: 4 } },
  async ({ ownerId, audit }) => {
    const summary = await runMembershipBilling(ownerId)
    await flushOutbox(ownerId)
    await audit('billing.run', `Ran membership billing: ${summary.invoicesCreated} invoices created`, { metadata: { ...summary } })
    return summary
  }
)
