import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { appearanceScript, themeCss } from '@/lib/public-booking/theme'
import { publicSite, resolveSite } from '@/lib/services/public-booking'
import BookingApp from '@/components/booking/BookingApp'

export const dynamic = 'force-dynamic'

async function load(slug: string) {
  try {
    return await publicSite(await resolveSite(slug))
  } catch (error) {
    // An unknown address and a gym that has switched booking off look the same from outside.
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function generateMetadata({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | string[] | undefined> }): Promise<Metadata> {
  const site = await load(params.slug)
  // Decided here, before any of the page is sent, so an address that is not in use answers 404 rather than 200.
  if (!site) notFound()
  const title = `Book online | ${site.name}`
  const description = site.tagline || `Book classes${site.hasAppointments ? ' and appointments' : ''} at ${site.name}. See what is on, choose a time and reserve your spot.`
  // The page a gym links to is the one to index: not the framed copy, and not a link carrying someone's half-made booking.
  const plain = Object.keys(searchParams).length === 0
  return {
    title, description,
    alternates: { canonical: `/book/${site.slug}` },
    robots: plain ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title, description, type: 'website', url: `/book/${site.slug}`, siteName: site.name, ...(site.logoUrl && { images: [{ url: site.logoUrl }] }) },
    twitter: { card: 'summary', title, description },
  }
}

export default async function BookingPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const site = await load(params.slug)
  if (!site) notFound()
  const embed = searchParams.embed === '1'
  return (
    <>
      {/* Computed from a checked six-digit colour and two fixed choices: nothing typed into settings reaches this. */}
      <style dangerouslySetInnerHTML={{ __html: `${themeCss(site.theme)}${embed ? 'html,body{background:transparent!important}' : ''}` }} />
      <script dangerouslySetInnerHTML={{ __html: appearanceScript(site.theme.appearance) }} />
      <main className={embed ? '' : 'min-h-screen'}>
        <BookingApp slug={site.slug} initial={site} embed={embed} />
      </main>
      <noscript><p style={{ padding: 24, textAlign: 'center' }}>Online booking needs JavaScript. Please call or email {site.name} to book{site.contact.phone ? `: ${site.contact.phone}` : site.contact.email ? `: ${site.contact.email}` : ''}.</p></noscript>
    </>
  )
}
