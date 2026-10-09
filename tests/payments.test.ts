import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { setPaymentProviderForTests, type ChargeRequest, type ChargeResult, type PaymentProvider } from '@/lib/payments/provider'
import { collectInvoice, recordDispute, recordExternalRefund, refundPayment, runCollections, settlePayment } from '@/lib/services/collections'
import { runMembershipBilling, sellMembership } from '@/lib/services/memberships'
import { recordPayment } from '@/lib/services/payments'
import { DAY, createGym, createMember, createPlan, destroyGym, tx } from './helpers'

// A stand-in for Stripe: returns whatever outcome the test queues and remembers every call.
class FakeProcessor implements PaymentProvider {
  name = 'stripe'
  canAutoCharge = true
  charges: ChargeRequest[] = []
  refunds: { reference: string; amountCents: number }[] = []
  next: ChargeResult['status'][] = []
  private seen = new Map<string, ChargeResult>()

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    // Like the real thing, the same idempotency key returns the same payment.
    const repeat = this.seen.get(request.idempotencyKey)
    if (repeat) return repeat
    this.charges.push(request)
    const outcome = this.next.shift() || 'succeeded'
    const reference = `pi_${randomUUID()}`
    const result: ChargeResult =
      outcome === 'failed' ? { status: 'failed', reference, failureReason: 'Your card was declined.' }
      : outcome === 'processing' ? { status: 'processing', reference }
      : outcome === 'requires_manual' ? { status: 'requires_manual' }
      : { status: 'succeeded', reference }
    this.seen.set(request.idempotencyKey, result)
    return result
  }

  async refund(input: { reference: string; amountCents: number }) {
    this.refunds.push(input)
    return { status: 'succeeded' as const, reference: `re_${randomUUID()}` }
  }
}

let ownerId: string
let processor: FakeProcessor
beforeAll(async () => { ownerId = await createGym() })
afterAll(async () => { setPaymentProviderForTests(null); await destroyGym(ownerId) })
beforeEach(() => { processor = new FakeProcessor(); setPaymentProviderForTests(processor) })
afterEach(() => setPaymentProviderForTests(null))

async function memberWithCard(owner = ownerId, type: 'card' | 'us_bank_account' = 'card') {
  const member = await createMember(owner, { connectCustomerId: `cus_${randomUUID()}` })
  const method = await prisma.paymentMethod.create({
    data: { ownerId: owner, memberId: member.id, providerId: `pm_${randomUUID()}`, type, brand: type === 'card' ? 'visa' : null, last4: '4242', isDefault: true },
  })
  return { member, method }
}

async function sell(memberId: string, paymentMethod: 'card' | 'ach' | 'cash' = 'card', owner = ownerId) {
  const plan = await createPlan(owner)
  const sale = await tx((db) => sellMembership(db, { ownerId: owner, memberId, planId: plan.id, paymentMethod }))
  return { plan, membership: sale.membership, invoice: sale.invoice! }
}

const invoiceWithTx = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id }, include: { transactions: { orderBy: { createdAt: 'asc' } } } })

describe('charging a saved payment method', () => {
  it('charges the default card and marks the invoice paid', async () => {
    const { member, method } = await memberWithCard()
    const { invoice } = await sell(member.id)
    const result = await collectInvoice({ ownerId, invoiceId: invoice.id })
    expect(result.status).toBe('succeeded')
    expect(processor.charges).toHaveLength(1)
    expect(processor.charges[0]).toMatchObject({ amountCents: 15000, customerRef: member.connectCustomerId, paymentMethodRef: method.providerId })
    const paid = await invoiceWithTx(invoice.id)
    expect(paid.status).toBe('paid')
    expect(paid.transactions).toHaveLength(1)
    expect(paid.transactions[0]).toMatchObject({ status: 'succeeded', provider: 'stripe', method: 'card', cardLast4: '4242', paymentMethodId: method.id })
    expect(paid.transactions[0].providerReference).toMatch(/^pi_/)
  })

  it('does not charge when there is nothing on file, or nothing owed', async () => {
    const member = await createMember(ownerId)
    const { invoice } = await sell(member.id)
    expect((await collectInvoice({ ownerId, invoiceId: invoice.id })).status).toBe('no_method')
    await tx((db) => recordPayment(db, { ownerId, invoiceId: invoice.id, method: 'cash' }))
    expect((await collectInvoice({ ownerId, invoiceId: invoice.id })).status).toBe('skipped')
    expect(processor.charges).toHaveLength(0)
  })

  it('reports not connected when the gym has no processor', async () => {
    setPaymentProviderForTests(null)
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id)
    expect((await collectInvoice({ ownerId, invoiceId: invoice.id })).status).toBe('not_connected')
    expect((await invoiceWithTx(invoice.id)).status).toBe('open')
  })
})

