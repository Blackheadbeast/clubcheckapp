import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ownerId = owner.ownerId
    const now = new Date()

    // ============ REVENUE (Last 30 days) ============
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Get all members with their subscription data for revenue calculation
    const members = await prisma.member.findMany({
      where: { ownerId, status: 'active' },
      select: {
        id: true,
        createdAt: true,
        subscriptionStatus: true,
      },
    })

    // Assume average $50/member/month for estimation (customize as needed)
    const avgMonthlyPerMember = 50
    const activeCount = members.length
    const mrr = activeCount * avgMonthlyPerMember
    const arr = mrr * 12

    // Generate daily revenue data for last 30 days
    const revenueData: { date: string; revenue: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      // Count members active on this date
      const activeMembersOnDate = members.filter(m => {
        const created = new Date(m.createdAt)
        return created <= date
      }).length

      // Daily revenue estimate
      const dailyRevenue = Math.round((activeMembersOnDate * avgMonthlyPerMember) / 30)
      revenueData.push({ date: dateStr, revenue: dailyRevenue })
    }

    // ============ ATTENDANCE (Last 30 days) ============
    const checkins = await prisma.checkin.findMany({
      where: {
        ownerId,
        timestamp: { gte: thirtyDaysAgo },
      },
      select: {
        timestamp: true,
        memberId: true,
      },
    })

    const attendanceData: { date: string; checkins: number; unique: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      const dayCheckins = checkins.filter(c => {
        const cDate = new Date(c.timestamp).toISOString().split('T')[0]
        return cDate === dateStr
      })

      const uniqueMembers = new Set(dayCheckins.map(c => c.memberId)).size

      attendanceData.push({
        date: dateStr,
        checkins: dayCheckins.length,
        unique: uniqueMembers,
      })
    }

    // ============ MEMBER GROWTH (Last 12 weeks) ============
    const twelveWeeksAgo = new Date(now)
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)

    const allMembers = await prisma.member.findMany({
      where: { ownerId },
      select: {
        createdAt: true,
        status: true,
      },
    })

    const memberGrowthData: { week: string; total: number; new: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const weekEnd = new Date(now)
      weekEnd.setDate(weekEnd.getDate() - (i * 7))
      const weekStart = new Date(weekEnd)
      weekStart.setDate(weekStart.getDate() - 7)

      const weekLabel = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

      const totalByWeekEnd = allMembers.filter(m => new Date(m.createdAt) <= weekEnd).length
      const newThisWeek = allMembers.filter(m => {
        const created = new Date(m.createdAt)
        return created > weekStart && created <= weekEnd
      }).length

      memberGrowthData.push({
        week: weekLabel,
        total: totalByWeekEnd,
        new: newThisWeek,
      })
    }

    // ============ TOP MEMBERS (Last 30 days) ============
    const topMembersRaw = await prisma.checkin.groupBy({
      by: ['memberId'],
      where: {
        ownerId,
        timestamp: { gte: thirtyDaysAgo },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    })

    const topMemberIds = topMembersRaw.map(t => t.memberId)
    const topMemberDetails = await prisma.member.findMany({
      where: { id: { in: topMemberIds } },
      select: { id: true, name: true, email: true },
    })

    const topMembers = topMembersRaw.map(t => {
      const member = topMemberDetails.find(m => m.id === t.memberId)
      return {
        id: t.memberId,
        name: member?.name || 'Unknown',
        email: member?.email || '',
        checkins: t._count.id,
      }
    })

    // ============ SUMMARY STATS ============
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    const checkinsToday = checkins.filter(c => new Date(c.timestamp) >= todayStart).length
    const totalCheckins30d = checkins.length
    const avgCheckinsPerDay = Math.round(totalCheckins30d / 30)

    return NextResponse.json({
      revenue: {
        mrr,
        arr,
        daily: revenueData,
      },
      attendance: {
        today: checkinsToday,
        total30d: totalCheckins30d,
        avgPerDay: avgCheckinsPerDay,
        daily: attendanceData,
      },
      memberGrowth: {
        total: allMembers.length,
        active: activeCount,
        weekly: memberGrowthData,
      },
      topMembers,
    })
  } catch (error) {
    console.error('Analytics error:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
