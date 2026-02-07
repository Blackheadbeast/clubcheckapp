import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { PLAN_LIMITS } from '@/lib/stripe'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST convert prospect to member
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

    // Get the prospect
    const prospect = await prisma.prospect.findFirst({
      where: { id, ownerId: owner.ownerId },
    })

    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
    }

    if (prospect.status === 'converted') {
      return NextResponse.json({ error: 'Prospect already converted' }, { status: 400 })
    }

    // Check member limit
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: { planType: true },
    })

    const activeMembers = await prisma.member.count({
      where: { ownerId: owner.ownerId, status: 'active' },
    })

    const limit = ownerData?.planType === 'pro' ? PLAN_LIMITS.pro : PLAN_LIMITS.starter
    if (activeMembers >= limit) {
      return NextResponse.json(
        { error: `Member limit reached. Upgrade your plan to add more members.` },
        { status: 403 }
      )
    }

    // Generate QR code
    const qrData = `clubcheck-member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const qrCodeUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: '#f59e0b', light: '#0a0a0a' },
    })

    // Create member from prospect
    const member = await prisma.member.create({
      data: {
        name: prospect.name,
        email: prospect.email,
        phone: prospect.phone,
        qrCode: qrData,
        ownerId: owner.ownerId,
      },
    })

    // Update prospect to converted
    await prisma.prospect.update({
      where: { id },
      data: {
        status: 'converted',
        convertedAt: new Date(),
        convertedMemberId: member.id,
      },
    })

    // Send welcome email (non-blocking)
    try {
      const { sendMemberWelcomeEmail } = await import('@/lib/email')
      await sendMemberWelcomeEmail(member.email, member.name, qrCodeUrl)
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError)
    }

    return NextResponse.json({
      success: true,
      member: { ...member, qrCodeUrl },
    })
  } catch (error) {
    console.error('Convert prospect error:', error)
    return NextResponse.json({ error: 'Failed to convert prospect' }, { status: 500 })
  }
}
