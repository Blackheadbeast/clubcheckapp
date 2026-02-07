'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function VerifyEmailPage() {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleResend() {
    setResending(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to resend verification email')
        setResending(false)
        return
      }

      setResent(true)
      setResending(false)
    } catch {
      setError('Something went wrong. Please try again.')
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-theme flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-theme-card border border-theme rounded-2xl p-8 text-center">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary to-primary-dark rounded-2xl mb-6">
            <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-100 mb-2">Check Your Email</h1>
          <p className="text-gray-400 mb-6">
            We&apos;ve sent you a verification link. Click the link in your email to activate your account and start your 14-day free trial.
          </p>

          <div className="bg-theme-lighter border border-gray-700 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-left">
                <p className="text-gray-300 text-sm font-medium">Didn&apos;t receive the email?</p>
                <ul className="text-gray-500 text-sm mt-1 space-y-1">
                  <li>Check your spam or junk folder</li>
                  <li>Make sure you entered the correct email</li>
                  <li>Wait a few minutes for the email to arrive</li>
                </ul>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {resent ? (
            <div className="bg-green-900/20 border border-green-800 rounded-lg p-3 mb-4 text-green-400 text-sm">
              Verification email resent! Check your inbox.
            </div>
          ) : (
            <button
              onClick={handleResend}
              disabled={resending}
              className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {resending ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending...
                </>
              ) : (
                'Resend Verification Email'
              )}
            </button>
          )}

          <div className="mt-6 pt-6 border-t border-theme">
            <p className="text-gray-500 text-sm">
              Wrong email?{' '}
              <Link href="/signup" className="text-primary hover:underline">
                Sign up again
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-gray-600 text-sm mt-6">
          The verification link expires in 24 hours
        </p>
      </div>
    </div>
  )
}
