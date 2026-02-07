//lib/stripe.ts
import Stripe from 'stripe'

let stripeInstance: Stripe | null = null

function getStripeInstance() {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set')
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  }
  return stripeInstance
}

// Export getter function instead of instance
export const stripe = new Proxy({} as Stripe, {
  get: (target, prop) => {
    const instance = getStripeInstance()
    return (instance as any)[prop]
  }
})

export const PLAN_LIMITS = {
  starter: 75,
  pro: 150,
}

export const PLAN_PRICES = {
  starter: {
    monthly: process.env.STRIPE_PRICE_ID_STARTER || '',
    yearly: process.env.STRIPE_PRICE_ID_STARTER_YEARLY || '',
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_ID_PRO || '',
    yearly: process.env.STRIPE_PRICE_ID_PRO_YEARLY || '',
  },
}