describe('failed payments', () => {
  it('records the decline, moves the membership past due, then recovers on retry', async () => {
    const { member } = await memberWithCard()
    const { invoice, membership } = await sell(member.id)
    processor.next = ['failed']
    const first = await collectInvoice({ ownerId, invoiceId: invoice.id })
    expect(first).toMatchObject({ status: 'failed', message: 'Your card was declined.' })

    let state = await invoiceWithTx(invoice.id)
    expect(state.status).toBe('open')
    expect(state.attemptCount).toBe(1)
    expect(Math.round((state.nextAttemptAt!.getTime() - Date.now()) / DAY)).toBe(3)
    expect(state.transactions[0]).toMatchObject({ status: 'failed', failureReason: 'Your card was declined.' })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('past_due')

    // Other tests share this gym, so count the attempts on this invoice only.
    const attempts = () => processor.charges.filter((c) => c.invoiceId === invoice.id).length
    // Not due for a retry yet.
    await runCollections(ownerId, new Date(Date.now() + DAY))
    expect(attempts()).toBe(1)
    const retry = await runCollections(ownerId, new Date(Date.now() + 4 * DAY))
    expect(retry.errors).toEqual([])
    state = await invoiceWithTx(invoice.id)
    expect(state.status).toBe('paid')
    expect(state.nextAttemptAt).toBeNull()
    expect(attempts()).toBe(2)
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('active')
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('active')
  })

  it('stops retrying after the fourth failed attempt', async () => {
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id)
    processor.next = ['failed', 'failed', 'failed', 'failed']
    for (let i = 0; i < 4; i++) await collectInvoice({ ownerId, invoiceId: invoice.id })
    const state = await invoiceWithTx(invoice.id)
    expect(state.attemptCount).toBe(4)
    expect(state.nextAttemptAt).toBeNull()
    await runCollections(ownerId, new Date(Date.now() + 60 * DAY))
    expect(processor.charges.filter((c) => c.invoiceId === invoice.id)).toHaveLength(4)
  })

  it('cancels a membership left unpaid past the configured limit', async () => {
    const gym = await createGym({ pastDueGraceDays: 3, pastDueCancelDays: 10 })
    try {
      const { member } = await memberWithCard(gym)
      const { invoice, membership } = await sell(member.id, 'card', gym)
      processor.next = ['failed']
      await collectInvoice({ ownerId: gym, invoiceId: invoice.id })
      await runMembershipBilling(gym, new Date(Date.now() + 12 * DAY))
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('past_due')
      const summary = await runMembershipBilling(gym, new Date(Date.now() + 14 * DAY))
      expect(summary.cancelled).toBe(1)
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('cancelled')
    } finally {
      await destroyGym(gym)
    }
  })
})

describe('recurring billing', () => {
  it('charges the renewal invoice for a membership that pays by card', async () => {
    const { member } = await memberWithCard()
    const { membership, invoice } = await sell(member.id)
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const later = new Date(membership.currentPeriodEnd!.getTime() + DAY)
    const billing = await runMembershipBilling(ownerId, later)
    expect(billing.errors).toEqual([])
    const before = processor.charges.length
    const run = await runCollections(ownerId, later)
    expect(run.errors).toEqual([])
    expect(run.collected).toBeGreaterThanOrEqual(1)
    expect(processor.charges.length).toBeGreaterThan(before)
    const invoices = await prisma.invoice.findMany({ where: { membershipId: membership.id } })
    expect(invoices).toHaveLength(2)
    expect(invoices.every((i) => i.status === 'paid')).toBe(true)
    // Running it again must not charge anything twice.
    const again = processor.charges.length
    await runCollections(ownerId, later)
    expect(processor.charges.length).toBe(again)
  })

  it('leaves cash memberships for the front desk', async () => {
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id, 'cash')
    await runCollections(ownerId, new Date(Date.now() + DAY))
    expect(processor.charges.filter((c) => c.invoiceId === invoice.id)).toHaveLength(0)
  })
})

