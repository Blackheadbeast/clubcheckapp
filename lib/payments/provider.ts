// Payment provider boundary for charging gym members.
//
// ClubCheck never sees or stores card numbers. A provider is handed an invoice
// and returns an outcome plus an opaque reference. Today only the manual
// provider exists: staff record cash/check/terminal payments, and "card on
// file" invoices stay open for collection.
//
// To charge cards automatically, implement this interface on top of Stripe
// Connect (one connected account per gym, PaymentIntents created with
// `on_behalf_of`/`transfer_data`) and return it from getPaymentProvider().
// The platform's own STRIPE_SECRET_KEY bills gyms for ClubCheck itself and
// must not be used to charge their members.

export interface ChargeRequest {
  ownerId: string
  invoiceId: string
  memberId: string
  amountCents: number
  currency: string
  description: string
}

export type ChargeResult =
  | { status: 'succeeded'; reference: string; cardLast4?: string }
  | { status: 'failed'; failureReason: string; reference?: string }
  /** The provider cannot collect automatically; staff must take payment. */
  | { status: 'requires_manual' }

export interface PaymentProvider {
  name: string
  canAutoCharge: boolean
  charge(request: ChargeRequest): Promise<ChargeResult>
  refund(input: { reference: string; amountCents: number }): Promise<{ status: 'succeeded' | 'failed'; reference?: string }>
}

const manualProvider: PaymentProvider = {
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

export function getPaymentProvider(_ownerId: string): PaymentProvider {
  return manualProvider
}
