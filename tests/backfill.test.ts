import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { backfillOwner } from '@/lib/services/backfill'
import { runMembershipBilling } from '@/lib/services/memberships'
import { DAY, createGym, createMember, destroyGym } from './helpers'

let ownerId: string
beforeAll(async () => { ownerId = await createGym() })
afterAll(async () => { await destroyGym(ownerId) })

describe('upgrading an existing account', () => {
  it('reports in a dry run, applies once, and is idempotent', async () => {
    const member = await createMember(ownerId, { billingEnabled: true, monthlyFeeCents: 7500, billingDayOfMonth: 15, paymentMethod: 'zelle' })
    const plain = await createMember(ownerId)
    await prisma.paymentRecord.createMany({
      data: [
        { ownerId, memberId: member.id, amountCents: 7500, method: 'zelle', paidAt: new Date(Date.now() - 40 * DAY) },
        { ownerId, memberId: member.id, amountCents: 7500, method: 'cash', paidAt: new Date(Date.now() - 70 * DAY) },
      ],
    })

    const dry = await backfillOwner(ownerId, { dryRun: true, convertManualBilling: true })
    expect(dry).toMatchObject({ locationCreated: true, paymentsCopied: 2, membershipsCreated: 1, plansCreated: 1 })
    expect(await prisma.transaction.count({ where: { ownerId } })).toBe(0)
    expect(await prisma.location.count({ where: { ownerId } })).toBe(0)

    // Default run leaves manual billing alone
    const basic = await backfillOwner(ownerId, { dryRun: false })
    expect(basic).toMatchObject({ locationCreated: true, paymentsCopied: 2, membershipsCreated: 0 })
    expect(await prisma.membership.count({ where: { ownerId } })).toBe(0)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).billingEnabled).toBe(true)

    const full = await backfillOwner(ownerId, { dryRun: false, convertManualBilling: true })
    expect(full).toMatchObject({ locationCreated: false, paymentsCopied: 0, membershipsCreated: 1, plansCreated: 1 })
    const membership = await prisma.membership.findFirstOrThrow({ where: { memberId: member.id } })
    expect(membership).toMatchObject({ status: 'active', priceCents: 7500, paymentMethod: 'other' })
    expect(membership.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now())
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).billingEnabled).toBe(false)
    expect(await prisma.membership.count({ where: { memberId: plain.id } })).toBe(0)

    const again = await backfillOwner(ownerId, { dryRun: false, convertManualBilling: true })
    expect(again).toMatchObject({ locationCreated: false, paymentsCopied: 0, membershipsCreated: 0, plansCreated: 0 })
    expect(await prisma.transaction.count({ where: { ownerId } })).toBe(2)

    // Converting must not bill anyone immediately: the first invoice is raised on their next billing day
    const summary = await runMembershipBilling(ownerId)
    expect(summary.invoicesCreated).toBe(0)
  })
})
