///Users/mahadghazipura/clubcheck/app/api/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner } from '@/lib/demo'

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export async function GET() {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get gym profile for setup progress
    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
    })

    // Get active members count
    const activeMembers = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
      },
    })

    // Get total members count (for setup check)
    const totalMembers = await prisma.member.count({
      where: { ownerId: owner.ownerId },
    })

    // Get today's check-ins
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const checkedInToday = await prisma.checkin.count({
      where: {
        ownerId: owner.ownerId,
        timestamp: {
          gte: today,
        },
      },
    })

    // Get total check-ins (for setup check)
    const totalCheckins = await prisma.checkin.count({
      where: { ownerId: owner.ownerId },
    })

    // Get failed payments (members with past_due or unpaid subscription status)
    const failedPayments = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        subscriptionStatus: {
          in: ['past_due', 'unpaid'],
        },
      },
    })

    // Get cards expiring soon (within 2 months)
    const twoMonthsFromNow = new Date()
    twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2)
    const currentYear = twoMonthsFromNow.getFullYear()
    const currentMonth = twoMonthsFromNow.getMonth() + 1

    const cardsExpiringSoon = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
        OR: [
          {
            cardExpiryYear: currentYear,
            cardExpiryMonth: {
              lte: currentMonth,
            },
          },
          {
            cardExpiryYear: {
              lt: currentYear,
            },
          },
        ],
      },
    })

    // Calculate revenue this month (active members * their subscription amount)
    // For simplicity, we'll just count active members and assume pricing
    // In a real app, you'd query Stripe for actual revenue
    const revenue = activeMembers * 29.99 // Example: $29.99 per member

    // Get owner subscription info
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: {
        planType: true,
        subscriptionStatus: true,
      },
    })

    // Get unresolved billing events
    const billingAlerts = await prisma.billingEvent.findMany({
      where: {
        ownerId: owner.ownerId,
        resolvedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        message: true,
        createdAt: true,
      },
    })

    // Build setup progress
    const setupProgress = {
      gymName: !!gymProfile?.name,
      firstMember: totalMembers > 0,
      kioskPin: !!gymProfile?.kioskPinHash,
      firstCheckin: totalCheckins > 0,
      dismissed: !!gymProfile?.setupDismissedAt,
      isDemo: isDemoOwner(owner.ownerId),
    }

    return NextResponse.json({
      activeMembers,
      checkedInToday,
      failedPayments,
      cardsExpiringSoon,
      revenue: revenue.toFixed(2),
      planType: ownerData?.planType || 'starter',
      subscriptionStatus: ownerData?.subscriptionStatus || null,
      memberLimit: ownerData?.planType === 'pro' ? 150 : 75,
      billingAlerts,
      setupProgress,
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard' },
      { status: 500 }
    )
  }
}

// PATCH - Dismiss setup wizard
export async function PATCH(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    if (body.action === 'dismiss-setup') {
      await prisma.gymProfile.upsert({
        where: { ownerId: owner.ownerId },
        create: {
          ownerId: owner.ownerId,
          setupDismissedAt: new Date(),
        },
        update: {
          setupDismissedAt: new Date(),
        },
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Dashboard PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
