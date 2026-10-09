import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { recordFailedSignIn, signInBlocked } from '@/lib/login-attempts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET waiver for a member (public - no auth required for signing)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params
    // A public page: one visitor does not get to walk through IDs.
    if (!checkRateLimit(`waiver:${getClientIP(request)}`, { windowMs: 60_000, maxRequests: 30 }).allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
    }

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
      // The email is deliberately not returned: the signer must type it to prove who they are.
      gymName: gymProfile.name || 'Your Gym',
      waiverText: gymProfile.waiverText,
      alreadySigned: !!member.waiverSignedAt,
      signedAt: member.waiverSignedAt,
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
    if (!checkRateLimit(`waiver-sign:${getClientIP(request)}`, { windowMs: 60_000, maxRequests: 10 }).allowed) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
    }
    const body = await request.json().catch(() => null)
    const signature = body?.signature
    const email = body?.email

    // Both are text, and a signature is a small drawing or a typed name: not megabytes of anything.
    if (typeof signature !== 'string' || typeof email !== 'string' || !signature || !email) {
      return NextResponse.json(
        { error: 'Signature and email are required' },
        { status: 400 }
      )
    }
    if (signature.length > 300_000 || email.length > 320) {
      return NextResponse.json({ error: 'That signature is too large.' }, { status: 400 })
    }
    // The email is what proves who is signing. Guesses at it are counted per member, across every
    // server instance, and stop after ten in a quarter of an hour.
    if (await signInBlocked('waiver', memberId)) {
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
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
      await recordFailedSignIn('waiver', memberId)
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
