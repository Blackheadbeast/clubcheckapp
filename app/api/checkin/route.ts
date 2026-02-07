import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const checkinSchema = z.object({
  qrCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  source: z.enum(['qr', 'phone', 'kiosk', 'manual']).optional(),
  deviceName: z.string().optional(),
}).refine(
  (data) => data.qrCode || data.phoneNumber,
  { message: 'QR code or phone number required' }
)

// POST - Check in a member
export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = checkinSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { qrCode, phoneNumber, source, deviceName } = parsed.data
    let member

    if (qrCode) {
      member = await prisma.member.findFirst({
        where: { qrCode, ownerId: owner.ownerId },
      })
    } else if (phoneNumber) {
      const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '')
      member = await prisma.member.findFirst({
        where: {
          ownerId: owner.ownerId,
          phone: { contains: cleanPhone },
        },
      })
    }

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.status !== 'active') {
      return NextResponse.json({ error: 'Member is not active' }, { status: 403 })
    }

    const checkinSource = source || (qrCode ? 'qr' : 'phone')
    const now = new Date()

    // Create check-in and update lastCheckInAt in a transaction
    const [checkin] = await prisma.$transaction([
      prisma.checkin.create({
        data: {
          memberId: member.id,
          ownerId: owner.ownerId,
          source: checkinSource,
          deviceName: deviceName || null,
        },
      }),
      prisma.member.update({
        where: { id: member.id },
        data: { lastCheckInAt: now },
      }),
    ])

    return NextResponse.json({
      success: true,
      member: { id: member.id, name: member.name, email: member.email },
      checkin: { id: checkin.id, timestamp: checkin.timestamp },
      checkinMethod: checkinSource,
    })
  } catch (error) {
    console.error('Check-in error:', error)
    return NextResponse.json({ error: 'Check-in failed' }, { status: 500 })
  }
}

// GET - Get check-ins with optional date range
export async function GET(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = request.nextUrl
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    // Default: today
    const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0))
    const dateTo = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : new Date()

    const checkins = await prisma.checkin.findMany({
      where: {
        ownerId: owner.ownerId,
        timestamp: { gte: dateFrom, lte: dateTo },
      },
      include: {
        member: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 200,
    })

    return NextResponse.json({ checkins })
  } catch (error) {
    console.error('Get check-ins error:', error)
    return NextResponse.json({ error: 'Failed to fetch check-ins' }, { status: 500 })
  }
}
