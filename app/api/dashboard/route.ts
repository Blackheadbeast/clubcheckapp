///Users/mahadghazipura/clubcheck/app/api/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner } from '@/lib/demo'

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Helper to get date N days ago at midnight
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

// Helper to format date as YYYY-MM-DD
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

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
    const revenue = activeMembers * 29.99

    // Get owner subscription info
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: {
        planType: true,
        subscriptionStatus: true,
        trialEndsAt: true,
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

    // ========================================
    // TIMESERIES DATA FOR SPARKLINE CHARTS
    // ========================================

    // 1. Active Members Trend (12 weeks)
    const membersTrend: { date: string; value: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const weekStart = daysAgo(i * 7)
      const weekEnd = daysAgo((i - 1) * 7)
      const count = await prisma.member.count({
        where: {
          ownerId: owner.ownerId,
          status: 'active',
          createdAt: { lte: i === 0 ? new Date() : weekEnd },
        },
      })
      membersTrend.push({ date: formatDate(weekStart), value: count })
    }

    // 2. Check-ins per day (14 days)
    const checkinsTrend: { date: string; value: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const dayStart = daysAgo(i)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const count = await prisma.checkin.count({
        where: {
          ownerId: owner.ownerId,
          timestamp: { gte: dayStart, lt: dayEnd },
        },
      })
      checkinsTrend.push({ date: formatDate(dayStart), value: count })
    }

    // 3. Revenue trend (30 days) - simulate based on member count per day
    const revenueTrend: { date: string; value: number }[] = []
    const dailyRate = 29.99 / 30 // Daily rate per member
    for (let i = 29; i >= 0; i--) {
      const day = daysAgo(i)
      // Approximate member count at that time
      const memberCount = await prisma.member.count({
        where: {
          ownerId: owner.ownerId,
          status: 'active',
          createdAt: { lte: day },
        },
      })
      revenueTrend.push({ date: formatDate(day), value: Math.round(memberCount * dailyRate * 100) / 100 })
    }

    // 4. Failed payments trend (30 days) - count members that had payment issues
    const failedPaymentsTrend: { date: string; value: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const dayStart = daysAgo(i)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      // Check billing events for payment failures on that day
      const count = await prisma.billingEvent.count({
        where: {
          ownerId: owner.ownerId,
          type: 'payment_failed',
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      })
      failedPaymentsTrend.push({ date: formatDate(dayStart), value: count })
    }

    // Calculate trial days remaining
    let trialDaysRemaining: number | null = null
    if (ownerData?.trialEndsAt) {
      const remaining = Math.ceil((new Date(ownerData.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      trialDaysRemaining = Math.max(0, remaining)
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
      trialDaysRemaining,
      // Timeseries data
      trends: {
        members: membersTrend,
        checkins: checkinsTrend,
        revenue: revenueTrend,
        failedPayments: failedPaymentsTrend,
      },
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
