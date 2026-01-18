import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { stripe, PLAN_PRICES } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { planType } = await request.json() // 'starter' or 'pro'

    if (!planType || (planType !== 'starter' && planType !== 'pro')) {
      return NextResponse.json(
        { error: 'Invalid plan type' },
        { status: 400 }
      )
    }

    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
    })

    if (!ownerData) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404 }
      )
    }

    let customerId = ownerData.stripeCustomerId

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ownerData.email,
        metadata: {
          ownerId: ownerData.id,
        },
      })
      customerId = customer.id

      await prisma.owner.update({
        where: { id: owner.ownerId },
        data: { stripeCustomerId: customerId },
      })
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: planType === 'starter' ? PLAN_PRICES.starter : PLAN_PRICES.pro,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?canceled=true`,
      metadata: {
        ownerId: owner.ownerId,
        planType,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Create subscription error:', error)
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }
}