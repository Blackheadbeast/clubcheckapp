import { NextResponse } from 'next/server'
import { getOwnerFromCookie } from '@/lib/auth'
import { getOwnerBillingState } from '@/lib/billing'
import { prisma } from '@/lib/prisma'
import { isDemoOwner } from '@/lib/demo'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await getOwnerFromCookie()
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Demo accounts always show as active
    if (isDemoOwner(auth.ownerId)) {
      return NextResponse.json({
        status: 'active',
        canWrite: true,
        canRead: true,
        message: null,
        daysRemaining: null,
        planType: 'pro',
        memberLimit: 150,
        memberCount: 0,
        isDemo: true,
      })
    }

    const billingState = await getOwnerBillingState(auth.ownerId)

    if (!billingState) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    // Get current member count and raw owner fields for billing page
    const [memberCount, owner] = await Promise.all([
      prisma.member.count({
        where: { ownerId: auth.ownerId, status: 'active' },
      }),
      prisma.owner.findUnique({
        where: { id: auth.ownerId },
        select: {
          subscriptionStatus: true,
          trialEndsAt: true,
        },
      }),
    ])

    return NextResponse.json({
      ...billingState,
      subscriptionStatus: owner?.subscriptionStatus || null,
      trialEndsAt: owner?.trialEndsAt || null,
      activeMembers: memberCount,
      memberCount,
      isDemo: false,
    })
  } catch (error) {
    console.error('Billing status error:', error)
    return NextResponse.json({ error: 'Failed to get billing status' }, { status: 500 })
  }
}