describe('bank payments and webhooks', () => {
  it('holds a bank debit as pending, then settles it once however many times the webhook arrives', async () => {
    const { member, method } = await memberWithCard(ownerId, 'us_bank_account')
    const { invoice } = await sell(member.id, 'ach')
    processor.next = ['processing']
    const started = await collectInvoice({ ownerId, invoiceId: invoice.id })
    expect(started.status).toBe('processing')
    let state = await invoiceWithTx(invoice.id)
    expect(state.status).toBe('open')
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({ status: 'pending', method: 'ach' })
    const reference = state.transactions[0].providerReference!

    // While it clears, nothing may charge the invoice again.
    expect((await collectInvoice({ ownerId, invoiceId: invoice.id })).status).toBe('processing')
    await runCollections(ownerId, new Date(Date.now() + DAY))
    expect(processor.charges).toHaveLength(1)

    const event = { ownerId, invoiceId: invoice.id, reference, outcome: 'succeeded' as const, amountCents: 15000, method: 'ach' as const, provider: 'stripe' }
    await settlePayment(event)
    await settlePayment(event)
    // A late, out-of-order "processing" must not undo it either.
    await settlePayment({ ...event, outcome: 'processing' })
    state = await invoiceWithTx(invoice.id)
    expect(state.status).toBe('paid')
    expect(state.amountPaidCents).toBe(15000)
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({ status: 'succeeded', providerReference: reference, paymentMethodId: method.id })
  })

  it('treats a returned bank debit as a failed payment', async () => {
    const { member } = await memberWithCard(ownerId, 'us_bank_account')
    const { invoice, membership } = await sell(member.id, 'ach')
    processor.next = ['processing']
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const reference = (await invoiceWithTx(invoice.id)).transactions[0].providerReference!
    const event = { ownerId, invoiceId: invoice.id, reference, outcome: 'failed' as const, amountCents: 15000, method: 'ach' as const, provider: 'stripe', failureReason: 'Insufficient funds' }
    await settlePayment(event)
    await settlePayment(event)
    const state = await invoiceWithTx(invoice.id)
    expect(state.status).toBe('open')
    expect(state.attemptCount).toBe(1)
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({ status: 'failed', failureReason: 'Insufficient funds' })
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('past_due')
  })

  it('does not double count when the webhook repeats a charge already recorded', async () => {
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id)
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const reference = (await invoiceWithTx(invoice.id)).transactions[0].providerReference!
    await settlePayment({ ownerId, invoiceId: invoice.id, reference, outcome: 'succeeded', amountCents: 15000, method: 'card', provider: 'stripe' })
    const state = await invoiceWithTx(invoice.id)
    expect(state.transactions).toHaveLength(1)
    expect(state.amountPaidCents).toBe(15000)
  })

  it('keeps money that arrives for an already-paid invoice as account credit', async () => {
    const { member } = await memberWithCard(ownerId, 'us_bank_account')
    const { invoice } = await sell(member.id, 'ach')
    processor.next = ['processing']
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const reference = (await invoiceWithTx(invoice.id)).transactions[0].providerReference!
    // Staff take cash while the debit is clearing.
    await tx((db) => recordPayment(db, { ownerId, invoiceId: invoice.id, method: 'cash' }))
    const event = { ownerId, invoiceId: invoice.id, reference, outcome: 'succeeded' as const, amountCents: 15000, method: 'ach' as const, provider: 'stripe' }
    await settlePayment(event)
    await settlePayment(event)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).creditBalanceCents).toBe(15000)
    expect((await invoiceWithTx(invoice.id)).amountPaidCents).toBe(15000)
  })
})

