'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import FeedbackModal from './FeedbackModal'

export default function FeedbackButton() {
  const [showModal, setShowModal] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const pathname = usePathname()
  // On a phone the floating button would sit on top of lists, so the menu drawer opens this instead.
  useEffect(() => {
    const open = () => setShowModal(true)
    window.addEventListener('clubcheck:feedback', open)
    return () => window.removeEventListener('clubcheck:feedback', open)
  }, [])
  // Member-facing and full-screen surfaces: staff feedback does not belong there.
  const hidden = ['/member/', '/kiosk', '/waiver/', '/book/'].some((p) => pathname?.startsWith(p))

  useEffect(() => {
    // Check if user is authenticated by looking for auth cookie
    async function checkAuth() {
      // Nothing to ask on pages where the button is never shown (the member app, booking pages, sign-in).
      if (isAuthenticated || hidden || ['/sign/', '/login', '/signup', '/staff-login', '/privacy', '/terms'].some((p) => pathname?.startsWith(p)) || pathname === '/') return
      try {
        const res = await fetch('/api/billing-status', { credentials: 'include' })
        if (res.ok) {
          setIsAuthenticated(true)
        }
      } catch {
        // Not authenticated
      }
    }
    checkAuth()
    // Asked again as the page changes, so signing in is noticed without a reload; once known, never again.
  }, [pathname, hidden, isAuthenticated])

  if (hidden) return null
  // Only show for authenticated users
  if (!isAuthenticated) return null

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 right-6 z-20 hidden rounded-full border border-line bg-surface p-3 text-fg-muted shadow-raised transition hover:text-fg hover:shadow-pop lg:block"
        title="Send feedback"
        aria-label="Send feedback"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-theme-card border border-line text-gray-100 text-sm px-3 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Send Feedback
        </span>
      </button>

      <FeedbackModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  )
}
