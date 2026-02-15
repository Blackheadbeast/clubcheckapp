import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  let gymName = 'ClubCheck'

  if (token) {
    const member = await prisma.member.findFirst({
      where: {
        accessToken: token,
        accessTokenExpiry: { gt: new Date() },
      },
      select: {
        owner: {
          select: {
            gymProfile: { select: { name: true } },
          },
        },
      },
    })
    if (member?.owner?.gymProfile?.name) {
      gymName = member.owner.gymProfile.name
    }
  }

  const manifest = {
    name: `${gymName} - Check In`,
    short_name: gymName,
    description: `Quick check-in for ${gymName}`,
    start_url: token ? `/member/${token}` : '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#111111',
    icons: [
      {
        src: '/logo.png',
        sizes: 'any',
        type: 'image/png',
      },
    ],
  }

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
    },
  })
}
