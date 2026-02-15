import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { z } from 'zod'
import QRCode from 'qrcode'

const updateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive', 'overdue', 'paused']).optional(),
})

// GET single member with check-in count
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { id, ownerId: owner.ownerId },
      include: {
        _count: { select: { checkins: true } },
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Get gym profile to check if waiver is enabled
    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: { waiverEnabled: true },
    })

    const qrCodeUrl = await QRCode.toDataURL(member.qrCode, {
      width: 300,
      margin: 2,
      color: { dark: '#f59e0b', light: '#0a0a0a' },
    })

    return NextResponse.json({
      member: {
        ...member,
        checkInCount: member._count.checkins,
        qrCodeUrl,
        waiverEnabled: gymProfile?.waiverEnabled || false,
      },
    })
  } catch (error) {
    console.error('Get member error:', error)
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 })
  }
}

// DELETE member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

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

    await prisma.member.delete({
      where: { id, ownerId: owner.ownerId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete member error:', error)
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 })
  }
}

// PATCH - Update member fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

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
    const parsed = updateMemberSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const member = await prisma.member.update({
      where: { id, ownerId: owner.ownerId },
      data: parsed.data,
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('Update member error:', error)
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
  }
}
