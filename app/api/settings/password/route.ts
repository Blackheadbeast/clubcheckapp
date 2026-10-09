import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createToken, getOwnerFromCookie, passwordVersion } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Block mutations in demo mode
    if (isDemoOwner(owner.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    const body = await request.json()
    const parsed = changePasswordSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { currentPassword, newPassword } = parsed.data

    // Get owner with password
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: { password: true },
    })

    if (!ownerData) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, ownerData.password)
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12)

    // Update password
    await prisma.owner.update({
      where: { id: owner.ownerId },
      data: { password: hashedPassword },
    })

    // Changing the password ends every session that began under the old one. This device gets a
    // new session so the person who just changed it is not signed out with everyone else.
    const response = NextResponse.json({ success: true })
    response.cookies.set('auth-token', await createToken({ ownerId: owner.ownerId, emailVerified: owner.emailVerified, pv: passwordVersion(hashedPassword) }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })
    return response
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
