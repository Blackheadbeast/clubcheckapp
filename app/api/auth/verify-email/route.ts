import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrialEndDate } from '@/lib/billing'
import { SignJWT } from 'jose'
import { cookies } from 'next/headers'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function POST(request: Request) {
  try {
    const { token } = await request.json()

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Invalid token', code: 'TOKEN_INVALID' },
        { status: 400 }
      )
    }

    // Find owner by verification token
    const owner = await prisma.owner.findFirst({
      where: { verificationToken: token },
    })

    if (!owner) {
      return NextResponse.json(
        { error: 'Invalid or expired verification link', code: 'TOKEN_INVALID' },
        { status: 400 }
      )
    }

    // Check if token has expired
    if (owner.verificationTokenExpiry && owner.verificationTokenExpiry < new Date()) {
      return NextResponse.json(
        { error: 'Verification link has expired', code: 'TOKEN_EXPIRED' },
        { status: 400 }
      )
    }

    // Check if already verified
    if (owner.emailVerified) {
      return NextResponse.json(
        { error: 'Email already verified', code: 'ALREADY_VERIFIED' },
        { status: 400 }
      )
    }

    // Verify email and start trial
    const trialEndsAt = getTrialEndDate()

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        emailVerified: new Date(),
        verificationToken: null,
        verificationTokenExpiry: null,
        trialEndsAt,
      },
    })

    // Create JWT and set cookie to log them in (with emailVerified: true)
    const jwtToken = await new SignJWT({
      ownerId: owner.id,
      emailVerified: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(getSecret())

    const cookieStore = await cookies()
    cookieStore.set('auth-token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    })
  } catch (error) {
    console.error('Verify email error:', error)
    return NextResponse.json(
      { error: 'Failed to verify email' },
      { status: 500 }
    )
  }
}
