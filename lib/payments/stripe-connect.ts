// Stripe Connect: each gym connects its own Stripe account and its members are
// charged there with direct charges (the `stripeAccount` request option). The
// gym is the merchant of record; ClubCheck's platform key only orchestrates.
//
// Customers, saved payment methods, payments, refunds and disputes all live on
// the connected account, so one gym's customers are invisible to another's.

import Stripe from 'stripe'
import type { Member, PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { ApiError, badRequest, notFound } from '@/lib/api'
import type { ChargeRequest, ChargeResult, PaymentProvider, RefundRequest } from './provider'

export function connectConfigured() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
}

/** ClubCheck's cut of each member payment, in cents. 0 unless STRIPE_CONNECT_FEE_BPS is set. */
export function platformFeeCents(amountCents: number) {
  const bps = Number(process.env.STRIPE_CONNECT_FEE_BPS || 0)
  if (!Number.isFinite(bps) || bps <= 0) return 0
  return Math.floor((amountCents * Math.min(bps, 2000)) / 10_000)
}

function stripeMessage(error: unknown, fallback: string) {
  return error instanceof Stripe.errors.StripeError ? error.message || fallback : fallback
}

// --- The gym's account -------------------------------------------------------

export async function applyAccountUpdate(account: Stripe.Account) {
  await prisma.paymentAccount.updateMany({
    where: { providerId: account.id },
    data: {
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
      disabledReason: account.requirements?.disabled_reason || null,
    },
  })
}

/** The gym revoked ClubCheck's access from its Stripe dashboard. */
export async function markAccountDisconnected(providerId: string) {
  await prisma.paymentAccount.updateMany({
    where: { providerId },
    data: { chargesEnabled: false, payoutsEnabled: false, disabledReason: 'disconnected' },
  })
}

/** Current connection state, refreshed from Stripe when an account exists. */
export async function getConnectStatus(ownerId: string, refresh = false) {
  let account = await prisma.paymentAccount.findUnique({ where: { ownerId } })
  if (account && refresh && connectConfigured() && account.disabledReason !== 'disconnected') {
    try {
      await applyAccountUpdate(await stripe.accounts.retrieve(account.providerId))
      account = await prisma.paymentAccount.findUnique({ where: { ownerId } })
    } catch (error) {
      console.error('[connect] could not refresh account for owner', ownerId, stripeMessage(error, 'unknown error'))
    }
  }
  return {
    configured: connectConfigured(),
    connected: !!account,
    chargesEnabled: !!account?.chargesEnabled,
    payoutsEnabled: !!account?.payoutsEnabled,
    detailsSubmitted: !!account?.detailsSubmitted,
    disabledReason: account?.disabledReason || null,
    accountId: account?.providerId || null,
    platformFeeBps: Math.max(0, Number(process.env.STRIPE_CONNECT_FEE_BPS || 0) || 0),
  }
}

/** Create the gym's Stripe account if needed and return a hosted onboarding link. */
export async function startOnboarding(ownerId: string, origin: string) {
  if (!connectConfigured()) throw new ApiError(503, 'Card payments are not configured on this ClubCheck installation.', 'connect_unavailable')
  let account = await prisma.paymentAccount.findUnique({ where: { ownerId } })
  if (account?.disabledReason === 'disconnected') {
    await prisma.paymentAccount.delete({ where: { ownerId } })
    account = null
  }
  if (!account) {
    const owner = await prisma.owner.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true, gymProfile: { select: { name: true } } } })
    let created: Stripe.Account
    try {
      created = await stripe.accounts.create({
        type: 'standard',
        email: owner.email,
        business_profile: owner.gymProfile?.name ? { name: owner.gymProfile.name } : undefined,
        metadata: { ownerId },
      })
    } catch (error) {
      throw new ApiError(502, stripeMessage(error, 'Stripe could not create the account. Please try again.'), 'connect_failed')
    }
    account = await prisma.paymentAccount.create({ data: { ownerId, providerId: created.id } })
  }
  try {
    const link = await stripe.accountLinks.create({
      account: account.providerId,
      type: 'account_onboarding',
      refresh_url: `${origin}/settings/payments?connect=refresh`,
      return_url: `${origin}/settings/payments?connect=return`,
    })
    return { url: link.url }
  } catch (error) {
    throw new ApiError(502, stripeMessage(error, 'Stripe could not start onboarding. Please try again.'), 'connect_failed')
  }
}

async function requireAccount(ownerId: string) {
  const account = await prisma.paymentAccount.findUnique({ where: { ownerId } })
  if (!account || !account.chargesEnabled) {
    throw badRequest('Connect Stripe in Settings → Payments before saving cards or bank accounts.', 'payments_not_connected')
  }
  return account
}

// --- Members' saved payment methods -----------------------------------------

async function ensureCustomer(member: Member, accountId: string) {
  if (member.connectCustomerId) return member.connectCustomerId
  const customer = await stripe.customers.create(
    { name: member.name, email: member.email, phone: member.phone || undefined, metadata: { memberId: member.id, ownerId: member.ownerId } },
    { stripeAccount: accountId, idempotencyKey: `customer:${member.id}` }
  )
  await prisma.member.update({ where: { id: member.id }, data: { connectCustomerId: customer.id } })
  return customer.id
}

