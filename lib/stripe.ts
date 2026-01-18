import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
})

export const PLAN_LIMITS = {
  starter: 75,
  pro: 150,
}

export const PLAN_PRICES = {
  starter: process.env.STRIPE_PRICE_ID_STARTER!,
  pro: process.env.STRIPE_PRICE_ID_PRO!,
}