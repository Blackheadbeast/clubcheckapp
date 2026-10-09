import { NextResponse } from 'next/server'

// Web app manifest for the member area ("Add to Home Screen").
export function GET() {
  return NextResponse.json(
    {
      name: 'ClubCheck Member',
      short_name: 'ClubCheck',
      description: 'Book classes, check in and manage your membership.',
      start_url: '/member/me',
      scope: '/member/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f5f5f5',
      theme_color: '#f59e0b',
      icons: [
        { src: '/icon.png', sizes: 'any', type: 'image/png', purpose: 'any' },
        { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
      ],
      shortcuts: [{ name: 'Sign in', url: '/member/login' }],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } }
  )
}
