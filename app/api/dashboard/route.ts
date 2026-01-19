import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

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

    // Get active members count
    const activeMembers = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
      },
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

    return NextResponse.json({
      activeMembers,
      checkedInToday,
      failedPayments,
      cardsExpiringSoon,
      revenue: revenue.toFixed(2),
      planType: ownerData?.planType || 'starter',
      memberLimit: ownerData?.planType === 'pro' ? 150 : 75,
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard' },
      { status: 500 }
    )
  }
}