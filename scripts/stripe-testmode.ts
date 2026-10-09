// End-to-end check of member payments against real Stripe TEST MODE.
//
//   npm run db:dev && npm run dev                      # local database and server
//   STRIPE_API_KEY=sk_test_... stripe listen --forward-connect-to http://localhost:3000/api/webhooks/stripe-connect
//   (put the whsec_ it prints in .env.development.local as STRIPE_CONNECT_WEBHOOK_SECRET, restart the server)
//   npx tsx scripts/stripe-testmode.ts                 # creates a throwaway connected account
//   npx tsx scripts/stripe-testmode.ts --account acct_...   # or use one you onboarded in Settings → Payments
//   npx tsx scripts/stripe-testmode.ts --keep          # leave the test gym and Stripe account in place
//
// It refuses to run with a live key or against anything but a local database.
// Everything goes through the same services the app uses; only the browser step
// (typing a card into Stripe's form) is replaced by Stripe's test payment methods.

import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.development.local', override: true })
// Live webhooks need a database two processes can share: see scripts/local-postgres.ts.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const DAY = 86_400_000
const args = process.argv.slice(2)
const keep = args.includes('--keep')
const givenAccount = args.includes('--account') ? args[args.indexOf('--account') + 1] : null

const key = process.env.STRIPE_SECRET_KEY || ''
if (!key.startsWith('sk_test_')) throw new Error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.')
let dbHost = ''
try { dbHost = new URL(process.env.DATABASE_URL || '').hostname } catch {}
if (!['localhost', '127.0.0.1'].includes(dbHost)) throw new Error(`Refusing to run: DATABASE_URL points at "${dbHost}", not a local database.`)
// Member emails below use Resend's sink address, so nothing this sends reaches a real inbox.

