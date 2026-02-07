import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/email'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { randomBytes } from 'crypto'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function POST() {
  try {
    // Get current user from cookie
    const cookieStore = await cookies()
    const token = cookieStore.get('auth-token')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    let payload
    try {
      const result = await jwtVerify(token, getSecret())
      payload = result.payload as { ownerId: string }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      )
    }

    const owner = await prisma.owner.findUnique({
      where: { id: payload.ownerId },
    })

    if (!owner) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    if (owner.emailVerified) {
      return NextResponse.json(
        { error: 'Email already verified' },
        { status: 400 }
      )
    }

    // Generate new verification token
    const verificationToken = randomBytes(32).toString('hex')
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        verificationToken,
        verificationTokenExpiry,
      },
    })

    // Send verification email
    await sendVerificationEmail(owner.email, verificationToken)

    return NextResponse.json({
      success: true,
      message: 'Verification email resent',
    })
  } catch (error) {
    console.error('Resend verification error:', error)
    return NextResponse.json(
      { error: 'Failed to resend verification email' },
      { status: 500 }
    )
  }
}
