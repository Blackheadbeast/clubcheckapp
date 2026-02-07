import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * Apply referral credit to the referring owner.
 *
 * For Stripe billing: Creates a $50 credit (1 month equivalent) on the customer's account.
 * For External billing: Extends freeUntil by 1 month.
 *
 * This is called internally when a referred gym makes their first successful payment.
 */
export async function POST(request: NextRequest) {
  try {
    // This endpoint should only be called internally (from webhook)
    const authHeader = request.headers.get('x-internal-key')
    if (authHeader !== process.env.JWT_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { referredOwnerId } = await request.json()

    if (!referredOwnerId) {
      return NextResponse.json({ error: 'Missing referredOwnerId' }, { status: 400 })
    }

    // Get the referred owner's referral record to find who referred them
    const referredReferral = await prisma.referral.findUnique({
      where: { ownerId: referredOwnerId },
    })

    if (!referredReferral || !referredReferral.referredByOwnerId) {
      // No referrer, nothing to credit
      return NextResponse.json({ success: true, credited: false, reason: 'No referrer' })
    }

    // Check if we already credited for this referral
    const existingCredit = await prisma.billingEvent.findFirst({
      where: {
        ownerId: referredReferral.referredByOwnerId,
        type: 'referral_credit',
        message: { contains: referredOwnerId },
      },
    })

    if (existingCredit) {
      return NextResponse.json({ success: true, credited: false, reason: 'Already credited' })
    }

    // Get the referring owner
    const referringOwner = await prisma.owner.findUnique({
      where: { id: referredReferral.referredByOwnerId },
      include: { gymProfile: true },
    })

    if (!referringOwner) {
      return NextResponse.json({ error: 'Referring owner not found' }, { status: 404 })
    }

    const billingMode = referringOwner.gymProfile?.billingMode || 'stripe'

    if (billingMode === 'stripe' && referringOwner.stripeCustomerId) {
      // Apply Stripe credit ($50 = 5000 cents, approximately 1 month)
      try {
        await stripe.customers.createBalanceTransaction(referringOwner.stripeCustomerId, {
          amount: -5000, // Negative = credit
          currency: 'usd',
          description: 'Referral credit - 1 month free for referring a new gym',
        })
      } catch (stripeError) {
        console.error('Stripe credit error:', stripeError)
        // Continue anyway to record the event
      }
    } else {
      // External billing: extend freeUntil
      const currentFreeUntil = referringOwner.gymProfile?.freeUntil || new Date()
      const newFreeUntil = new Date(Math.max(currentFreeUntil.getTime(), Date.now()))
      newFreeUntil.setMonth(newFreeUntil.getMonth() + 1)

      await prisma.gymProfile.upsert({
        where: { ownerId: referringOwner.id },
        create: {
          ownerId: referringOwner.id,
          freeUntil: newFreeUntil,
        },
        update: {
          freeUntil: newFreeUntil,
        },
      })
    }

    // Update the referrer's credited months
    await prisma.referral.update({
      where: { ownerId: referringOwner.id },
      data: {
        creditedMonths: { increment: 1 },
      },
    })

    // Create billing event for the credit
    await prisma.billingEvent.create({
      data: {
        ownerId: referringOwner.id,
        type: 'referral_credit',
        message: `You earned 1 free month for referring a new gym! (Ref: ${referredOwnerId.slice(0, 8)})`,
        resolvedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, credited: true })
  } catch (error) {
    console.error('Apply referral credit error:', error)
    return NextResponse.json({ error: 'Failed to apply credit' }, { status: 500 })
  }
}
