import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

// GET - Returns QR code as PNG image
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
      select: { name: true, qrCode: true },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const pngBuffer = await QRCode.toBuffer(member.qrCode, {
      width: 600,
      margin: 2,
      color: { dark: '#f59e0b', light: '#0a0a0a' },
      type: 'png',
    })

    const safeName = member.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')

    return new NextResponse(new Uint8Array(pngBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${safeName}-qr.png"`,
      },
    })
  } catch (error) {
    console.error('QR download error:', error)
    return NextResponse.json({ error: 'Failed to generate QR' }, { status: 500 })
  }
}
