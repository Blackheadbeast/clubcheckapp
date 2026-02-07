import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess, checkMemberLimit } from '@/lib/billing'
import { z } from 'zod'
import QRCode from 'qrcode'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const createMemberSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
})

// GET all members with search, filter, sort
export async function GET(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = request.nextUrl
    const search = url.searchParams.get('search') || ''
    const status = url.searchParams.get('status') || ''
    const sort = url.searchParams.get('sort') || 'createdAt'
    const order = url.searchParams.get('order') || 'desc'

    const where: Record<string, unknown> = { ownerId: owner.ownerId }

    if (status && status !== 'all') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ]
    }

    const allowedSortFields = ['name', 'email', 'status', 'createdAt', 'lastCheckInAt']
    const sortField = allowedSortFields.includes(sort) ? sort : 'createdAt'
    const sortOrder = order === 'asc' ? 'asc' : 'desc'

    const members = await prisma.member.findMany({
      where: where as any,
      orderBy: { [sortField]: sortOrder },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        qrCode: true,
        createdAt: true,
        lastCheckInAt: true,
        waiverSignedAt: true,
      },
    })

    // Get gym profile to check if waiver is enabled
    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: { waiverEnabled: true },
    })

    return NextResponse.json({
      members,
      waiverEnabled: gymProfile?.waiverEnabled || false,
    })
  } catch (error) {
    console.error('Get members error:', error)
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
  }
}

// POST - Create new member
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

    // Check billing status allows writes
    const writeAccess = await requireWriteAccess(owner.ownerId)
    if (!writeAccess.allowed) {
      return NextResponse.json({ error: writeAccess.error }, { status: writeAccess.status })
    }

    const body = await request.json()
    const parsed = createMemberSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Check member limit
    const limitCheck = await checkMemberLimit(owner.ownerId)
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.error, limitReached: true },
        { status: 403 }
      )
    }

    const { name, email, phone } = parsed.data
    const qrData = `clubcheck-member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Generate access token for member portal (valid for 1 year)
    const accessToken = randomBytes(32).toString('hex')
    const accessTokenExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

    const qrCodeUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: '#f59e0b', light: '#0a0a0a' },
    })

    const member = await prisma.member.create({
      data: {
        name,
        email,
        phone: phone || null,
        qrCode: qrData,
        ownerId: owner.ownerId,
        accessToken,
        accessTokenExpiry,
      },
    })

    // Send welcome email (non-blocking)
    let emailSent = false
    try {
      const { sendMemberWelcomeEmail } = await import('@/lib/email')
      const emailResult = await sendMemberWelcomeEmail(member.email, member.name, qrCodeUrl)
      emailSent = emailResult.success
      if (!emailResult.success) {
        console.error('Failed to send welcome email:', emailResult.error)
      }
    } catch (emailError) {
      console.error('Email send exception:', emailError)
    }

    return NextResponse.json({ member: { ...member, qrCodeUrl }, emailSent })
  } catch (error) {
    console.error('Create member error:', error)
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  }
}
