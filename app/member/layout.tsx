import type { Metadata, Viewport } from 'next'

// The member area installs to a phone's home screen as its own app.
export const metadata: Metadata = {
  title: 'My membership',
  manifest: '/member/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ClubCheck', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#171717' },
  ],
}

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children
}
