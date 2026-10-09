import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { appearanceScript, themeCss } from '@/lib/public-booking/theme'
import { publicSite, resolveSite } from '@/lib/services/public-booking'
import { ManageBooking } from '@/components/booking/BookingApp'

export const dynamic = 'force-dynamic'

// Someone's own booking: never indexed, never cached, and the link itself is not sent on to other sites.
export const metadata: Metadata = { title: 'Your booking', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function ManagePage({ params }: { params: { slug: string; token: string } }) {
  let site
  try {
    site = await publicSite(await resolveSite(params.slug))
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(site.theme) }} />
      <script dangerouslySetInnerHTML={{ __html: appearanceScript(site.theme.appearance) }} />
      <main className="min-h-screen"><ManageBooking slug={site.slug} site={site} token={params.token} /></main>
    </>
  )
}