const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' })
const results: { section: string; name: string; ok: boolean; detail?: string }[] = []
let section = ''
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ section, name, ok, detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
function begin(title: string) {
  section = title
  console.log(`\n== ${title}`)
}
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, seconds = 45): Promise<T | null> {
  const deadline = Date.now() + seconds * 1000
  for (;;) {
    // The local PGlite database cannot serve this script and the dev server (busy with a webhook)
    // at the same instant, so a failed poll is simply tried again.
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() > deadline) {
      console.log(`  (timed out after ${seconds}s waiting for ${what})`)
      return null
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
}
/**
 * Local-only pacing. Each Stripe call below makes Stripe send webhooks to the dev server, and the
 * local PGlite database breaks if two processes query it together. Real Postgres has no such limit.
 */
const quiet = (ms = process.env.TEST_DATABASE_URL ? 500 : 6000) => new Promise((r) => setTimeout(r, ms))
const missing = async (fn: () => Promise<unknown>) => {
  try { await fn(); return false } catch (e: any) { return e?.code === 'resource_missing' || e?.statusCode === 404 || e?.status === 404 }
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const connect = await import('../lib/payments/stripe-connect')
  const { getPaymentProvider } = await import('../lib/payments/provider')
  const collections = await import('../lib/services/collections')
  const { sellMembership, runMembershipBilling } = await import('../lib/services/memberships')
  const { Prisma } = await import('@prisma/client')

  const run = randomUUID().slice(0, 8)
  const startedAt = Math.floor(Date.now() / 1000) - 5
  const gyms: string[] = []
  const stripeAccountsToDelete: string[] = []
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || ''

  async function createGym(name: string, profile: Record<string, unknown> = {}) {
    const id = randomUUID()
    await prisma.owner.create({
      data: {
        id, email: `stripe-test-${run}-${gyms.length}@test.local`, password: 'x', emailVerified: new Date(), subscriptionStatus: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY), planType: 'pro', gymProfile: { create: { name, timezone: 'America/New_York', currency: 'usd', ...profile } },
      },
    })
    gyms.push(id)
    return id
  }
  let memberNo = 0
  async function createMember(ownerId: string, label: string) {
    memberNo++
    return prisma.member.create({
      data: {
        ownerId, name: `Test ${label}`, email: `delivered+${run}-${memberNo}@resend.dev`, qrCode: `clubcheck-member-${randomUUID()}`, status: 'inactive',
        accessToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), accessTokenExpiry: new Date(Date.now() + DAY),
      },
    })
  }
  const tx = <T>(fn: (db: any) => Promise<T>) => prisma.$transaction(fn, { timeout: 20_000 })
  const invoiceWithTx = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id }, include: { transactions: { orderBy: { createdAt: 'asc' } } } })
  /** Run something that talks to Stripe, then give the resulting webhooks time to be handled. */
  async function paced<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn() } finally { await quiet() }
  }
  async function post(path: string, body: string, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  /** What the browser does with Stripe.js: confirm the SetupIntent with a (test) payment method. */
  async function saveMethod(ownerId: string, memberId: string, account: string, testMethod: string) {
    const session = await connect.createSetupIntent(ownerId, memberId)
    const setupIntentId = String(session.clientSecret).split('_secret_')[0]
    const bank = testMethod.startsWith('pm_usBankAccount')
    await stripe.setupIntents.confirm(
      setupIntentId,
      { payment_method: testMethod, ...(bank && { mandate_data: { customer_acceptance: { type: 'online', online: { ip_address: '8.8.8.8', user_agent: 'clubcheck-testmode' } } } }) },
      { stripeAccount: account }
    )
    await quiet()
    const synced = await connect.syncSetupIntent(ownerId, memberId, setupIntentId)
    return { session, setupIntentId, synced }
  }

  try {
    // ------------------------------------------------------------------
    begin('1. Connecting a gym (Settings → Payments code path)')
    const gymStd = await createGym(`Onboarding Gym ${run}`)
    let link: { url: string } | null = null
    try {
      link = await connect.startOnboarding(gymStd, BASE)
    } catch (e: any) {
      check('Stripe accepts creating a Standard connected account', false, e.message)
    }
    if (link) {
      const row = await prisma.paymentAccount.findUnique({ where: { ownerId: gymStd } })
      check('Stripe accepts creating a Standard connected account', !!row?.providerId.startsWith('acct_'), row?.providerId)
      check('Onboarding link is a hosted Stripe page', link.url.startsWith('https://connect.stripe.com/'), link.url.slice(0, 40))
      const acct = await stripe.accounts.retrieve(row!.providerId)
      stripeAccountsToDelete.push(acct.id)
      check('Account is type standard and tagged with the gym', acct.type === 'standard' && acct.metadata?.ownerId === gymStd, { type: acct.type })
      const status = await connect.getConnectStatus(gymStd, true)
      check('Connection recorded; not chargeable until onboarding is finished', status.connected && !status.chargesEnabled && status.accountId === acct.id, status)
      check('An unfinished gym falls back to manual payments', (await getPaymentProvider(gymStd)).name === 'manual')
      const again = await connect.startOnboarding(gymStd, BASE)
      check('Resuming onboarding reuses the same account', (await prisma.paymentAccount.count({ where: { ownerId: gymStd } })) === 1 && again.url.startsWith('https://'))
    }

    // ------------------------------------------------------------------
    begin('2. A gym whose account can take payments')
    const gym = await createGym(`Charging Gym ${run}`, { defaultTaxRateBps: 0 })
    let account = givenAccount
    if (!account) {
      const created = await stripe.accounts.create({
        type: 'custom', country: 'US', email: `gym-${run}@test.local`, business_type: 'individual',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true }, us_bank_account_ach_payments: { requested: true } },
        business_profile: { mcc: '7997', url: 'https://accessible.stripe.com', product_description: 'Gym memberships' },
        individual: {
          first_name: 'Test', last_name: 'Gym', email: `gym-${run}@test.local`, phone: '0000000000', dob: { day: 1, month: 1, year: 1901 },
          address: { line1: 'address_full_match', city: 'New York', state: 'NY', postal_code: '10001', country: 'US' }, ssn_last_4: '0000', id_number: '000000000',
        },
        external_account: 'btok_us_verified',
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '8.8.8.8' },
        metadata: { ownerId: gym, purpose: 'clubcheck-testmode' },
      })
      account = created.id
      stripeAccountsToDelete.push(account)
      console.log(`  (created throwaway connected account ${account}; production gyms use Standard accounts, the charge calls are identical)`)
    }
    await prisma.paymentAccount.create({ data: { ownerId: gym, providerId: account } })
    const enabled = await until('charges to be enabled', async () => {
      const a = await stripe.accounts.retrieve(account!)
      await connect.applyAccountUpdate(a)
      return a.charges_enabled ? a : null
    }, 90)
    check('Connected account is enabled for charges', !!enabled, enabled ? undefined : 'charges_enabled stayed false')
    const achActive = enabled?.capabilities?.us_bank_account_ach_payments === 'active'
    const status = await connect.getConnectStatus(gym)
    check('ClubCheck records the account as chargeable', status.chargesEnabled && status.accountId === account, status)
    check('Member payments for this gym go through the Stripe provider', (await getPaymentProvider(gym)).name === 'stripe')
    if (!enabled) throw new Error('Cannot continue without a chargeable connected account.')

    // ------------------------------------------------------------------
    begin('3. Saved cards')
    const alice = await createMember(gym, 'Alice')
    const visa = await saveMethod(gym, alice.id, account, 'pm_card_visa')
    check('Setup session targets the gym account, with a publishable key', visa.session.stripeAccountId === account && visa.session.publishableKey.startsWith('pk_test_'))
    check('Card saved', visa.synced.status === 'saved', visa.synced.status)
    let aliceRow = await prisma.member.findUniqueOrThrow({ where: { id: alice.id } })
    const visaRow = await prisma.paymentMethod.findFirstOrThrow({ where: { memberId: alice.id } })
    check('Stored brand, last four and expiry', visaRow.brand === 'visa' && visaRow.last4 === '4242' && !!visaRow.expMonth && !!visaRow.expYear, { brand: visaRow.brand, last4: visaRow.last4 })
    check('First saved method becomes the default', visaRow.isDefault)
    const columns = Prisma.dmmf.datamodel.models.find((m) => m.name === 'PaymentMethod')!.fields.filter((f) => f.kind === 'scalar').map((f) => f.name).sort()
    const safe = ['bankName', 'brand', 'createdAt', 'expMonth', 'expYear', 'id', 'isDefault', 'last4', 'memberId', 'ownerId', 'provider', 'providerId', 'type']
    check('Only references and display details are stored (no number, CVC or bank credentials)', JSON.stringify(columns) === JSON.stringify(safe), columns)
    const customerId = aliceRow.connectCustomerId!
    const onAccount = await stripe.customers.retrieve(customerId, { stripeAccount: account })
    check('Stripe customer exists on the gym account', !('deleted' in onAccount && onAccount.deleted) && (onAccount as Stripe.Customer).metadata?.memberId === alice.id)
    check('Stripe customer does NOT exist on the ClubCheck platform account', await missing(() => stripe.customers.retrieve(customerId)))
    const pmAtStripe = await stripe.paymentMethods.retrieve(visaRow.providerId, { stripeAccount: account })
    check('Stripe payment method is attached to that customer', pmAtStripe.customer === customerId)

    await saveMethod(gym, alice.id, account, 'pm_card_mastercard')
    const mcRow = await prisma.paymentMethod.findFirstOrThrow({ where: { memberId: alice.id, brand: 'mastercard' } })
    check('Second card saved without taking over as default', !mcRow.isDefault && (await prisma.paymentMethod.count({ where: { memberId: alice.id } })) === 2)
    await connect.setDefaultPaymentMethod(gym, alice.id, mcRow.id)
    const defaults = await prisma.paymentMethod.findMany({ where: { memberId: alice.id, isDefault: true } })
    check('Set default moves the default to the chosen card', defaults.length === 1 && defaults[0].id === mcRow.id)
    await connect.removePaymentMethod(gym, alice.id, mcRow.id)
    await quiet()
    const detached = await stripe.paymentMethods.retrieve(mcRow.providerId, { stripeAccount: account })
    check('Removing a card detaches it at Stripe', detached.customer === null)
    const left = await prisma.paymentMethod.findMany({ where: { memberId: alice.id } })
    check('Removing the default promotes the remaining card', left.length === 1 && left[0].id === visaRow.id && left[0].isDefault)

    const bob = await createMember(gym, 'Bob')
    await connect.createSetupIntent(gym, bob.id)
    await quiet()
    let crossed = false
    try { await connect.syncSetupIntent(gym, bob.id, visa.setupIntentId) } catch (e: any) { crossed = e?.status === 404 }
    check("One member cannot claim another member's confirmed card", crossed)

    const liveWebhook = await until('a live webhook from Stripe', () => prisma.paymentEvent.findFirst({ where: { account, type: 'setup_intent.succeeded' } }), 40)
    check('Live webhooks from the connected account reach the local endpoint', !!liveWebhook, liveWebhook ? undefined : 'no setup_intent.succeeded event recorded; is `stripe listen --forward-connect-to` running and the secret set?')
    const webhooksLive = !!liveWebhook

    // ------------------------------------------------------------------
    begin('4. Membership purchase: member → plan → payment → invoice → transaction → active')
    const plan = await prisma.membershipPlan.create({ data: { ownerId: gym, name: 'Unlimited', type: 'recurring', priceCents: 10000, taxRateBps: 825, billingInterval: 'month' } })
    const sale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: alice.id, planId: plan.id, paymentMethod: 'card', discountPercent: 10 }))
    check('Invoice totals: $100 less 10% = $90.00, plus 8.25% tax $7.43 = $97.43', sale.invoice?.subtotalCents === 9000 && sale.invoice?.taxCents === 743 && sale.invoice?.totalCents === 9743, { subtotal: sale.invoice?.subtotalCents, tax: sale.invoice?.taxCents, total: sale.invoice?.totalCents })
    const charged = await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: sale.invoice!.id }))
    check('Charge succeeded', charged.status === 'succeeded', charged)
    let inv = await invoiceWithTx(sale.invoice!.id)
    const payment = inv.transactions[0]
    check('Invoice is paid in full', inv.status === 'paid' && inv.amountPaidCents === 9743)
    check('One transaction: succeeded, card, via Stripe, linked to the saved card', inv.transactions.length === 1 && payment?.status === 'succeeded' && payment.method === 'card' && payment.provider === 'stripe' && payment.paymentMethodId === visaRow.id && payment.cardLast4 === '4242', payment && { status: payment.status, method: payment.method })
    const pi = await stripe.paymentIntents.retrieve(payment.providerReference!, { stripeAccount: account })
    check('Stripe payment is on the gym account for the exact amount and card', pi.status === 'succeeded' && pi.amount === 9743 && pi.currency === 'usd' && pi.customer === customerId && pi.payment_method === visaRow.providerId, { status: pi.status, amount: pi.amount })
    check('Stripe payment carries the invoice reference', pi.metadata?.invoiceId === inv.id && pi.metadata?.memberId === alice.id)
    check('No platform fee taken by default', !pi.application_fee_amount)
    check('The payment does NOT exist on the ClubCheck platform account', await missing(() => stripe.paymentIntents.retrieve(payment.providerReference!)))
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id } })
    aliceRow = await prisma.member.findUniqueOrThrow({ where: { id: alice.id } })
    check('Membership is active and so is the member', membership.status === 'active' && aliceRow.status === 'active', { membership: membership.status, member: aliceRow.status })
    const portal = await fetch(`${BASE}/api/portal/${alice.accessToken}`).then((r) => r.json()).catch(() => null)
    const seen = portal?.data?.billing?.payments?.find((p: any) => p.amountCents === 9743 && p.status === 'succeeded')
    check('Member sees the payment in their portal', !!seen && portal.data.billing.canPayOnline === true && portal.data.billing.paymentMethods.length === 1, portal?.error)
    check('Portal response does not leak Stripe ids', !!portal && !JSON.stringify(portal).includes(visaRow.providerId) && !JSON.stringify(portal).includes(customerId))
    if (webhooksLive) {
      const hook = await until('payment_intent.succeeded webhook', () => prisma.paymentEvent.findFirst({ where: { account, type: 'payment_intent.succeeded' } }), 40)
      inv = await invoiceWithTx(inv.id)
      check('Webhook for the same payment arrived and did not duplicate the transaction', !!hook && inv.transactions.length === 1 && inv.amountPaidCents === 9743, { events: !!hook, transactions: inv.transactions.length })
    }

    // ------------------------------------------------------------------
    begin('5. Automatic recurring billing')
    await prisma.membership.update({ where: { id: membership.id }, data: { currentPeriodStart: new Date(Date.now() - 31 * DAY), currentPeriodEnd: new Date(Date.now() - 3_600_000) } })
    const billing = await runMembershipBilling(gym)
    check('Renewal invoice generated', billing.invoicesCreated === 1 && billing.errors.length === 0, billing)
    const collected = await paced(() => collections.runCollections(gym))
    check('Renewal charged to the default payment method', collected.collected === 1 && collected.failed === 0 && collected.errors.length === 0, collected)
    const renewals = await prisma.invoice.findMany({ where: { membershipId: membership.id }, orderBy: { createdAt: 'asc' }, include: { transactions: true } })
    const renewal = renewals[1]
    check('Renewal invoice is paid with one Stripe transaction', renewals.length === 2 && renewal?.status === 'paid' && renewal.transactions.length === 1 && renewal.transactions[0].provider === 'stripe')
    check('Renewal keeps the ongoing discount and tax ($97.43)', renewal?.totalCents === 9743, renewal?.totalCents)
    check('Membership stays active', (await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status === 'active')
    const again = await paced(() => collections.runCollections(gym))
    await runMembershipBilling(gym)
    check('Running the job again charges nothing more', again.attempted === 0 && (await prisma.invoice.count({ where: { membershipId: membership.id } })) === 2, again)
    if (webhooksLive) {
      await until('renewal webhook', async () => (await prisma.paymentEvent.count({ where: { account, type: 'payment_intent.succeeded' } })) >= 2, 40)
      const after = await invoiceWithTx(renewal.id)
      check('Renewal webhook arrived without duplicating the payment', after.transactions.length === 1 && after.amountPaidCents === 9743)
    }
    const portal2 = await fetch(`${BASE}/api/portal/${alice.accessToken}`).then((r) => r.json()).catch(() => null)
    check('Member sees both payments in history', portal2?.data?.billing?.payments?.filter((p: any) => p.status === 'succeeded' && p.type === 'payment').length === 2)

    // ------------------------------------------------------------------
    begin('6. Failed payment, notification and retries')
    const automation = await prisma.automation.create({ data: { ownerId: gym, name: 'Payment failed', trigger: 'payment_failed', channel: 'email', subject: 'Your payment failed', body: 'Hi {{first_name}}, your payment of {{amount}} failed.', isActive: true } })
    const carol = await createMember(gym, 'Carol')
    await saveMethod(gym, carol.id, account, 'pm_card_chargeCustomerFail')
    const badCard = await prisma.paymentMethod.findFirstOrThrow({ where: { memberId: carol.id } })
    const carolSale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: carol.id, planId: plan.id, paymentMethod: 'card' }))
    const declined = await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: carolSale.invoice!.id }))
    check('Stripe declines the charge and ClubCheck reports it', declined.status === 'failed' && !!declined.message, declined)
    let cInv = await invoiceWithTx(carolSale.invoice!.id)
    check('Failure recorded with the bank reason and the Stripe reference', cInv.transactions.length === 1 && cInv.transactions[0].status === 'failed' && !!cInv.transactions[0].failureReason && !!cInv.transactions[0].providerReference?.startsWith('pi_'), cInv.transactions[0] && { reason: cInv.transactions[0].failureReason, ref: cInv.transactions[0].providerReference })
    check('Invoice stays open', cInv.status === 'open' && cInv.amountPaidCents === 0)
    const days = (d: Date | null) => (d ? Math.round((d.getTime() - Date.now()) / DAY) : null)
    check('Next retry scheduled for day 3', cInv.attemptCount === 1 && days(cInv.nextAttemptAt) === 3, { attempts: cInv.attemptCount, inDays: days(cInv.nextAttemptAt) })
    check('Membership becomes past due', (await prisma.membership.findUniqueOrThrow({ where: { id: carolSale.membership.id } })).status === 'past_due')
    const runRow = await prisma.automationRun.findFirst({ where: { ownerId: gym, automationId: automation.id, memberId: carol.id } })
    check('"Payment failed" automation fired for the member', !!runRow, runRow?.status)
    const message = await until('the notification message', () => prisma.message.findFirst({ where: { ownerId: gym, memberId: carol.id, automationId: automation.id } }), 15)
    check('Member notification created', !!message, message ? `${message.status}${message.error ? `: ${message.error}` : ''}` : 'no message row')
    check('Staff are notified too', (await prisma.notification.count({ where: { ownerId: gym, type: 'payment_failed' } })) >= 1)
    if (webhooksLive) {
      await until('payment_intent.payment_failed webhook', () => prisma.paymentEvent.findFirst({ where: { account, type: 'payment_intent.payment_failed' } }), 40)
      cInv = await invoiceWithTx(cInv.id)
      check('Failure webhook did not double count the attempt', cInv.transactions.length === 1 && cInv.attemptCount === 1, { transactions: cInv.transactions.length, attempts: cInv.attemptCount })
    }
    const attempts = async () => (await invoiceWithTx(cInv.id)).attemptCount
    await paced(() => collections.runCollections(gym, new Date(Date.now() + 2 * DAY)))
    check('No retry before day 3', (await attempts()) === 1)
    await paced(() => collections.runCollections(gym, new Date(Date.now() + 3 * DAY + 3_600_000)))
    cInv = await invoiceWithTx(cInv.id)
    check('Day 3: retried, declined again, next retry two days later (day 5)', cInv.attemptCount === 2 && days(cInv.nextAttemptAt) === 2, { attempts: cInv.attemptCount, inDays: days(cInv.nextAttemptAt) })
    await paced(() => collections.runCollections(gym, new Date(Date.now() + 2 * DAY + 3_600_000)))
    cInv = await invoiceWithTx(cInv.id)
    check('Day 5: retried, declined again, next retry two days later (day 7)', cInv.attemptCount === 3 && days(cInv.nextAttemptAt) === 2, { attempts: cInv.attemptCount, inDays: days(cInv.nextAttemptAt) })
    // Before the day-7 retry the member replaces the bad card.
    await saveMethod(gym, carol.id, account, 'pm_card_visa')
    const goodCard = await prisma.paymentMethod.findFirstOrThrow({ where: { memberId: carol.id, id: { not: badCard.id } } })
    await connect.setDefaultPaymentMethod(gym, carol.id, goodCard.id)
    const recovered = await paced(() => collections.runCollections(gym, new Date(Date.now() + 2 * DAY + 3_600_000)))
    cInv = await invoiceWithTx(cInv.id)
    check('Day 7: retry on the new default card succeeds', recovered.collected === 1 && cInv.status === 'paid' && cInv.nextAttemptAt === null, { recovered, status: cInv.status })
    check('Each attempt is its own Stripe payment (3 failed, 1 succeeded)', cInv.transactions.filter((t) => t.status === 'failed').length === 3 && cInv.transactions.filter((t) => t.status === 'succeeded').length === 1 && new Set(cInv.transactions.map((t) => t.providerReference)).size === 4)
    check('Membership and member are active again', (await prisma.membership.findUniqueOrThrow({ where: { id: carolSale.membership.id } })).status === 'active' && (await prisma.member.findUniqueOrThrow({ where: { id: carol.id } })).status === 'active')

    const dave = await createMember(gym, 'Dave')
    await saveMethod(gym, dave.id, account, 'pm_card_chargeCustomerFail')
    const daveSale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: dave.id, planId: plan.id, paymentMethod: 'card' }))
    for (let i = 0; i < 4; i++) await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: daveSale.invoice!.id }))
    const dInv = await invoiceWithTx(daveSale.invoice!.id)
    check('After the fourth failure, automatic retries stop', dInv.attemptCount === 4 && dInv.nextAttemptAt === null, { attempts: dInv.attemptCount })
    await prisma.gymProfile.update({ where: { ownerId: gym }, data: { pastDueGraceDays: 3, pastDueCancelDays: 10 } })
    await runMembershipBilling(gym, new Date(Date.now() + 12 * DAY))
    check('Unpaid membership is kept while inside the limit', (await prisma.membership.findUniqueOrThrow({ where: { id: daveSale.membership.id } })).status === 'past_due')
    const cancelRun = await runMembershipBilling(gym, new Date(Date.now() + 14 * DAY))
    check('Optional rule cancels a membership left unpaid past the limit', cancelRun.cancelled >= 1 && (await prisma.membership.findUniqueOrThrow({ where: { id: daveSale.membership.id } })).status === 'cancelled', cancelRun)
    await prisma.gymProfile.update({ where: { ownerId: gym }, data: { pastDueCancelDays: 0 } })

    // ------------------------------------------------------------------
    begin('7. Bank accounts (ACH)')
    if (!achActive) {
      check('ACH capability active on the connected account', false, `capability is "${enabled?.capabilities?.us_bank_account_ach_payments}"; ACH steps skipped`)
    } else {
      const erin = await createMember(gym, 'Erin')
      const bank = await saveMethod(gym, erin.id, account, 'pm_usBankAccount_success')
      const bankRow = await prisma.paymentMethod.findFirst({ where: { memberId: erin.id } })
      check('Bank account saved with bank name and last four only', bank.synced.status === 'saved' && bankRow?.type === 'us_bank_account' && !!bankRow.last4 && bankRow.isDefault, bankRow && { bank: bankRow.bankName, last4: bankRow.last4 })
      const erinSale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: erin.id, planId: plan.id, paymentMethod: 'ach' }))
      const started = await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: erinSale.invoice!.id }))
      check('Bank debit is accepted and reported as processing', started.status === 'processing', started)
      let eInv = await invoiceWithTx(erinSale.invoice!.id)
      check('Held as a pending transaction; invoice not yet paid', eInv.status === 'open' && eInv.transactions.length === 1 && eInv.transactions[0].status === 'pending' && eInv.transactions[0].method === 'ach')
      const second = await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: erinSale.invoice!.id }))
      await paced(() => collections.runCollections(gym))
      check('Nothing charges the invoice again while the debit clears', second.status === 'processing' && (await invoiceWithTx(eInv.id)).transactions.length === 1)
      if (webhooksLive) {
        const cleared = await until('the bank debit to clear (Stripe test mode settles it by webhook)', async () => ((await prisma.invoice.findUniqueOrThrow({ where: { id: eInv.id } })).status === 'paid' ? true : null), 240)
        eInv = await invoiceWithTx(eInv.id)
        check('Webhook settles the debit: invoice paid, the same single transaction succeeded', !!cleared && eInv.transactions.length === 1 && eInv.transactions[0].status === 'succeeded' && eInv.amountPaidCents === eInv.totalCents, { status: eInv.status, tx: eInv.transactions.map((t) => t.status) })

        const frank = await createMember(gym, 'Frank')
        await saveMethod(gym, frank.id, account, 'pm_usBankAccount_insufficientFunds')
        const frankSale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: frank.id, planId: plan.id, paymentMethod: 'ach' }))
        const fStart = await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: frankSale.invoice!.id }))
        const bounced = await until('the bank debit to be returned', async () => ((await invoiceWithTx(frankSale.invoice!.id)).transactions.some((t) => t.status === 'failed') ? true : null), 240)
        const fInv = await invoiceWithTx(frankSale.invoice!.id)
        check('A returned debit becomes a failed payment and the membership goes past due', fStart.status === 'processing' && !!bounced && fInv.status === 'open' && fInv.transactions.length === 1 && fInv.attemptCount === 1 && (await prisma.membership.findUniqueOrThrow({ where: { id: frankSale.membership.id } })).status === 'past_due', { start: fStart.status, tx: fInv.transactions.map((t) => `${t.status}:${t.failureReason}`) })
      } else {
        check('Bank debit settlement by webhook', false, 'skipped: live webhooks are not reaching the local server')
      }
      await connect.removePaymentMethod(gym, erin.id, bankRow!.id)
    await quiet()
      check('Bank account can be removed', (await prisma.paymentMethod.count({ where: { memberId: erin.id } })) === 0 && (await stripe.paymentMethods.retrieve(bankRow!.providerId, { stripeAccount: account })).customer === null)
    }

    // ------------------------------------------------------------------
    begin('8. Refunds')
    const partial = await paced(() => collections.refundPayment({ ownerId: gym, transactionId: payment.id, amountCents: 2000, reason: 'Partial goodwill refund' }))
    let stripeRefunds = await stripe.refunds.list({ payment_intent: payment.providerReference! }, { stripeAccount: account })
    check('Partial refund: $20.00 returned at Stripe and recorded once', stripeRefunds.data.length === 1 && stripeRefunds.data[0].amount === 2000 && partial.amountCents === 2000 && (await prisma.transaction.findUniqueOrThrow({ where: { id: partial.refundId } })).providerReference === stripeRefunds.data[0].id)
    const rest = await paced(() => collections.refundPayment({ ownerId: gym, transactionId: payment.id }))
    stripeRefunds = await stripe.refunds.list({ payment_intent: payment.providerReference! }, { stripeAccount: account })
    const refundedPayment = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } })
    check('Full refund of the remainder: $77.43, totalling the original payment', rest.amountCents === 7743 && rest.fullyRefunded && refundedPayment.refundedCents === 9743 && stripeRefunds.data.reduce((s, r) => s + r.amount, 0) === 9743, { rest: rest.amountCents, total: refundedPayment.refundedCents })
    check('Invoice shows the refunded amount', (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).refundedCents === 9743)
    let overRefund = false
    try { await paced(() => collections.refundPayment({ ownerId: gym, transactionId: payment.id, amountCents: 100 })) } catch (e: any) { overRefund = e?.code === 'already_refunded' }
    check('A fully refunded payment cannot be refunded again', overRefund)
    const renewalTx = renewal.transactions[0]
    const external = await stripe.refunds.create({ payment_intent: renewalTx.providerReference!, amount: 1500 }, { stripeAccount: account })
    await quiet()
    if (webhooksLive) {
      const synced = await until('the Stripe-side refund to sync', () => prisma.transaction.findFirst({ where: { ownerId: gym, type: 'refund', providerReference: external.id } }), 60)
      check('A refund made in Stripe itself is synchronized into ClubCheck', !!synced && synced.amountCents === 1500 && synced.parentTransactionId === renewalTx.id, synced && { amount: synced.amountCents })
      await new Promise((r) => setTimeout(r, 6000))
      const all = await prisma.transaction.findMany({ where: { ownerId: gym, type: 'refund' } })
      check('Refund webhooks created no duplicates (3 refunds in total)', all.length === 3 && new Set(all.map((r) => r.providerReference)).size === 3, all.map((r) => `${r.amountCents}:${r.providerReference}`))
    } else {
      check('Stripe-side refund synchronization', false, 'skipped: live webhooks are not reaching the local server')
    }
    const portal3 = await fetch(`${BASE}/api/portal/${alice.accessToken}`).then((r) => r.json()).catch(() => null)
    check('Member sees the refunds in their history', (portal3?.data?.billing?.payments || []).filter((p: any) => p.type === 'refund').length >= 2)

    // ------------------------------------------------------------------
    begin('9. Disputes')
    const gina = await createMember(gym, 'Gina')
    await saveMethod(gym, gina.id, account, 'pm_card_createDispute')
    const ginaSale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: gina.id, planId: plan.id, paymentMethod: 'card' }))
    const gCharge = await paced(() => collections.collectInvoice({ ownerId: gym, invoiceId: ginaSale.invoice!.id }))
    const gTx = (await invoiceWithTx(ginaSale.invoice!.id)).transactions[0]
    if (webhooksLive && gCharge.status === 'succeeded') {
      const disputed = await until('the dispute webhook', async () => { const t = await prisma.transaction.findUniqueOrThrow({ where: { id: gTx.id } }); return t.disputeStatus ? t : null }, 90)
      check('Dispute recorded on the transaction with status, reason and date', !!disputed?.disputeStatus && !!disputed.disputedAt && !!disputed.disputeReason, disputed && { status: disputed.disputeStatus, reason: disputed.disputeReason })
      const activity = await prisma.activity.findFirst({ where: { ownerId: gym, memberId: gina.id, type: 'dispute' } })
      const meta = (activity?.metadata || {}) as Record<string, unknown>
      check("Dispute appears on the member's timeline with the Stripe dispute id", !!activity && String(meta.disputeId || '').startsWith('d'), meta)
      check('Staff are alerted to respond', (await prisma.notification.count({ where: { ownerId: gym, type: 'dispute' } })) >= 1)
    } else {
      check('Dispute recorded', false, webhooksLive ? `charge did not succeed: ${gCharge.status}` : 'skipped: live webhooks are not reaching the local server')
    }

    // ------------------------------------------------------------------
    begin('10. Webhook endpoint')
    const blank = await post('/api/webhooks/stripe-connect', '{}')
    check('Unsigned request rejected', blank.status === 400, blank)
    const forged = await post('/api/webhooks/stripe-connect', '{"type":"payment_intent.succeeded"}', { 'stripe-signature': 't=1,v1=deadbeef' })
    check('Forged signature rejected', forged.status === 400, forged)
    if (!secret) {
      check('Signed replays', false, 'STRIPE_CONNECT_WEBHOOK_SECRET is not set locally')
    } else {
      const send = (event: Record<string, unknown>) => {
        const payload = JSON.stringify(event)
        return post('/api/webhooks/stripe-connect', payload, { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) })
      }
      const events = await stripe.events.list({ type: 'payment_intent.succeeded', limit: 20 }, { stripeAccount: account })
      const real = events.data.find((e) => (e.data.object as Stripe.PaymentIntent).id === renewalTx.providerReference) || events.data[0]
      const realIntent = real.data.object as Stripe.PaymentIntent
      const targetInvoice = realIntent.metadata.invoiceId
      const before = await invoiceWithTx(targetInvoice)
      const wrongSecret = await post('/api/webhooks/stripe-connect', JSON.stringify({ ...real, account }), { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify({ ...real, account }), secret: 'whsec_wrong' }) })
      check('Correctly formed event signed with the wrong secret rejected', wrongSecret.status === 400)
      const dup = await send({ ...real, account })
      check('Redelivered real event is recognised as a duplicate', dup.status === 200 && (webhooksLive ? dup.json?.duplicate === true : true), dup.json)
      await prisma.paymentEvent.deleteMany({ where: { id: real.id } })
      const reprocessed = await send({ ...real, account })
      const afterReplay = await invoiceWithTx(targetInvoice)
      check('Even with the event log wiped, reprocessing it changes nothing', reprocessed.status === 200 && !reprocessed.json?.duplicate && afterReplay.transactions.length === before.transactions.length && afterReplay.amountPaidCents === before.amountPaidCents, { before: before.transactions.length, after: afterReplay.transactions.length })
      const late = await send({ ...real, id: `evt_test_late_${run}`, type: 'payment_intent.processing', account })
      const afterLate = await invoiceWithTx(targetInvoice)
      check('An out-of-order "processing" event cannot undo a settled payment', late.status === 200 && afterLate.transactions.every((t, i) => t.status === before.transactions[i].status) && afterLate.amountPaidCents === before.amountPaidCents)
      const lateFail = await send({ ...real, id: `evt_test_latefail_${run}`, type: 'payment_intent.payment_failed', account })
      const afterFail = await invoiceWithTx(targetInvoice)
      check('A stale "failed" event cannot undo a settled payment either', lateFail.status === 200 && afterFail.status === before.status && afterFail.attemptCount === before.attemptCount && afterFail.transactions.length === before.transactions.length)
      const unknownType = await send({ ...real, id: `evt_test_unknown_${run}`, type: 'customer.created', account })
      check('Unknown event types are acknowledged and ignored', unknownType.status === 200)
      const unknownAccount = await send({ ...real, id: `evt_test_acct_${run}`, account: 'acct_doesnotexist' })
      check('Events from an unknown account are ignored', unknownAccount.status === 200 && !!unknownAccount.json?.ignored, unknownAccount.json)

      const otherGym = await createGym(`Other Gym ${run}`)
      const otherAccount = `acct_other${run}`
      await prisma.paymentAccount.create({ data: { ownerId: otherGym, providerId: otherAccount, chargesEnabled: true } })
      const victim = await createMember(gym, 'Victim')
      const victimSale = await tx((db) => sellMembership(db, { ownerId: gym, memberId: victim.id, planId: plan.id, paymentMethod: 'cash' }))
      const crossTenant = await send({ ...real, id: `evt_test_cross_${run}`, account: otherAccount, data: { object: { ...realIntent, id: `pi_forged_${run}`, metadata: { ...realIntent.metadata, invoiceId: victimSale.invoice!.id } } } })
      const victimInv = await invoiceWithTx(victimSale.invoice!.id)
      check("A signed event from another gym's account cannot pay this gym's invoice", crossTenant.status === 200 && victimInv.status === 'open' && victimInv.transactions.length === 0, { status: victimInv.status })
    }
    if (webhooksLive) {
      const year = new Date().getFullYear() + 6
      await stripe.paymentMethods.update(visaRow.providerId, { card: { exp_year: year } }, { stripeAccount: account })
      const updated = await until('the payment method update webhook', async () => ((await prisma.paymentMethod.findUniqueOrThrow({ where: { id: visaRow.id } })).expYear === year ? true : null), 45)
      check('A card update at Stripe is reflected in ClubCheck', !!updated)
      await stripe.accounts.update(account, { business_profile: { product_description: `Gym memberships ${run}` } })
      const accountEvent = await until('the account.updated webhook', () => prisma.paymentEvent.findFirst({ where: { account, type: 'account.updated' } }), 45)
      check('Connected account updates are received', !!accountEvent && (await connect.getConnectStatus(gym)).chargesEnabled)
    }

    // ------------------------------------------------------------------
    begin('11. The platform account was never charged')
    const platformIntents = await stripe.paymentIntents.list({ created: { gte: startedAt }, limit: 10 })
    const platformCustomers = await stripe.customers.list({ created: { gte: startedAt }, limit: 10 })
    check('No payments were created on the ClubCheck platform account', platformIntents.data.length === 0, platformIntents.data.map((p) => p.id))
    check('No customers were created on the ClubCheck platform account', platformCustomers.data.length === 0, platformCustomers.data.map((c) => c.id))
    const accountIntents = await stripe.paymentIntents.list({ limit: 100 }, { stripeAccount: account })
    const ours = await prisma.transaction.findMany({ where: { ownerId: gym, provider: 'stripe', type: 'payment', providerReference: { not: null } }, select: { providerReference: true } })
    const known = new Set(ours.map((t) => t.providerReference))
    const unrecorded = accountIntents.data.filter((p) => p.metadata?.ownerId === gym && !known.has(p.id))
    check('Every Stripe payment made for this gym has a ClubCheck transaction', unrecorded.length === 0, unrecorded.map((p) => `${p.id}:${p.status}`))
  } finally {
    if (keep) {
      console.log(`\n(--keep: left test gyms ${gyms.join(', ')} and Stripe accounts ${stripeAccountsToDelete.join(', ')} in place)`)
    } else {
      for (const id of gyms) await prisma.owner.delete({ where: { id } }).catch(() => {})
      for (const id of stripeAccountsToDelete) await stripe.accounts.del(id).catch((e) => console.log(`  (could not delete test account ${id}: ${e.message})`))
    }
    await prisma.$disconnect()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`)
  if (failed.length) {
    console.log('Failed:')
    for (const f of failed) console.log(`  [${f.section}] ${f.name}${f.detail ? ` -> ${f.detail}` : ''}`)
    process.exit(1)
  }
  // Stripe's keep-alive sockets would otherwise hold the process open.
  process.exit(0)
}

main().catch((error) => {
  console.error('\nABORTED:', error?.message || error)
  process.exit(1)
})
