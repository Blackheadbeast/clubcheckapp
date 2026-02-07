import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET check-in history for a specific member
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify member belongs to owner
    const member = await prisma.member.findFirst({
      where: { id, ownerId: owner.ownerId },
      select: { id: true },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const url = request.nextUrl
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const [checkins, total] = await Promise.all([
      prisma.checkin.findMany({
        where: { memberId: id, ownerId: owner.ownerId },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          timestamp: true,
          source: true,
          deviceName: true,
        },
      }),
      prisma.checkin.count({
        where: { memberId: id, ownerId: owner.ownerId },
      }),
    ])

    return NextResponse.json({ checkins, total })
  } catch (error) {
    console.error('Get member checkins error:', error)
    return NextResponse.json({ error: 'Failed to fetch check-ins' }, { status: 500 })
  }
}
