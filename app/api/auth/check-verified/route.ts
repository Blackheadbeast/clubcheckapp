import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

// GET - Check if the current user's email is verified
export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth-token')?.value

    if (!token) {
      return NextResponse.json({ verified: false }, { status: 401 })
    }

    let payload
    try {
      const result = await jwtVerify(token, getSecret())
      payload = result.payload as { ownerId: string }
    } catch {
      return NextResponse.json({ verified: false }, { status: 401 })
    }

    const owner = await prisma.owner.findUnique({
      where: { id: payload.ownerId },
      select: { emailVerified: true },
    })

    return NextResponse.json({ verified: !!owner?.emailVerified })
  } catch {
    return NextResponse.json({ verified: false }, { status: 500 })
  }
}
