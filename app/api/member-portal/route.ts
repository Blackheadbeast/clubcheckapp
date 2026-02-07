import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const updateProfileSchema = z.object({
  token: z.string(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
})

// GET member portal data by access token
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: {
        accessToken: token,
        accessTokenExpiry: { gt: new Date() },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        qrCode: true,
        status: true,
        createdAt: true,
        lastCheckInAt: true,
        currentStreak: true,
        longestStreak: true,
        waiverSignedAt: true,
        owner: {
          select: {
            gymProfile: {
              select: {
                name: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
    }

    // Get recent check-ins
    const recentCheckins = await prisma.checkin.findMany({
      where: { memberId: member.id },
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: {
        id: true,
        timestamp: true,
        source: true,
      },
    })

    // Calculate streak badge
    let badge = null
    if (member.longestStreak >= 100) {
      badge = { name: 'Century Club', icon: 'trophy', level: 'gold' }
    } else if (member.longestStreak >= 30) {
      badge = { name: 'Monthly Master', icon: 'star', level: 'silver' }
    } else if (member.longestStreak >= 7) {
      badge = { name: 'Week Warrior', icon: 'fire', level: 'bronze' }
    }

    return NextResponse.json({
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        qrCode: member.qrCode,
        status: member.status,
        createdAt: member.createdAt,
        lastCheckInAt: member.lastCheckInAt,
        currentStreak: member.currentStreak,
        longestStreak: member.longestStreak,
        waiverSigned: !!member.waiverSignedAt,
      },
      gym: {
        name: member.owner.gymProfile?.name || 'Your Gym',
        logoUrl: member.owner.gymProfile?.logoUrl || null,
      },
      recentCheckins,
      badge,
    })
  } catch (error) {
    console.error('Member portal error:', error)
    return NextResponse.json({ error: 'Failed to fetch member data' }, { status: 500 })
  }
}

// PATCH update member profile
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = updateProfileSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { token, phone, email } = parsed.data

    const member = await prisma.member.findFirst({
      where: {
        accessToken: token,
        accessTokenExpiry: { gt: new Date() },
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
    }

    const updates: { phone?: string; email?: string } = {}
    if (phone !== undefined) updates.phone = phone
    if (email !== undefined) updates.email = email

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    await prisma.member.update({
      where: { id: member.id },
      data: updates,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Member portal update error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
