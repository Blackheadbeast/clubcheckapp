import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import QRCode from 'qrcode'

// GET single member
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const member = await prisma.member.findFirst({
      where: {
        id,
        ownerId: owner.ownerId,
      },
    })

    if (!member) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      )
    }

    // Generate QR code URL
    const qrCodeUrl = await QRCode.toDataURL(member.qrCode, {
      width: 300,
      margin: 2,
      color: {
        dark: '#f59e0b',
        light: '#0a0a0a',
      },
    })

    return NextResponse.json({
      member: {
        ...member,
        qrCodeUrl,
      },
    })
  } catch (error) {
    console.error('Get member error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch member' },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    await prisma.member.delete({
      where: {
        id,
        ownerId: owner.ownerId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete member error:', error)
    return NextResponse.json(
      { error: 'Failed to delete member' },
      { status: 500 }
    )
  }
}

// PATCH - Update member status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { status } = await request.json()

    const member = await prisma.member.update({
      where: {
        id,
        ownerId: owner.ownerId,
      },
      data: { status },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('Update member error:', error)
    return NextResponse.json(
      { error: 'Failed to update member' },
      { status: 500 }
    )
  }
}