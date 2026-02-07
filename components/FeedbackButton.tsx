'use client'

import { useState, useEffect } from 'react'
import FeedbackModal from './FeedbackModal'

export default function FeedbackButton() {
  const [showModal, setShowModal] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    // Check if user is authenticated by looking for auth cookie
    async function checkAuth() {
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
  }, [])

  // Only show for authenticated users
  if (!isAuthenticated) return null

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 right-6 z-40 bg-primary hover:bg-primary-dark text-black p-3 rounded-full shadow-lg transition-all hover:scale-105 group"
        title="Send Feedback"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-dark-card border border-gray-700 text-gray-100 text-sm px-3 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
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
