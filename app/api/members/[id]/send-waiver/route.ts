import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { sendWaiverEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (isDemoOwner(owner.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    // Get member
    const member = await prisma.member.findFirst({
      where: { id, ownerId: owner.ownerId },
      select: {
        id: true,
        name: true,
        email: true,
        waiverSignedAt: true,
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.waiverSignedAt) {
      return NextResponse.json({ error: 'Waiver already signed' }, { status: 400 })
    }

    // Get gym profile
    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: {
        name: true,
        waiverEnabled: true,
        waiverText: true,
      },
    })

    if (!gymProfile?.waiverEnabled || !gymProfile?.waiverText) {
      return NextResponse.json(
        { error: 'Waiver is not enabled. Enable it in Settings > Waiver.' },
        { status: 400 }
      )
    }

    // Build waiver link
    const host = request.headers.get('host') || 'localhost:3000'
    const protocol = host.includes('localhost') ? 'http' : 'https'
    const waiverLink = `${protocol}://${host}/waiver/${member.id}`

    // Send email
    const result = await sendWaiverEmail(
      member.email,
      member.name,
      gymProfile.name || 'Your Gym',
      waiverLink
    )

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send waiver email error:', error)
    return NextResponse.json({ error: 'Failed to send waiver email' }, { status: 500 })
  }
}
