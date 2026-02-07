import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const pinActionSchema = z.object({
  action: z.enum(['set', 'verify']),
  pin: z.string().min(4, 'PIN must be 4–6 digits').max(6).regex(/^\d+$/, 'PIN must be digits only'),
})

// GET - Check if kiosk PIN is set
export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: { kioskPinHash: true },
    })

    return NextResponse.json({ hasPin: !!profile?.kioskPinHash })
  } catch (error) {
    console.error('Kiosk PIN check error:', error)
    return NextResponse.json({ error: 'Failed to check PIN' }, { status: 500 })
  }
}

// POST - Set or verify kiosk PIN
export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = pinActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { action, pin } = parsed.data

    if (action === 'set') {
      // Block mutations in demo mode
      if (isDemoOwner(owner.ownerId)) {
        return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
      }

      const hash = await bcrypt.hash(pin, 10)

      await prisma.gymProfile.upsert({
        where: { ownerId: owner.ownerId },
        update: { kioskPinHash: hash },
        create: {
          ownerId: owner.ownerId,
          kioskPinHash: hash,
        },
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'verify') {
      const profile = await prisma.gymProfile.findUnique({
        where: { ownerId: owner.ownerId },
        select: { kioskPinHash: true },
      })

      if (!profile?.kioskPinHash) {
        return NextResponse.json({ error: 'No PIN set' }, { status: 400 })
      }

      const valid = await bcrypt.compare(pin, profile.kioskPinHash)
      if (!valid) {
        return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Kiosk PIN action error:', error)
    return NextResponse.json({ error: 'PIN action failed' }, { status: 500 })
  }
}
