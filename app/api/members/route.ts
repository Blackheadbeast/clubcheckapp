import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { PLAN_LIMITS } from '@/lib/stripe'
import QRCode from 'qrcode'
import { sendMemberWelcomeEmail } from '@/lib/email'

// GET all members
export async function GET() {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const members = await prisma.member.findMany({
      where: { ownerId: owner.ownerId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ members })
  } catch (error) {
    console.error('Get members error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch members' },
      { status: 500 }
    )
  }
}

// POST - Create new member
export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get owner data
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: { planType: true },
    })

    // Check member limit
    const activeMembers = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
      },
    })

    const limit = ownerData?.planType === 'pro' ? PLAN_LIMITS.pro : PLAN_LIMITS.starter

    if (activeMembers >= limit) {
      return NextResponse.json(
        { 
          error: `Member limit reached. Upgrade to ${ownerData?.planType === 'starter' ? 'Pro' : 'Enterprise'} plan to add more members.`,
          limitReached: true,
        },
        { status: 403 }
      )
    }

    const { name, email, phone } = await request.json()

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email required' },
        { status: 400 }
      )
    }

    // Generate unique QR code data
    const qrData = `clubcheck-member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Generate QR code as data URL
    const qrCodeUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#f59e0b', // primary color
        light: '#0a0a0a', // dark background
      },
    })

    // Create member
    const member = await prisma.member.create({
      data: {
        name,
        email,
        phone: phone || null,
        qrCode: qrData,
        ownerId: owner.ownerId,
      },
    })
    // Send welcome email with QR code
    const emailResult = await sendMemberWelcomeEmail(
      member.email,
      member.name,
      qrCodeUrl
    )

    if (!emailResult.success) {
      console.error('Failed to send welcome email:', emailResult.error)
      // Don't fail the whole request if email fails
    }

   return NextResponse.json({
      member: {
        ...member,
        qrCodeUrl,
      },
      emailSent: emailResult.success,
    })
  } catch (error) {
    console.error('Create member error:', error)
    return NextResponse.json(
      { error: 'Failed to create member' },
      { status: 500 }
    )
  }
}