import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { DEMO_OWNER_ID } from '@/lib/demo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function handleDemoLogin() {
  // Check if demo owner exists
  const demoOwner = await prisma.owner.findUnique({
    where: { id: DEMO_OWNER_ID },
  })

  if (!demoOwner) {
    return { success: false, error: 'Demo account not available' }
  }

  // Create token for demo owner (with emailVerified set to allow access)
  const token = await createToken({ ownerId: DEMO_OWNER_ID, emailVerified: true })

  // Set cookie
  const cookieStore = await cookies()
  cookieStore.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 2, // 2 hours for demo (shorter than normal)
    path: '/',
  })

  return { success: true }
}

// GET handler - allows direct link access (redirects to dashboard)
export async function GET() {
  try {
    const result = await handleDemoLogin()

    if (!result.success) {
      // Redirect to login page with error
      return NextResponse.redirect(new URL('/login?error=demo_unavailable', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'))
    }

    // Redirect to dashboard after successful demo login
    return NextResponse.redirect(new URL('/dashboard', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'))
  } catch (error) {
    console.error('Demo login error:', error)
    return NextResponse.redirect(new URL('/login?error=demo_failed', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'))
  }
}

// POST handler - for programmatic access (returns JSON)
export async function POST() {
  try {
    const result = await handleDemoLogin()

    if (!result.success) {
      return NextResponse.json(
        { error: 'Demo account not available. Please run: npx prisma db seed' },
        { status: 404 }
      )
    }

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