describe('refunds and disputes', () => {
  it('returns the money through the processor and records it once', async () => {
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id)
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const payment = (await invoiceWithTx(invoice.id)).transactions[0]
    const done = await refundPayment({ ownerId, transactionId: payment.id, amountCents: 5000, reason: 'Goodwill' })
    const refund = await prisma.transaction.findUniqueOrThrow({ where: { id: done.refundId } })
    expect(processor.refunds).toEqual([{ reference: payment.providerReference, amountCents: 5000, idempotencyKey: expect.any(String) }])
    expect(refund).toMatchObject({ type: 'refund', amountCents: 5000, provider: 'stripe' })
    // Stripe then tells us about the same refund by webhook.
    await recordExternalRefund({ ownerId, paymentReference: payment.providerReference!, refundReference: refund.providerReference!, amountCents: 5000 })
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } })
    expect(after.refundedCents).toBe(5000)
    expect(after.refunds).toHaveLength(1)
    await expect(refundPayment({ ownerId, transactionId: payment.id, amountCents: 20000 })).rejects.toMatchObject({ code: 'refund_too_large' })
    expect(processor.refunds).toHaveLength(1)
  })

  it('records a refund made in the Stripe dashboard', async () => {
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id)
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const payment = (await invoiceWithTx(invoice.id)).transactions[0]
    const input = { ownerId, paymentReference: payment.providerReference!, refundReference: 're_dashboard_1', amountCents: 15000 }
    await recordExternalRefund(input)
    await recordExternalRefund(input)
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } })
    expect(after.refundedCents).toBe(15000)
    expect(after.refunds).toHaveLength(1)
    expect(processor.refunds).toHaveLength(0)
  })

  it('flags a disputed payment and books a lost dispute as money returned', async () => {
    const { member } = await memberWithCard()
    const { invoice } = await sell(member.id)
    await collectInvoice({ ownerId, invoiceId: invoice.id })
    const payment = (await invoiceWithTx(invoice.id)).transactions[0]
    const base = { ownerId, paymentReference: payment.providerReference!, disputeReference: 'dp_1', amountCents: 15000, reason: 'fraudulent' }
    await recordDispute({ ...base, status: 'needs_response' })
    await recordDispute({ ...base, status: 'needs_response' })
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } })).disputeStatus).toBe('needs_response')
    expect(await prisma.notification.count({ where: { ownerId, type: 'dispute' } })).toBe(1)
    await recordDispute({ ...base, status: 'lost' })
    await recordDispute({ ...base, status: 'lost' })
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } })
    expect(after.disputeStatus).toBe('lost')
    expect(after.refundedCents).toBe(15000)
    expect(after.refunds).toHaveLength(1)
  })
})

describe('tenant isolation', () => {
  it("cannot charge one gym's invoice with another gym's card, or settle across gyms", async () => {
    const other = await createGym()
    try {
      const mine = await memberWithCard()
      const theirs = await memberWithCard(other)
      const { invoice } = await sell(mine.member.id)
      await expect(collectInvoice({ ownerId, invoiceId: invoice.id, paymentMethodId: theirs.method.id })).rejects.toMatchObject({ status: 404 })
      await expect(collectInvoice({ ownerId: other, invoiceId: invoice.id })).rejects.toMatchObject({ status: 404 })
      // Another member of the same gym cannot lend their card either.
      const neighbour = await memberWithCard()
      await expect(collectInvoice({ ownerId, invoiceId: invoice.id, paymentMethodId: neighbour.method.id })).rejects.toMatchObject({ status: 404 })
      expect(processor.charges).toHaveLength(0)
      // A webhook from the other gym's account naming this invoice changes nothing.
      const settled = await settlePayment({ ownerId: other, invoiceId: invoice.id, reference: 'pi_forged', outcome: 'succeeded', amountCents: 15000, method: 'card', provider: 'stripe' })
      expect(settled).toBeNull()
      expect((await invoiceWithTx(invoice.id)).status).toBe('open')
    } finally {
      await destroyGym(other)
    }
  })
})