/** Start saving a card or bank account. The browser completes it with Stripe.js; no numbers touch our server. */
export async function createSetupIntent(ownerId: string, memberId: string) {
  const account = await requireAccount(ownerId)
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId } })
  if (!member) throw notFound('Member')
  const settings = await prisma.gymProfile.findUnique({ where: { ownerId }, select: { currency: true } })
  const usd = (settings?.currency || 'usd') === 'usd'
  try {
    const customer = await ensureCustomer(member, account.providerId)
    const create = (types: string[]) =>
      stripe.setupIntents.create(
        { customer, usage: 'off_session', payment_method_types: types, metadata: { memberId, ownerId } },
        { stripeAccount: account.providerId }
      )
    let intent: Stripe.SetupIntent
    try {
      intent = await create(usd ? ['card', 'us_bank_account'] : ['card'])
    } catch (error) {
      // Bank debits are not switched on for every Stripe account; cards always are.
      if (!usd || !(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error
      intent = await create(['card'])
    }
    return { clientSecret: intent.client_secret, stripeAccountId: account.providerId, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '' }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, stripeMessage(error, 'Stripe is unavailable. Please try again.'), 'processor_error')
  }
}

function describe(pm: Stripe.PaymentMethod) {
  if (pm.type === 'card' && pm.card) {
    return { type: 'card', brand: pm.card.brand, bankName: null, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year }
  }
  if (pm.type === 'us_bank_account' && pm.us_bank_account) {
    return { type: 'us_bank_account', brand: null, bankName: pm.us_bank_account.bank_name || null, last4: pm.us_bank_account.last4 || '', expMonth: null, expYear: null }
  }
  return null
}

/** Store (or refresh) a payment method that Stripe has attached to this member. */
export async function savePaymentMethod(ownerId: string, memberId: string, pm: Stripe.PaymentMethod) {
  const details = describe(pm)
  if (!details) return null
  const existing = await prisma.paymentMethod.findUnique({ where: { providerId: pm.id } })
  if (existing) {
    // A payment method id belongs to exactly one member; never let it move.
    if (existing.ownerId !== ownerId || existing.memberId !== memberId) return null
    return prisma.paymentMethod.update({ where: { id: existing.id }, data: details })
  }
  const hasDefault = await prisma.paymentMethod.count({ where: { ownerId, memberId, isDefault: true } })
  // The browser's confirmation and Stripe's webhook both report a newly saved method, often in the
  // same moment. Whichever arrives second finds the row already there and takes it as it is.
  const created = await prisma.paymentMethod.createMany({ data: [{ ownerId, memberId, providerId: pm.id, ...details, isDefault: hasDefault === 0 }], skipDuplicates: true })
  const row = await prisma.paymentMethod.findUnique({ where: { providerId: pm.id } })
  if (!row || row.ownerId !== ownerId || row.memberId !== memberId) return null
  if (created.count === 0) return row
  // Two different methods saved at once could both have seen "no default yet": keep exactly one.
  const defaults = await prisma.paymentMethod.findMany({ where: { ownerId, memberId, isDefault: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
  if (defaults.length > 1) await prisma.paymentMethod.updateMany({ where: { id: { in: defaults.slice(1).map((d) => d.id) } }, data: { isDefault: false } })
  return prisma.paymentMethod.findUnique({ where: { id: row.id } })
}

/** Called after the browser confirms a SetupIntent: verify it with Stripe and store the result. */
export async function syncSetupIntent(ownerId: string, memberId: string, setupIntentId: string) {
  const account = await requireAccount(ownerId)
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId } })
  if (!member || !member.connectCustomerId) throw notFound('Member')
  let intent: Stripe.SetupIntent
  try {
    intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] }, { stripeAccount: account.providerId })
  } catch {
    throw notFound('Payment method')
  }
  // The intent must belong to this member's customer, not merely to this gym.
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id
  if (customer !== member.connectCustomerId) throw notFound('Payment method')
  if (intent.status === 'requires_action' || intent.status === 'processing') {
    return { status: 'pending' as const, paymentMethod: null }
  }
  if (intent.status !== 'succeeded' || !intent.payment_method || typeof intent.payment_method === 'string') {
    throw badRequest('That payment method could not be saved. Please try again.', 'setup_failed')
  }
  const saved = await savePaymentMethod(ownerId, memberId, intent.payment_method)
  if (!saved) throw badRequest('That type of payment method is not supported.', 'unsupported_method')
  return { status: 'saved' as const, paymentMethod: saved }
}

/** Webhook path for the same thing (bank accounts verified by micro-deposit finish days later). */
export async function saveFromSetupIntent(accountId: string, intent: Stripe.SetupIntent) {
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id
  if (!customer || !intent.payment_method) return
  const account = await prisma.paymentAccount.findUnique({ where: { providerId: accountId } })
  if (!account) return
  const member = await prisma.member.findFirst({ where: { ownerId: account.ownerId, connectCustomerId: customer } })
  if (!member) return
  const pm =
    typeof intent.payment_method === 'string'
      ? await stripe.paymentMethods.retrieve(intent.payment_method, {}, { stripeAccount: accountId })
      : intent.payment_method
  await savePaymentMethod(account.ownerId, member.id, pm)
}

