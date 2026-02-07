'use client'

import { useState } from 'react'

interface PlanSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  subtitle?: string
}

export default function PlanSelectionModal({
  isOpen,
  onClose,
  title = 'Choose Your Plan',
  subtitle = 'Select a plan to continue using ClubCheck',
}: PlanSelectionModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'pro'>('starter')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  async function handleSubscribe() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/stripe/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType: selectedPlan }),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create subscription')
        setLoading(false)
        return
      }

      if (data.url) {
        window.location.href = data.url
      } else {
        setError('Failed to get checkout URL')
        setLoading(false)
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-dark-card border border-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-100">{title}</h2>
              <p className="text-gray-400 mt-1">{subtitle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 p-2 rounded-lg hover:bg-dark-lighter transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Starter Plan */}
            <button
              onClick={() => setSelectedPlan('starter')}
              className={`text-left p-6 rounded-xl border-2 transition ${
                selectedPlan === 'starter'
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-100">Starter</h3>
                  <p className="text-gray-500 text-sm">Perfect for small gyms</p>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    selectedPlan === 'starter'
                      ? 'border-primary bg-primary'
                      : 'border-gray-600'
                  }`}
                >
                  {selectedPlan === 'starter' && (
                    <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <span className="text-4xl font-bold text-primary">$49.99</span>
                <span className="text-gray-500">/month</span>
              </div>

              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Up to 75 active members
                </li>
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  QR code check-ins
                </li>
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Member management
                </li>
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Dashboard analytics
                </li>
              </ul>
            </button>

            {/* Pro Plan */}
            <button
              onClick={() => setSelectedPlan('pro')}
              className={`text-left p-6 rounded-xl border-2 transition relative ${
                selectedPlan === 'pro'
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              {/* Popular Badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-gradient-to-r from-purple-500 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                  POPULAR
                </span>
              </div>

              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-100">Pro</h3>
                  <p className="text-gray-500 text-sm">For growing gyms</p>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    selectedPlan === 'pro'
                      ? 'border-primary bg-primary'
                      : 'border-gray-600'
                  }`}
                >
                  {selectedPlan === 'pro' && (
                    <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <span className="text-4xl font-bold text-primary">$99.99</span>
                <span className="text-gray-500">/month</span>
              </div>

              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Up to 150 active members
                </li>
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Everything in Starter
                </li>
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Priority support
                </li>
                <li className="flex items-center gap-2 text-gray-400 text-sm">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Advanced analytics
                </li>
              </ul>
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-800 bg-dark-lighter/50">
          <div className="flex items-center justify-between gap-4">
            <p className="text-gray-500 text-sm">
              You&apos;ll be redirected to Stripe for secure payment
            </p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubscribe}
                disabled={loading}
                className="px-6 py-2 bg-primary hover:bg-primary-dark text-black font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </>
                ) : (
                  <>
                    Subscribe to {selectedPlan === 'starter' ? 'Starter' : 'Pro'}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
