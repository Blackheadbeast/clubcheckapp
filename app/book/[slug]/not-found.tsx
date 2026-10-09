import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Booking not available', robots: { index: false, follow: false } }

export default function BookingNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-fg-heading">This booking page is not available</h1>
        <p className="mt-2 text-sm text-fg-muted">The link may be wrong, or online booking may be switched off. Please contact the gym directly to book.</p>
      </div>
    </main>
  )
}