export function publicPaymentMethod(pm: PaymentMethod) {
  return { id: pm.id, type: pm.type, brand: pm.brand, bankName: pm.bankName, last4: pm.last4, expMonth: pm.expMonth, expYear: pm.expYear, isDefault: pm.isDefault, createdAt: pm.createdAt }
}

export async function listPaymentMethods(ownerId: string, memberId: string) {
  const rows = await prisma.paymentMethod.findMany({ where: { ownerId, memberId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] })
  return rows.map(publicPaymentMethod)
}

export async function setDefaultPaymentMethod(ownerId: string, memberId: string, id: string) {
  const pm = await prisma.paymentMethod.findFirst({ where: { id, ownerId, memberId } })
  if (!pm) throw notFound('Payment method')
  await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { ownerId, memberId, isDefault: true }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id: pm.id }, data: { isDefault: true } }),
  ])
  return publicPaymentMethod({ ...pm, isDefault: true })
}

/** Forget a row and promote another to default if needed. Does not talk to Stripe. */
export async function forgetPaymentMethod(providerId: string) {
  const pm = await prisma.paymentMethod.findUnique({ where: { providerId } })
  if (!pm) return
  await prisma.paymentMethod.delete({ where: { id: pm.id } })
  if (pm.isDefault) {
    const next = await prisma.paymentMethod.findFirst({ where: { ownerId: pm.ownerId, memberId: pm.memberId }, orderBy: { createdAt: 'desc' } })
    if (next) await prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } })
  }
}

export async function removePaymentMethod(ownerId: string, memberId: string, id: string) {
  const pm = await prisma.paymentMethod.findFirst({ where: { id, ownerId, memberId } })
  if (!pm) throw notFound('Payment method')
  const account = await prisma.paymentAccount.findUnique({ where: { ownerId } })
  if (account && connectConfigured()) {
    try {
      await stripe.paymentMethods.detach(pm.providerId, {}, { stripeAccount: account.providerId })
    } catch (error) {
      // Already detached at Stripe is fine; anything else should not leave a chargeable method behind.
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
        throw new ApiError(502, stripeMessage(error, 'Stripe is unavailable. Please try again.'), 'processor_error')
      }
    }
  }
  await forgetPaymentMethod(pm.providerId)
}

// --- Charging ----------------------------------------------------------------

export function stripeProvider(accountId: string): PaymentProvider {
  return {
    name: 'stripe',
    canAutoCharge: true,

    async charge(request: ChargeRequest): Promise<ChargeResult> {
      const fee = platformFeeCents(request.amountCents)
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: request.amountCents,
            currency: request.currency,
            customer: request.customerRef,
            payment_method: request.paymentMethodRef,
            payment_method_types: [request.paymentMethodType],
            off_session: true,
            confirm: true,
            description: request.description,
            receipt_email: request.receiptEmail || undefined,
            metadata: { ownerId: request.ownerId, invoiceId: request.invoiceId, memberId: request.memberId },
            ...(fee > 0 && { application_fee_amount: fee }),
          },
          { stripeAccount: accountId, idempotencyKey: request.idempotencyKey }
        )
        if (intent.status === 'succeeded') return { status: 'succeeded', reference: intent.id }
        if (intent.status === 'processing') return { status: 'processing', reference: intent.id }
        // Anything else off-session means the bank wants the cardholder present.
        return { status: 'failed', reference: intent.id, failureReason: 'The bank needs the cardholder to approve this payment. Ask them to pay from their account or update the card.' }
      } catch (error) {
        if (error instanceof Stripe.errors.StripeCardError) {
          return { status: 'failed', reference: error.payment_intent?.id, failureReason: error.message || 'The card was declined.' }
        }
        if (error instanceof Stripe.errors.StripeIdempotencyError) {
          // Another charge for this invoice is already in flight with a different payment method.
          throw new ApiError(409, 'A payment for this invoice is already being processed. Check again in a moment.', 'payment_in_progress')
        }
        if (error instanceof Stripe.errors.StripeInvalidRequestError) {
          return { status: 'failed', failureReason: error.message || 'The payment method could not be charged.' }
        }
        // Network and Stripe-side errors are not a decline: let the caller retry later.
        throw error
      }
    },

    async refund(input: RefundRequest) {
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: input.reference, amount: input.amountCents },
          { stripeAccount: accountId, idempotencyKey: input.idempotencyKey }
        )
        if (refund.status === 'failed' || refund.status === 'canceled') {
          return { status: 'failed', reference: refund.id, failureReason: refund.failure_reason || 'The refund failed.' }
        }
        return { status: refund.status === 'pending' || refund.status === 'requires_action' ? 'pending' : 'succeeded', reference: refund.id }
      } catch (error) {
        return { status: 'failed', failureReason: stripeMessage(error, 'Stripe could not process the refund.') }
      }
    },
  }
}
