import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET waiver settings
export async function GET() {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: {
        waiverEnabled: true,
        waiverText: true,
      },
    })

    return NextResponse.json({
      waiverEnabled: gymProfile?.waiverEnabled || false,
      waiverText: gymProfile?.waiverText || '',
    })
  } catch (error) {
    console.error('Get waiver settings error:', error)
    return NextResponse.json({ error: 'Failed to load waiver settings' }, { status: 500 })
  }
}

// PUT update waiver settings
export async function PUT(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (isDemoOwner(owner.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    const body = await request.json()
    const { waiverEnabled, waiverText } = body

    await prisma.gymProfile.upsert({
      where: { ownerId: owner.ownerId },
      create: {
        ownerId: owner.ownerId,
        waiverEnabled: waiverEnabled ?? false,
        waiverText: waiverText || null,
      },
      update: {
        waiverEnabled: waiverEnabled ?? false,
        waiverText: waiverText || null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update waiver settings error:', error)
    return NextResponse.json({ error: 'Failed to save waiver settings' }, { status: 500 })
  }
}
