import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = request.nextUrl
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    const dateFrom = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0))
    const dateTo = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : new Date()

    const checkins = await prisma.checkin.findMany({
      where: {
        ownerId: owner.ownerId,
        timestamp: { gte: dateFrom, lte: dateTo },
      },
      include: {
        member: { select: { name: true, email: true, phone: true } },
      },
      orderBy: { timestamp: 'desc' },
    })

    const header = 'Date,Time,Member Name,Email,Phone,Source,Device'
    const rows = checkins.map((c) => {
      const dt = new Date(c.timestamp)
      return [
        dt.toISOString().split('T')[0],
        dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        `"${c.member.name.replace(/"/g, '""')}"`,
        c.member.email,
        c.member.phone || '',
        c.source || '',
        c.deviceName || '',
      ].join(',')
    })

    const csv = [header, ...rows].join('\n')
    const dateLabel = from || new Date().toISOString().split('T')[0]

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="checkins-${dateLabel}.csv"`,
      },
    })
  } catch (error) {
    console.error('Export check-ins error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
