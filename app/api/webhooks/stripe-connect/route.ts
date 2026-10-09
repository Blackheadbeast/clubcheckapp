import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { applyAccountUpdate, forgetPaymentMethod, markAccountDisconnected, saveFromSetupIntent, savePaymentMethod } from '@/lib/payments/stripe-connect'
import { recordDispute, recordExternalRefund, settlePayment, recordRefundFailure } from '@/lib/services/collections'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Webhooks from gyms' connected Stripe accounts (member payments). The gym's
// own ClubCheck subscription is handled separately by /api/stripe/webhook.
//
// Stripe delivers events at least once and in no guaranteed order, so:
//   - every handler is idempotent on the processor's own reference, and
//   - handled event ids are remembered so a redelivery is skipped outright.
// The tenant always comes from the connected account the event belongs to,
// never from metadata, so one gym's event can never touch another's data.

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id || null)

async function handlePaymentIntent(ownerId: string, intent: Stripe.PaymentIntent, outcome: 'succeeded' | 'processing' | 'failed') {
  const invoiceId = intent.metadata?.invoiceId
  if (!invoiceId) return
  const providerMethodId = idOf(intent.payment_method) || idOf(intent.last_payment_error?.payment_method)
  const method = providerMethodId ? await prisma.paymentMethod.findFirst({ where: { ownerId, providerId: providerMethodId } }) : null
  const bank = method ? method.type === 'us_bank_account' : intent.payment_method_types?.includes('us_bank_account') && !intent.payment_method_types.includes('card')
  await settlePayment({
    ownerId,
    invoiceId,
    reference: intent.id,
    outcome,
    amountCents: outcome === 'succeeded' ? intent.amount_received || intent.amount : intent.amount,
    method: bank ? 'ach' : 'card',
    provider: 'stripe',
    cardLast4: method?.last4,
    paymentMethodId: method?.id,
    failureReason: intent.last_payment_error?.message || 'The payment failed.',
  })
}

async function handleRefund(ownerId: string, refund: Stripe.Refund) {
  const paymentReference = idOf(refund.payment_intent)
  // A refund that failed or was cancelled after we recorded it: the money never left, so undo it.
  if (refund.status === 'failed' || refund.status === 'canceled') {
    await recordRefundFailure({ ownerId, refundReference: refund.id, failureReason: refund.failure_reason ? `The bank could not complete the refund (${refund.failure_reason.replace(/_/g, ' ')})` : null })
    return
  }
  if (!paymentReference || (refund.status !== 'succeeded' && refund.status !== 'pending')) return
  await recordExternalRefund({ ownerId, paymentReference, refundReference: refund.id, amountCents: refund.amount, status: refund.status, reason: refund.reason ? `Refunded in Stripe (${refund.reason.replace(/_/g, ' ')})` : null })
}

async function handle(event: Stripe.Event, accountId: string, ownerId: string) {
  switch (event.type) {
    case 'account.updated':
      await applyAccountUpdate(event.data.object)
      return
    case 'account.application.deauthorized':
      await markAccountDisconnected(accountId)
      return
    case 'payment_intent.succeeded':
      return handlePaymentIntent(ownerId, event.data.object, 'succeeded')
    case 'payment_intent.processing':
      return handlePaymentIntent(ownerId, event.data.object, 'processing')
    case 'payment_intent.payment_failed':
      return handlePaymentIntent(ownerId, event.data.object, 'failed')
    case 'setup_intent.succeeded':
      return saveFromSetupIntent(accountId, event.data.object)
    case 'payment_method.detached':
      return forgetPaymentMethod(event.data.object.id)
    case 'payment_method.updated':
    case 'payment_method.automatically_updated': {
      // Card networks push new expiry dates and numbers; keep what we show in step.
      const row = await prisma.paymentMethod.findFirst({ where: { ownerId, providerId: event.data.object.id } })
      if (row) await savePaymentMethod(ownerId, row.memberId, event.data.object)
      return
    }
    case 'charge.refunded': {
      const refunds = await stripe.refunds.list({ charge: event.data.object.id, limit: 100 }, { stripeAccount: accountId })
      for (const refund of refunds.data) await handleRefund(ownerId, refund)
      return
    }
    case 'refund.created':
    case 'refund.updated':
      return handleRefund(ownerId, event.data.object)
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      const dispute = event.data.object
      const paymentReference = idOf(dispute.payment_intent)
      if (!paymentReference) return
      const status = dispute.status === 'won' || dispute.status === 'warning_closed' ? 'won' : dispute.status === 'lost' ? 'lost' : dispute.status.includes('under_review') ? 'under_review' : 'needs_response'
      // A dispute can be reported in the same second as the payment it is about (always, with Stripe's
      // test cards), before the payment has been recorded here. Give the payment a moment to land.
      for (let attempt = 0; attempt < 6; attempt++) {
        if (await recordDispute({ ownerId, paymentReference, disputeReference: dispute.id, status, reason: dispute.reason, amountCents: dispute.amount })) return
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      return
    }
    default:
      // Member billing runs on ClubCheck's own schedule, not Stripe subscriptions, so
      // customer.subscription.* and anything else has nothing to update here.
      return
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Connect webhooks are not configured' }, { status: 503 })
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const accountId = event.account || (event.type === 'account.updated' ? event.data.object.id : null)
  if (!accountId) return NextResponse.json({ received: true, ignored: 'not a connected-account event' })
  const account = await prisma.paymentAccount.findUnique({ where: { providerId: accountId }, select: { ownerId: true } })
  if (!account) return NextResponse.json({ received: true, ignored: 'unknown account' })

  if (await prisma.paymentEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await handle(event, accountId, account.ownerId)
  } catch (error) {
    // A 500 makes Stripe redeliver; the handlers are idempotent, so that is safe.
    console.error(`[stripe-connect] ${event.type} ${event.id} failed:`, error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  try {
    await prisma.paymentEvent.create({ data: { id: event.id, type: event.type, account: accountId } })
  } catch (error) {
    // Two deliveries raced; both ran the idempotent handler, one wins the insert.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
  }
  return NextResponse.json({ received: true })
}
