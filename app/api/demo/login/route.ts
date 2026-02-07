import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { DEMO_OWNER_ID } from '@/lib/demo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  try {
    // Check if demo owner exists
    const demoOwner = await prisma.owner.findUnique({
      where: { id: DEMO_OWNER_ID },
    })

    if (!demoOwner) {
      return NextResponse.json(
        { error: 'Demo account not available. Please run: npx prisma db seed' },
        { status: 404 }
      )
    }

    // Create token for demo owner
    const token = await createToken({ ownerId: DEMO_OWNER_ID })

    // Set cookie
    const cookieStore = await cookies()
    cookieStore.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 2, // 2 hours for demo (shorter than normal)
      path: '/',
    })

    return NextResponse.json({
      success: true,
      isDemo: true,
    })
  } catch (error) {
    console.error('Demo login error:', error)
    return NextResponse.json(
      { error: 'Demo login failed' },
      { status: 500 }
    )
  }
}
