import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET unresolved billing events
export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const events = await prisma.billingEvent.findMany({
      where: {
        ownerId: owner.ownerId,
        resolvedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({ events })
  } catch (error) {
    console.error('Get billing events error:', error)
    return NextResponse.json({ error: 'Failed to fetch billing events' }, { status: 500 })
  }
}

// PATCH - Resolve/dismiss a billing event
export async function PATCH(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId } = await request.json()
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID required' }, { status: 400 })
    }

    await prisma.billingEvent.updateMany({
      where: {
        id: eventId,
        ownerId: owner.ownerId,
      },
      data: { resolvedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Resolve billing event error:', error)
    return NextResponse.json({ error: 'Failed to resolve event' }, { status: 500 })
  }
}
