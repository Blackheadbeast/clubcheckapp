import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST - Resend QR code email to member
export async function POST(
  _request: NextRequest,
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
      select: { name: true, email: true, qrCode: true, accessToken: true },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const qrCodeUrl = await QRCode.toDataURL(member.qrCode, {
      width: 600,
      margin: 2,
      color: { dark: '#f59e0b', light: '#0a0a0a' },
    })

    const { sendQrCodeEmail } = await import('@/lib/email')
    const result = await sendQrCodeEmail(
      member.email,
      member.name,
      qrCodeUrl,
      'Your ClubCheck QR Code',
      member.accessToken || undefined
    )

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send QR email error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
