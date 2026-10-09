// Payment provider boundary for charging gym members.
//
// ClubCheck never sees or stores card or bank numbers. A provider is handed an
// invoice amount plus the processor's own references for the customer and the
// saved payment method, and returns an outcome with an opaque reference.
//
// Two providers exist:
//   manual  - staff record cash/check/terminal payments; nothing is charged.
//   stripe  - the gym's connected Stripe account (lib/payments/stripe-connect.ts).
//
// The platform's own STRIPE_SECRET_KEY bills gyms for ClubCheck itself. Members
// are only ever charged on the gym's connected account.

import { prisma } from '@/lib/prisma'

export interface ChargeRequest {
  ownerId: string
  invoiceId: string
  memberId: string
  amountCents: number
  currency: string
  description: string
  /** Processor reference for the member (Stripe customer id). */
  customerRef: string
  /** Processor reference for the saved card or bank account. */
  paymentMethodRef: string
  paymentMethodType: string
  /** The same key must always describe the same attempt, so a retried request cannot charge twice. */
  idempotencyKey: string
  receiptEmail?: string | null
}

export type ChargeResult =
  | { status: 'succeeded'; reference: string; cardLast4?: string }
  /** Accepted but not settled yet (bank debits take days); a webhook reports the outcome. */
  | { status: 'processing'; reference: string }
  | { status: 'failed'; failureReason: string; reference?: string }
  /** The provider cannot collect automatically; staff must take payment. */
  | { status: 'requires_manual' }

export interface RefundRequest {
  reference: string
  amountCents: number
  idempotencyKey: string
}

export interface PaymentProvider {
  name: string
  canAutoCharge: boolean
  charge(request: ChargeRequest): Promise<ChargeResult>
  /** Pending: accepted, but the money has not moved yet. A webhook reports how it ends. */
  refund(input: RefundRequest): Promise<{ status: 'succeeded' | 'pending' | 'failed'; reference?: string; failureReason?: string }>
}

export const manualProvider: PaymentProvider = {
  name: 'manual',
  canAutoCharge: false,
  async charge() {
    return { status: 'requires_manual' }
  },
  async refund() {
    // Money is returned outside ClubCheck (cash drawer, terminal); we only record it.
    return { status: 'succeeded' }
  },
}

let override: PaymentProvider | null = null

/** Tests swap in a fake processor; production never calls this. */
export function setPaymentProviderForTests(provider: PaymentProvider | null) {
  override = provider
}

/**
 * A stand-in processor for local development and browser checks, switched on with
 * PAYMENT_PROVIDER=simulate. It moves no money and is ignored in production. A saved method whose
 * reference contains "decline" is declined; anything else succeeds. The same idempotency key always
 * gives the same payment, as a real processor would.
 */
const simulatedProvider: PaymentProvider = {
  name: 'simulated',
  canAutoCharge: true,
  async charge(request) {
    if (request.paymentMethodRef.includes('decline')) return { status: 'failed', failureReason: 'Your card was declined.' }
    return { status: 'succeeded', reference: `sim_${request.idempotencyKey}` }
  },
  async refund(input) {
    return { status: 'succeeded', reference: `sim_refund_${input.idempotencyKey}` }
  },
}
const simulating = () => process.env.PAYMENT_PROVIDER === 'simulate' && process.env.NODE_ENV !== 'production'

/** The provider that can charge this gym's members right now. */
export async function getPaymentProvider(ownerId: string): Promise<PaymentProvider> {
  if (override) return override
  if (simulating()) return simulatedProvider
  const account = await prisma.paymentAccount.findUnique({ where: { ownerId } })
  if (!account || !account.chargesEnabled) return manualProvider
  const { stripeProvider } = await import('./stripe-connect')
  return stripeProvider(account.providerId)
}
