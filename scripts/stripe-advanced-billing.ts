// Advanced billing against real Stripe TEST MODE: plan changes, partial refunds, refund webhooks
// and household payers. Run it the same way as scripts/stripe-testmode.ts:
//
//   npx tsx scripts/local-postgres.ts                  # a database the server and this script can share
//   DATABASE_URL=postgres://postgres:postgres@localhost:54329/clubcheck_test npm run dev
//   STRIPE_API_KEY=sk_test_... stripe listen --forward-connect-to http://localhost:3000/api/webhooks/stripe-connect
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/clubcheck_test npx tsx scripts/stripe-advanced-billing.ts
//
// It refuses to run with a live key or against anything but a local database. Cards are Stripe's
// test payment methods. No real money moves and nobody is emailed.

import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.development.local', override: true })
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const DAY = 86_400_000
const keep = process.argv.includes('--keep')
const key = process.env.STRIPE_SECRET_KEY || ''
if (!key.startsWith('sk_test_')) throw new Error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.')
let dbHost = ''
try { dbHost = new URL(process.env.DATABASE_URL || '').hostname } catch {}
if (!['localhost', '127.0.0.1'].includes(dbHost)) throw new Error(`Refusing to run: DATABASE_URL points at "${dbHost}", not a local database.`)

const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' })
const results: { section: string; name: string; ok: boolean; detail?: string }[] = []
let section = ''
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ section, name, ok, detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
const begin = (title: string) => { section = title; console.log(`\n== ${title}`) }
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, seconds = 45): Promise<T | null> {
  const deadline = Date.now() + seconds * 1000
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() > deadline) { console.log(`  (timed out after ${seconds}s waiting for ${what})`); return null }
    await new Promise((r) => setTimeout(r, 1500))
  }
}
const quiet = (ms = 700) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { prisma } = await import('../lib/prisma')
  const connect = await import('../lib/payments/stripe-connect')
  const { getPaymentProvider } = await import('../lib/payments/provider')
  const collections = await import('../lib/services/collections')
  const { sellMembership } = await import('../lib/services/memberships')
  const { previewPlanChange, applyPlanChange } = await import('../lib/services/plan-change')
  const { createHousehold, getHousehold } = await import('../lib/services/households')

  const run = randomUUID().slice(0, 8)
  const startedAt = Math.floor(Date.now() / 1000) - 5
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || ''
  let gym = ''
  let account = ''
  const tx = <T>(fn: (db: any) => Promise<T>) => prisma.$transaction(fn, { timeout: 20_000 })
  const invoiceWithTx = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id }, include: { transactions: { orderBy: { createdAt: 'asc' } } } })
  const post = async (path: string, body: string, headers: Record<string, string> = {}) => {
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  const send = (event: Record<string, unknown>) => {
    const payload = JSON.stringify(event)
    return post('/api/webhooks/stripe-connect', payload, { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) })
  }
  let n = 0
  const person = (label: string) => prisma.member.create({ data: { ownerId: gym, name: `Test ${label}`, email: `delivered+${run}-${++n}@resend.dev`, qrCode: `clubcheck-member-${randomUUID()}`, status: 'inactive' } })
  /** What the browser does with Stripe.js: confirm the SetupIntent with a test payment method. */
  async function saveCard(memberId: string, testMethod = 'pm_card_visa') {
    const session = await connect.createSetupIntent(gym, memberId)
    const setupIntentId = String(session.clientSecret).split('_secret_')[0]
    await stripe.setupIntents.confirm(setupIntentId, { payment_method: testMethod }, { stripeAccount: account })
    await quiet()
    return connect.syncSetupIntent(gym, memberId, setupIntentId)
  }
  const plan = (name: string, priceCents: number, extra: Record<string, unknown> = {}) => prisma.membershipPlan.create({ data: { ownerId: gym, name: `${name} ${run}`, type: 'recurring', priceCents, ...extra } })
  /** A member half way through a 30-day period on a plan, having really paid for it by card. */
  async function midPeriod(member: { id: string }, planId: string) {
    const at = new Date(); at.setUTCHours(12, 0, 0, 0)
    const start = new Date(at.getTime() - 15 * DAY)
    const end = new Date(start.getTime() + 30 * DAY)
    const sale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: member.id, planId, paymentMethod: 'card', startDate: start }))
    await prisma.membership.update({ where: { id: sale.membership.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } })
    await prisma.invoice.update({ where: { id: sale.invoice!.id }, data: { periodStart: start, periodEnd: end } })
    const charge = await collections.collectInvoice({ ownerId: gym, invoiceId: sale.invoice!.id })
    await quiet()
    return { membershipId: sale.membership.id, invoiceId: sale.invoice!.id, at, end, charge }
  }
  async function change(s: { membershipId: string; at: Date }, planId: string, idempotencyKey: string = randomUUID()) {
    const base = { ownerId: gym, membershipId: s.membershipId, planId, effective: 'now' as const, source: 'staff' as const, at: s.at }
    const preview = await previewPlanChange(base)
    const result = await applyPlanChange({ ...base, expected: { fromPlanId: preview.from.id, amountDueNowCents: preview.calc.amountDueNowCents, creditCents: preview.calc.creditCents }, idempotencyKey })
    return { preview, result, input: { ...base, expected: { fromPlanId: preview.from.id, amountDueNowCents: preview.calc.amountDueNowCents, creditCents: preview.calc.creditCents }, idempotencyKey } }
  }
  const intentsFor = async (customer: string) => (await stripe.paymentIntents.list({ customer, limit: 100 }, { stripeAccount: account })).data
  const refundsOf = async (paymentIntent: string) => (await stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 }, { stripeAccount: account })).data

  try {
    begin('0. A gym with a chargeable connected account (test mode)')
    gym = randomUUID()
    await prisma.owner.create({
      data: {
        id: gym, email: `stripe-adv-${run}@test.local`, password: 'x', emailVerified: new Date(), subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 30 * DAY), planType: 'pro',
        gymProfile: { create: { name: `Advanced Billing Gym ${run}`, timezone: 'UTC', currency: 'usd', defaultTaxRateBps: 0 } },
      },
    })
    const created = await stripe.accounts.create({
      type: 'custom', country: 'US', email: `gym-${run}@test.local`, business_type: 'individual',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { mcc: '7997', url: 'https://accessible.stripe.com', product_description: 'Gym memberships' },
      individual: {
        first_name: 'Test', last_name: 'Gym', email: `gym-${run}@test.local`, phone: '0000000000', dob: { day: 1, month: 1, year: 1901 },
        address: { line1: 'address_full_match', city: 'New York', state: 'NY', postal_code: '10001', country: 'US' }, ssn_last_4: '0000', id_number: '000000000',
      },
      external_account: 'btok_us_verified',
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '8.8.8.8' },
      metadata: { ownerId: gym, purpose: 'clubcheck-advanced-billing-testmode' },
    })
    account = created.id
    await prisma.paymentAccount.create({ data: { ownerId: gym, providerId: account } })
    const enabled = await until('charges to be enabled', async () => {
      const a = await stripe.accounts.retrieve(account)
      await connect.applyAccountUpdate(a)
      return a.charges_enabled ? a : null
    }, 90)
    check('Connected test account can take card payments', !!enabled)
    check('Member payments for this gym go through the Stripe provider', (await getPaymentProvider(gym)).name === 'stripe')
    if (!enabled) throw new Error('Cannot continue without a chargeable connected account.')
    const [basic, plus, premium, plusTwin] = [await plan('Basic', 6000), await plan('Plus', 9000), await plan('Premium', 15_000), await plan('Plus Evenings', 9000)]
    const webhooksLive = !!(await until('a live webhook to reach the local server', async () => (await prisma.paymentEvent.count({ where: { account } })) > 0, 25))
    check('Stripe webhooks are reaching the local server (stripe listen)', webhooksLive, webhooksLive ? undefined : 'start `stripe listen --forward-connect-to` and rerun')

    // ------------------------------------------------------------------
    begin('1. Upgrade with an amount due')
    const amy = await person('Amy Upgrade')
    await saveCard(amy.id)
    const a = await midPeriod(amy, plus.id)
    check('First period paid by card at Stripe ($90.00)', a.charge.status === 'succeeded' && a.charge.amountCents === 9000, a.charge)
    const up = await change(a, premium.id)
    check('Preview: $45.00 unused, $75.00 for the rest of the period, $30.00 due', up.preview.calc.oldUnusedCents === 4500 && up.preview.calc.newChargeCents === 7500 && up.preview.calc.amountDueNowCents === 3000, up.preview.calc)
    const upCharge = await collections.collectInvoice({ ownerId: gym, invoiceId: up.result.invoiceId! })
    await quiet()
    const amyRow = await prisma.member.findUniqueOrThrow({ where: { id: amy.id } })
    let amyIntents = await intentsFor(amyRow.connectCustomerId!)
    const upInvoice = await invoiceWithTx(up.result.invoiceId!)
    const upIntent = amyIntents.find((i) => i.id === upInvoice.transactions[0]?.providerReference)
    check('Stripe charged exactly the previewed amount, once', upCharge.status === 'succeeded' && amyIntents.length === 2 && upIntent?.amount === 3000 && upIntent.status === 'succeeded', { intents: amyIntents.map((i) => i.amount) })
    check('Invoice paid for $30.00 and tied to the plan change', upInvoice.status === 'paid' && upInvoice.totalCents === 3000 && upInvoice.amountPaidCents === 3000 && upInvoice.transactions.length === 1)
    const afterUp = await prisma.membership.findUniqueOrThrow({ where: { id: a.membershipId } })
    check('Membership is on the new plan with the billing date unchanged', afterUp.planId === premium.id && afterUp.priceCents === 15_000 && afterUp.currentPeriodEnd!.getTime() === a.end.getTime())
    if (webhooksLive) {
      await until('the payment webhook', async () => (await prisma.paymentEvent.findFirst({ where: { account, type: 'payment_intent.succeeded', createdAt: { gte: new Date(Date.now() - 60_000) } } })), 30)
      const settled = await invoiceWithTx(up.result.invoiceId!)
      check('The payment webhook arriving after the direct charge changed nothing', settled.transactions.length === 1 && settled.amountPaidCents === 3000)
    }

    // ------------------------------------------------------------------
    begin('2. Downgrade resulting in a credit')
    const ben = await person('Ben Downgrade')
    await saveCard(ben.id)
    const b = await midPeriod(ben, premium.id)
    const benRow = await prisma.member.findUniqueOrThrow({ where: { id: ben.id } })
    const benPayment = (await invoiceWithTx(b.invoiceId)).transactions[0]
    const down = await change(b, basic.id)
    await quiet()
    check('Preview: $75.00 unused, $30.00 for the rest of the period, $45.00 credit, nothing due', down.preview.calc.oldUnusedCents === 7500 && down.preview.calc.newChargeCents === 3000 && down.preview.calc.creditCents === 4500 && down.preview.calc.amountDueNowCents === 0, down.preview.calc)
    check('No refund was sent at Stripe', (await refundsOf(benPayment.providerReference!)).length === 0)
    check('No further charge was made at Stripe', (await intentsFor(benRow.connectCustomerId!)).length === 1)
    const benCredit = await prisma.accountCredit.findMany({ where: { memberId: ben.id } })
    check('$45.00 is held as account credit, itemised as a plan change', benCredit.length === 1 && benCredit[0].remainingCents === 4500 && benCredit[0].source === 'proration' && (await prisma.member.findUniqueOrThrow({ where: { id: ben.id } })).creditBalanceCents === 4500)
    check('No refund transaction was recorded', (await prisma.transaction.count({ where: { memberId: ben.id, type: 'refund' } })) === 0)

    // ------------------------------------------------------------------
    begin('3. Plan change with no net amount')
    const cat = await person('Cat Sideways')
    await saveCard(cat.id)
    const c = await midPeriod(cat, plus.id)
    const catRow = await prisma.member.findUniqueOrThrow({ where: { id: cat.id } })
    const side = await change(c, plusTwin.id)
    const sideCharge = side.result.invoiceId ? await collections.collectInvoice({ ownerId: gym, invoiceId: side.result.invoiceId }) : null
    await quiet()
    check('Nothing due and no credit', side.result.amountDueNowCents === 0 && side.result.creditCents === 0 && !side.result.collect)
    check('Nothing was charged at Stripe', (await intentsFor(catRow.connectCustomerId!)).length === 1 && (!sideCharge || sideCharge.status === 'skipped'), sideCharge)
    check('Membership moved to the new plan', (await prisma.membership.findUniqueOrThrow({ where: { id: c.membershipId } })).planId === plusTwin.id)

    // ------------------------------------------------------------------
    begin('4-6. Partial refunds')
    const catPayment = (await invoiceWithTx(c.invoiceId)).transactions[0]
    const pi = catPayment.providerReference!
    const first = await collections.refundPayment({ ownerId: gym, transactionId: catPayment.id, amountCents: 2000, refundReason: 'service_issue', reason: 'Two classes cancelled', idempotencyKey: `r1-${run}` })
    await quiet()
    let atStripe = await refundsOf(pi)
    const firstRow = await prisma.transaction.findUniqueOrThrow({ where: { id: first.refundId } })
    check('Partial refund: $20.00 returned at Stripe and recorded once', atStripe.length === 1 && atStripe[0].amount === 2000 && firstRow.providerReference === atStripe[0].id && first.remainingRefundableCents === 7000, { stripe: atStripe.map((r) => r.amount), first })
    const second = await collections.refundPayment({ ownerId: gym, transactionId: catPayment.id, amountCents: 1500, refundReason: 'requested', idempotencyKey: `r2-${run}` })
    const third = await collections.refundPayment({ ownerId: gym, transactionId: catPayment.id, amountCents: 500, refundReason: 'requested', idempotencyKey: `r3-${run}` })
    await quiet()
    atStripe = await refundsOf(pi)
    check('Multiple partial refunds: $20.00 + $15.00 + $5.00, each its own refund at Stripe', atStripe.length === 3 && atStripe.reduce((s, r) => s + r.amount, 0) === 4000 && second.totalRefundedCents === 3500 && third.totalRefundedCents === 4000 && third.remainingRefundableCents === 5000, atStripe.map((r) => r.amount))
    let tooMuch = ''
    try { await collections.refundPayment({ ownerId: gym, transactionId: catPayment.id, amountCents: 5001 }) } catch (e: any) { tooMuch = e.code }
    check('A refund above what is left is refused before reaching Stripe', tooMuch === 'refund_too_large' && (await refundsOf(pi)).length === 3, tooMuch)
    // Two staff refund $30.00 each at the same moment with $50.00 left: one must lose, at Stripe if not before.
    const race = await Promise.allSettled([1, 2].map((i) => collections.refundPayment({ ownerId: gym, transactionId: catPayment.id, amountCents: 3000, idempotencyKey: `race-${i}-${run}` })))
    await quiet()
    atStripe = await refundsOf(pi)
    const paymentNow = await prisma.transaction.findUniqueOrThrow({ where: { id: catPayment.id }, include: { refunds: true } })
    check('Simultaneous refunds that together exceed the payment: exactly one goes through', race.filter((r) => r.status === 'fulfilled').length === 1 && atStripe.reduce((s, r) => s + r.amount, 0) === 7000 && paymentNow.refundedCents === 7000, { settled: race.map((r) => r.status), stripe: atStripe.map((r) => r.amount) })
    check('Refunded total never passes the captured amount, here or at Stripe', paymentNow.refundedCents <= paymentNow.amountCents && paymentNow.refunds.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amountCents, 0) === 7000)
    check('The original payment is preserved and the invoice shows $70.00 refunded', paymentNow.status === 'succeeded' && paymentNow.amountCents === 9000 && (await prisma.invoice.findUniqueOrThrow({ where: { id: c.invoiceId } })).refundedCents === 7000)

    // ------------------------------------------------------------------
    begin('7-8. Refund webhooks')
    if (!webhooksLive) {
      check('Live refund webhook', false, 'skipped: live webhooks are not reaching the local server')
    } else {
      // Our own refunds also come back as webhooks. They must not be recorded a second time.
      const settled = await until('refund webhooks for our own refunds', async () => (await prisma.paymentEvent.count({ where: { account, type: { in: ['charge.refunded', 'refund.created', 'refund.updated'] } } })) >= 3, 40)
      const afterOwn = await prisma.transaction.findUniqueOrThrow({ where: { id: catPayment.id }, include: { refunds: true } })
      check('Webhooks for refunds we made ourselves did not duplicate them', !!settled && afterOwn.refunds.length === 4 && afterOwn.refundedCents === 7000, { events: settled, refunds: afterOwn.refunds.length })
      // A refund made in the Stripe dashboard, outside ClubCheck.
      const outside = await stripe.refunds.create({ payment_intent: pi, amount: 1000, reason: 'requested_by_customer' }, { stripeAccount: account })
      const seen = await until('the dashboard refund to arrive by webhook', async () => prisma.transaction.findFirst({ where: { ownerId: gym, type: 'refund', providerReference: outside.id } }), 40)
      const afterOutside = await prisma.transaction.findUniqueOrThrow({ where: { id: catPayment.id }, include: { refunds: true } })
      check('A refund made in the Stripe dashboard arrives by webhook and is recorded once', !!seen && seen.amountCents === 1000 && afterOutside.refundedCents === 8000 && afterOutside.refunds.filter((r) => r.providerReference === outside.id).length === 1, { seen: seen?.amountCents, total: afterOutside.refundedCents })
      if (secret) {
        const events = await stripe.events.list({ limit: 30, created: { gte: startedAt } }, { stripeAccount: account })
        const refundEvents = events.data.filter((e) => ['charge.refunded', 'refund.created', 'refund.updated'].includes(e.type))
        const real = refundEvents.find((e) => e.type === 'charge.refunded') || refundEvents[0]
        const dup = await send({ ...real, account })
        check('A redelivered refund webhook is recognised as a duplicate', dup.status === 200 && dup.json?.duplicate === true, dup.json)
        // Even if our record of having seen the event were lost, processing it again must change nothing.
        await prisma.paymentEvent.deleteMany({ where: { id: { in: refundEvents.map((e) => e.id) } } })
        for (const e of refundEvents) await send({ ...e, account })
        for (const e of refundEvents) await send({ ...e, id: `${e.id}_again_${run}`, account })
        const afterReplay = await prisma.transaction.findUniqueOrThrow({ where: { id: catPayment.id }, include: { refunds: true } })
        check(`Reprocessing all ${refundEvents.length} refund events twice changes nothing`, afterReplay.refundedCents === 8000 && afterReplay.refunds.length === 5, { total: afterReplay.refundedCents, refunds: afterReplay.refunds.length })
        const forged = await post('/api/webhooks/stripe-connect', JSON.stringify({ ...real, account }), { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify({ ...real, account }), secret: 'whsec_wrong' }) })
        check('A refund event signed with the wrong secret is rejected', forged.status === 400)
      }
      const stripeTotal = (await refundsOf(pi)).reduce((s, r) => s + r.amount, 0)
      check('ClubCheck and Stripe agree on the total refunded ($80.00 of $90.00)', stripeTotal === 8000 && afterOutside.refundedCents === 8000, { stripeTotal })
    }

    // ------------------------------------------------------------------
    begin('9. Household payer charge')
    const parent = await person('Pat Payer')
    const [kid1, kid2] = [await person('Kit Child'), await person('Kai Child')]
    await saveCard(parent.id)
    const fam = await tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: parent.id, memberIds: [kid1.id, kid2.id] }))
    const famSales = []
    for (const [m, p] of [[kid1, basic], [kid2, plus]] as const) famSales.push(await tx((db) => sellMembership(db, { ownerId: gym, memberId: m.id, planId: p.id, paymentMethod: 'card' })))
    const collected = await collections.runCollections(gym)
    await quiet(1500)
    const parentRow = await prisma.member.findUniqueOrThrow({ where: { id: parent.id } })
    const parentIntents = await intentsFor(parentRow.connectCustomerId!)
    check('Both children\'s invoices were charged to the payer\'s Stripe customer ($60.00 and $90.00)', collected.collected === 2 && parentIntents.length === 2 && parentIntents.map((i) => i.amount).sort().join() === '6000,9000' && parentIntents.every((i) => i.status === 'succeeded'), { collected, intents: parentIntents.map((i) => i.amount) })
    const kids = await prisma.member.findMany({ where: { id: { in: [kid1.id, kid2.id] } } })
    check('The children have no Stripe customer and no card of their own', kids.every((k) => !k.connectCustomerId) && (await prisma.paymentMethod.count({ where: { memberId: { in: [kid1.id, kid2.id] } } })) === 0)
    const famInvoices = await Promise.all(famSales.map((s) => invoiceWithTx(s.invoice!.id)))
    check('Each invoice and payment still belongs to the child, with the payer recorded as who paid', famInvoices.every((i, k) => i.status === 'paid' && i.memberId === [kid1.id, kid2.id][k] && i.transactions.length === 1 && i.transactions[0].memberId === i.memberId && i.transactions[0].payerMemberId === parent.id))
    check('Each Stripe payment names the invoice and the member it was for', parentIntents.every((i) => famInvoices.some((inv) => inv.id === i.metadata.invoiceId && inv.memberId === i.metadata.memberId)), parentIntents.map((i) => i.metadata))
    check('Two memberships, not one merged one', (await prisma.membership.count({ where: { memberId: { in: [kid1.id, kid2.id] }, status: 'active' } })) === 2 && (await prisma.membership.count({ where: { memberId: parent.id } })) === 0)

    // ------------------------------------------------------------------
    begin('10. Failed household payer payment')
    const badParent = await person('Dee Declined')
    const [k3, k4] = [await person('Dot Child'), await person('Dan Child')]
    // A card that saves without trouble and is then declined when charged.
    await saveCard(badParent.id, 'pm_card_chargeCustomerFail')
    const badFam = await tx((db) => createHousehold(db, { ownerId: gym, payerMemberId: badParent.id, memberIds: [k3.id, k4.id] }))
    const badSales = []
    for (const [m, p] of [[k3, basic], [k4, plus]] as const) badSales.push(await tx((db) => sellMembership(db, { ownerId: gym, memberId: m.id, planId: p.id, paymentMethod: 'card' })))
    const failedRun = await collections.runCollections(gym)
    await quiet(2500)
    const badInvoices = await Promise.all(badSales.map((s) => invoiceWithTx(s.invoice!.id)))
    check('Both charges were declined by Stripe', failedRun.failed === 2 && badInvoices.every((i) => i.status === 'open' && i.transactions.length === 1 && i.transactions[0].status === 'failed'), { failedRun, tx: badInvoices.map((i) => i.transactions.map((t) => t.status)) })
    check('Each failure is recorded once against the child, naming the payer, with a retry scheduled', badInvoices.every((i) => i.attemptCount === 1 && !!i.nextAttemptAt && i.transactions[0].payerMemberId === badParent.id && i.transactions[0].memberId === i.memberId && !!i.transactions[0].failureReason))
    const badMemberships = await prisma.membership.findMany({ where: { id: { in: badSales.map((s) => s.membership.id) } } })
    check('Each affected membership is past due (the usual failed-payment steps), counted once', badMemberships.every((m) => m.status === 'past_due' && m.failedPaymentCount === 1), badMemberships.map((m) => [m.status, m.failedPaymentCount]))
    if (webhooksLive) {
      await until('the failure webhooks', async () => (await prisma.paymentEvent.count({ where: { account, type: 'payment_intent.payment_failed' } })) >= 2, 40)
      await quiet(1500)
      const again = await Promise.all(badSales.map((s) => invoiceWithTx(s.invoice!.id)))
      const counts = await prisma.membership.findMany({ where: { id: { in: badSales.map((s) => s.membership.id) } } })
      check('The failure webhooks arriving afterwards created no duplicate failures', again.every((i) => i.transactions.length === 1 && i.attemptCount === 1) && counts.every((m) => m.failedPaymentCount === 1), { tx: again.map((i) => i.transactions.length), counts: counts.map((m) => m.failedPaymentCount) })
    }
    const view = await getHousehold(gym, badFam.household.id)
    check('The household view shows who is affected and what is owed', view.members.filter((m) => m.paymentProblem).map((m) => m.id).sort().join() === [k3.id, k4.id].sort().join() && view.totals.amountDueCents === 15_000 && !view.members.find((m) => m.isPayer)!.paymentProblem, view.totals)
    check('Staff were told once per affected member, naming the payer', (await prisma.notification.count({ where: { ownerId: gym, type: 'payment_failed', body: { contains: 'billed to Test Dee Declined' } } })) === 2)
    check('The other household was not touched', (await getHousehold(gym, fam.household.id)).members.every((m) => !m.paymentProblem))

    // ------------------------------------------------------------------
    begin('11. Idempotent repeated requests')
    const eve = await person('Eve Repeat')
    await saveCard(eve.id)
    const e = await midPeriod(eve, plus.id)
    const eveRow = await prisma.member.findUniqueOrThrow({ where: { id: eve.id } })
    const once = await change(e, premium.id, `plan-${run}`)
    const repeats = await Promise.all([applyPlanChange(once.input), applyPlanChange(once.input), applyPlanChange(once.input)])
    // Every caller then tries to charge, as the route does.
    await Promise.all([once.result, ...repeats].map((r) => collections.collectInvoice({ ownerId: gym, invoiceId: r.invoiceId! })))
    await quiet(1500)
    const eveIntents = await intentsFor(eveRow.connectCustomerId!)
    check('A plan change repeated three times with the same key is one change', repeats.every((r) => r.replayed && r.planChangeId === once.result.planChangeId) && (await prisma.planChange.count({ where: { membershipId: e.membershipId } })) === 1)
    check('Stripe was charged once for it ($30.00), however many times collection was tried', eveIntents.filter((i) => i.amount === 3000 && i.status === 'succeeded').length === 1 && eveIntents.length === 2, eveIntents.map((i) => [i.amount, i.status]))
    const evePayment = (await invoiceWithTx(e.invoiceId)).transactions[0]
    const refundInput = { ownerId: gym, transactionId: evePayment.id, amountCents: 1200, idempotencyKey: `refund-${run}` }
    const refunds = await Promise.all([collections.refundPayment(refundInput), collections.refundPayment(refundInput), collections.refundPayment(refundInput)])
    const later = await collections.refundPayment(refundInput)
    await quiet()
    const eveRefunds = await refundsOf(evePayment.providerReference!)
    check('A refund repeated four times with the same key is one refund at Stripe and here', new Set([...refunds, later].map((r) => r.refundId)).size === 1 && later.replayed === true && eveRefunds.length === 1 && eveRefunds[0].amount === 1200 && (await prisma.transaction.findUniqueOrThrow({ where: { id: evePayment.id } })).refundedCents === 1200, { stripe: eveRefunds.map((r) => r.amount), ids: [...refunds, later].map((r) => r.refundId) })
    let reused = ''
    try { await collections.refundPayment({ ...refundInput, amountCents: 1300 }) } catch (err: any) { reused = err.code }
    check('The same key with a different amount is refused, not treated as a retry', reused === 'idempotency_key_reused' && (await refundsOf(evePayment.providerReference!)).length === 1, reused)

    // ------------------------------------------------------------------
    begin('12. Nothing touched the platform account or live mode')
    const platformIntents = await stripe.paymentIntents.list({ limit: 20, created: { gte: startedAt } })
    check('No payment was created on the ClubCheck platform account', platformIntents.data.length === 0, platformIntents.data.length)
    const platformRefunds = await stripe.refunds.list({ limit: 20, created: { gte: startedAt } })
    check('No refund was created on the platform account', platformRefunds.data.length === 0)
    const sample = (await intentsFor(amyRow.connectCustomerId!))[0]
    check('Every payment was made in test mode', sample.livemode === false && key.startsWith('sk_test_'))
    check('No Stripe subscription exists for any of these memberships', (await stripe.subscriptions.list({ limit: 5 }, { stripeAccount: account })).data.length === 0 && (await prisma.membership.count({ where: { ownerId: gym, stripeSubscriptionId: { not: null } } })) === 0)
  } finally {
    if (!keep) {
      if (gym) await prisma.owner.delete({ where: { id: gym } }).catch(() => {})
      if (account) await stripe.accounts.del(account).catch((e) => console.log(`  (could not delete test account ${account}: ${e.message})`))
    } else {
      console.log(`\n(kept gym ${gym} and Stripe account ${account})`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`)
  if (failed.length) {
    console.log('Failed:')
    for (const f of failed) console.log(`  [${f.section}] ${f.name}${f.detail ? `  -> ${f.detail}` : ''}`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
