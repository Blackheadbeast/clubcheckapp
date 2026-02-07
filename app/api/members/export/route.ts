import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const members = await prisma.member.findMany({
      where: { ownerId: owner.ownerId },
      orderBy: { createdAt: 'desc' },
      select: {
        name: true,
        email: true,
        phone: true,
        status: true,
        qrCode: true,
        createdAt: true,
        lastCheckInAt: true,
      },
    })

    const header = 'Name,Email,Phone,Status,QR Code,Created,Last Check-In'
    const rows = members.map((m) => {
      const created = new Date(m.createdAt).toISOString().split('T')[0]
      const lastCheckIn = m.lastCheckInAt
        ? new Date(m.lastCheckInAt).toISOString().split('T')[0]
        : ''
      return [
        `"${m.name.replace(/"/g, '""')}"`,
        m.email,
        m.phone || '',
        m.status,
        m.qrCode,
        created,
        lastCheckIn,
      ].join(',')
    })

    const csv = [header, ...rows].join('\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="members-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
