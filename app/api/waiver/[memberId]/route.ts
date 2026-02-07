import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET waiver for a member (public - no auth required for signing)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        email: true,
        waiverSignedAt: true,
        waiverSignature: true,
        owner: {
          select: {
            gymProfile: {
              select: {
                name: true,
                waiverEnabled: true,
                waiverText: true,
              },
            },
          },
        },
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const gymProfile = member.owner.gymProfile

    if (!gymProfile?.waiverEnabled || !gymProfile?.waiverText) {
      return NextResponse.json({ error: 'Waiver not available' }, { status: 404 })
    }

    return NextResponse.json({
      memberId: member.id,
      memberName: member.name,
      memberEmail: member.email,
      gymName: gymProfile.name || 'Your Gym',
      waiverText: gymProfile.waiverText,
      alreadySigned: !!member.waiverSignedAt,
      signedAt: member.waiverSignedAt,
      signature: member.waiverSignature,
    })
  } catch (error) {
    console.error('Get waiver error:', error)
    return NextResponse.json({ error: 'Failed to load waiver' }, { status: 500 })
  }
}

// POST sign waiver (public - member signs their own waiver)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params
    const body = await request.json()
    const { signature, email } = body

    if (!signature || !email) {
      return NextResponse.json(
        { error: 'Signature and email are required' },
        { status: 400 }
      )
    }

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        email: true,
        waiverSignedAt: true,
        owner: {
          select: {
            gymProfile: {
              select: {
                waiverEnabled: true,
                waiverText: true,
              },
            },
          },
        },
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Verify email matches
    if (member.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { error: 'Email does not match our records' },
        { status: 400 }
      )
    }

    const gymProfile = member.owner.gymProfile

    if (!gymProfile?.waiverEnabled || !gymProfile?.waiverText) {
      return NextResponse.json({ error: 'Waiver not available' }, { status: 404 })
    }

    if (member.waiverSignedAt) {
      return NextResponse.json({ error: 'Waiver already signed' }, { status: 400 })
    }

    // Sign the waiver
    await prisma.member.update({
      where: { id: memberId },
      data: {
        waiverSignedAt: new Date(),
        waiverSignature: signature,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Sign waiver error:', error)
    return NextResponse.json({ error: 'Failed to sign waiver' }, { status: 500 })
  }
}
