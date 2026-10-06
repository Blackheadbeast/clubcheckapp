// One-time, idempotent upgrade of an account created before the platform
// models existed. Safe to run repeatedly: every step checks what is already there.

import { prisma } from '@/lib/prisma'
import { addMonths } from '@/lib/dates'

export interface BackfillOptions {
  /** Report what would change without writing anything. */
  dryRun: boolean
  /**
   * Also turn the old per-member "monthly fee + billing day" settings into real
   * recurring memberships. Off by default because it changes how those members
   * are billed: the old reminder emails stop and renewal invoices start.
   */
  convertManualBilling?: boolean
}

export interface BackfillResult {
  ownerId: string
  locationCreated: boolean
  paymentsCopied: number
  membershipsCreated: number
  plansCreated: number
}

const METHODS: Record<string, string> = { cash: 'cash', card: 'card', zelle: 'other', venmo: 'other', bank_transfer: 'ach', check: 'check', other: 'other' }

export async function backfillOwner(ownerId: string, options: BackfillOptions): Promise<BackfillResult> {
  const result: BackfillResult = { ownerId, locationCreated: false, paymentsCopied: 0, membershipsCreated: 0, plansCreated: 0 }
  const profile = await prisma.gymProfile.findUnique({ where: { ownerId } })

  // 1. Every account gets a first location so classes, check-ins and reports have somewhere to live.
  if ((await prisma.location.count({ where: { ownerId } })) === 0) {
    result.locationCreated = true
    if (!options.dryRun) await prisma.location.create({ data: { ownerId, name: profile?.name || 'Main location', address: profile?.address || null } })
  }

  // 2. Old PaymentRecord rows become Transactions so revenue reports include history.
  const copied = await prisma.transaction.findMany({ where: { ownerId, legacyPaymentId: { not: null } }, select: { legacyPaymentId: true } })
  const done = new Set(copied.map((t) => t.legacyPaymentId))
  const records = (await prisma.paymentRecord.findMany({ where: { ownerId } })).filter((r) => !done.has(r.id))
  result.paymentsCopied = records.length
  if (!options.dryRun && records.length) {
    for (let i = 0; i < records.length; i += 50) {
      await prisma.transaction.createMany({
        data: records.slice(i, i + 50).map((r) => ({
          ownerId, memberId: r.memberId, type: 'payment', status: 'succeeded', amountCents: r.amountCents, method: METHODS[r.method] || 'other',
          note: r.note || `Imported (${r.method})`, legacyPaymentId: r.id, createdAt: r.paidAt,
        })),
        skipDuplicates: true,
      })
    }
  }

  // 3. Optional: manual billing settings -> memberships.
  if (options.convertManualBilling) {
    const members = await prisma.member.findMany({
      where: { ownerId, billingEnabled: true, monthlyFeeCents: { gt: 0 }, status: { in: ['active', 'overdue'] }, memberships: { none: {} } },
      select: { id: true, monthlyFeeCents: true, billingDayOfMonth: true, paymentMethod: true, lastPaidAt: true, createdAt: true },
    })
    const fees = Array.from(new Set(members.map((m) => m.monthlyFeeCents!)))
    const plans = new Map<number, string>()
    for (const fee of fees) {
      const name = `Monthly membership ($${(fee / 100).toFixed(fee % 100 ? 2 : 0)})`
      const existing = await prisma.membershipPlan.findFirst({ where: { ownerId, name } })
      if (existing) plans.set(fee, existing.id)
      else {
        result.plansCreated++
        if (!options.dryRun) plans.set(fee, (await prisma.membershipPlan.create({ data: { ownerId, name, type: 'recurring', priceCents: fee, description: 'Carried over from manual billing.' } })).id)
      }
    }
    result.membershipsCreated = members.length
    if (!options.dryRun) {
      const now = new Date()
      for (const m of members) {
        // Next bill falls on their usual billing day: this month if still ahead, otherwise next month.
        const day = Math.min(28, m.billingDayOfMonth || now.getUTCDate())
        let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12))
        const paidThisMonth = m.lastPaidAt && m.lastPaidAt >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        if (next <= now || paidThisMonth) next = addMonths(next, 1)
        await prisma.$transaction([
          prisma.membership.create({
            data: {
              ownerId, memberId: m.id, planId: plans.get(m.monthlyFeeCents!)!, status: 'active', startDate: m.createdAt, priceCents: m.monthlyFeeCents!,
              paymentMethod: METHODS[m.paymentMethod || 'cash'] || 'cash', currentPeriodStart: addMonths(next, -1), currentPeriodEnd: next, lastBilledAt: m.lastPaidAt,
            },
          }),
          // The membership now drives billing; switch off the old reminder emails.
          prisma.member.update({ where: { id: m.id }, data: { billingEnabled: false, status: 'active' } }),
        ])
      }
    }
  }
  return result
}
