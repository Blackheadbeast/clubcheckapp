import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createToken, StaffRole } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { rateLimitResponse, AUTH_RATE_LIMIT } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
  gymCode: z.string().min(1, 'Gym code is required'),
})

export async function POST(request: NextRequest) {
  // Rate limit check
  const rateLimit = rateLimitResponse(request, 'auth-staff-login', AUTH_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      }
    )
  }

  try {
    const body = await request.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { email, password, gymCode } = parsed.data

    // Find owner by short gym code, with UUID fallback for legacy codes
    let owner = await prisma.owner.findUnique({
      where: { gymCode: gymCode.toUpperCase() },
      select: { id: true },
    })
    if (!owner) {
      // Fallback: try looking up by owner ID (legacy UUID gym codes)
      owner = await prisma.owner.findUnique({
        where: { id: gymCode },
        select: { id: true },
      })
    }

    if (!owner) {
      return NextResponse.json(
        { error: 'Invalid gym code' },
        { status: 401 }
      )
    }

    // Find staff member
    const staff = await prisma.staff.findFirst({
      where: {
        email,
        ownerId: owner.id,
      },
    })

    if (!staff) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    if (!staff.active) {
      return NextResponse.json(
        { error: 'Your account has been deactivated' },
        { status: 401 }
      )
    }

    const validPassword = await bcrypt.compare(password, staff.password)
    if (!validPassword) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Update last login
    await prisma.staff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    })

    // Create token with staff info
    const token = await createToken({
      ownerId: owner.id,
      staffId: staff.id,
      role: staff.role as StaffRole,
    })

    const response = NextResponse.json({
      success: true,
      staff: {
        id: staff.id,
        name: staff.name,
        role: staff.role,
      },
    })

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Staff login error:', error)
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    )
  }
}
