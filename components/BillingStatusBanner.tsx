'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface BillingStatus {
  status: 'trialing' | 'active' | 'past_due' | 'grace_expired' | 'canceled' | 'expired'
  canWrite: boolean
  canRead: boolean
  message: string | null
  daysRemaining: number | null
  planType: string
  memberLimit: number
  memberCount: number
  isDemo: boolean
}

export default function BillingStatusBanner() {
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    async function loadBillingStatus() {
      try {
        const res = await fetch('/api/billing-status', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setBilling(data)
        }
      } catch {
        // Silently fail
      }
    }
    loadBillingStatus()
  }, [])

  // Don't show banner for demo accounts or if dismissed
  if (!billing || billing.isDemo || dismissed) return null

  // Don't show banner if everything is fine
  if (billing.status === 'active' && !billing.message) return null

  // Trial with plenty of days left - no banner needed
  if (billing.status === 'trialing' && billing.daysRemaining && billing.daysRemaining > 3) {
    return null
  }

  // Determine banner style based on severity
  let bannerClass = 'bg-yellow-900/30 border-yellow-700 text-yellow-200'
  let iconPath = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'

  if (billing.status === 'grace_expired' || billing.status === 'expired') {
    bannerClass = 'bg-red-900/30 border-red-700 text-red-200'
    iconPath = 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
  } else if (billing.status === 'canceled') {
    bannerClass = 'bg-orange-900/30 border-orange-700 text-orange-200'
  }

  return (
    <div className={`border-b px-4 py-3 ${bannerClass}`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
          </svg>
          <p className="text-sm">
            {billing.message}
            {billing.status === 'trialing' && billing.daysRemaining && billing.daysRemaining <= 3 && (
              <span className="ml-2">
                <Link href="/settings" className="underline hover:no-underline font-medium">
                  Subscribe now
                </Link>
              </span>
            )}
            {(billing.status === 'past_due' || billing.status === 'grace_expired') && (
              <span className="ml-2">
                <Link href="/settings" className="underline hover:no-underline font-medium">
                  Update payment method
                </Link>
              </span>
            )}
            {(billing.status === 'canceled' || billing.status === 'expired') && (
              <span className="ml-2">
                <Link href="/settings" className="underline hover:no-underline font-medium">
                  Resubscribe
                </Link>
              </span>
            )}
          </p>
        </div>

        {/* Only allow dismissing trial warnings, not critical billing issues */}
        {billing.status === 'trialing' && (
          <button
            onClick={() => setDismissed(true)}
            className="text-yellow-400 hover:text-yellow-200 p-1"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
