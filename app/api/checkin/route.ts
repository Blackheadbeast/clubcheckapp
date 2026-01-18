import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

// POST - Check in a member
export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { qrCode, phoneNumber } = await request.json()

    if (!qrCode && !phoneNumber) {
      return NextResponse.json(
        { error: 'QR code or phone number required' },
        { status: 400 }
      )
    }

    let member

    // Check in by QR code
    if (qrCode) {
      member = await prisma.member.findFirst({
        where: {
          qrCode,
          ownerId: owner.ownerId,
        },
      })
    }
    // Check in by phone number
    else if (phoneNumber) {
      // Clean phone number (remove spaces, dashes, parentheses)
      const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '')
      
      member = await prisma.member.findFirst({
        where: {
          ownerId: owner.ownerId,
          phone: {
            contains: cleanPhone,
          },
        },
      })
    }

    if (!member) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      )
    }

    if (member.status !== 'active') {
      return NextResponse.json(
        { error: 'Member is not active' },
        { status: 403 }
      )
    }

    // Create check-in
    const checkin = await prisma.checkin.create({
      data: {
        memberId: member.id,
        ownerId: owner.ownerId,
      },
    })

    return NextResponse.json({
      success: true,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
      },
      checkin: {
        id: checkin.id,
        timestamp: checkin.timestamp,
      },
      checkinMethod: qrCode ? 'qr' : 'phone',
    })
  } catch (error) {
    console.error('Check-in error:', error)
    return NextResponse.json(
      { error: 'Check-in failed' },
      { status: 500 }
    )
  }
}

// GET - Get recent check-ins
export async function GET() {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get today's check-ins
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const checkins = await prisma.checkin.findMany({
      where: {
        ownerId: owner.ownerId,
        timestamp: {
          gte: today,
        },
      },
      include: {
        member: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: 50,
    })

    return NextResponse.json({ checkins })
  } catch (error) {
    console.error('Get check-ins error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch check-ins' },
      { status: 500 }
    )
  }
}