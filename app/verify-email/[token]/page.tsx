'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type VerificationStatus = 'verifying' | 'success' | 'expired' | 'invalid' | 'error'

export default function VerifyEmailTokenPage() {
  const params = useParams()
  const router = useRouter()
  const [status, setStatus] = useState<VerificationStatus>('verifying')

  useEffect(() => {
    async function verifyToken() {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: params.token }),
        })

        const data = await res.json()

        if (res.ok) {
          setStatus('success')
          // Redirect to dashboard after 3 seconds
          setTimeout(() => {
            router.push('/dashboard')
          }, 3000)
        } else if (data.code === 'TOKEN_EXPIRED') {
          setStatus('expired')
        } else if (data.code === 'TOKEN_INVALID') {
          setStatus('invalid')
        } else {
          setStatus('error')
        }
      } catch {
        setStatus('error')
      }
    }

    verifyToken()
  }, [params.token, router])

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-dark-card border border-gray-800 rounded-2xl p-8 text-center">
          {status === 'verifying' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary to-primary-dark rounded-2xl mb-6">
                <svg className="animate-spin w-8 h-8 text-black" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-100 mb-2">Verifying Your Email</h1>
              <p className="text-gray-400">Please wait while we verify your email address...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-600 rounded-2xl mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-100 mb-2">Email Verified!</h1>
              <p className="text-gray-400 mb-6">
                Your account is now active. Your 14-day free trial has started.
              </p>
              <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 mb-6">
                <p className="text-green-400 text-sm">
                  Redirecting you to the dashboard in a few seconds...
                </p>
              </div>
              <Link
                href="/dashboard"
                className="inline-block bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition"
              >
                Go to Dashboard Now
              </Link>
            </>
          )}

          {status === 'expired' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-600 rounded-2xl mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-100 mb-2">Link Expired</h1>
              <p className="text-gray-400 mb-6">
                This verification link has expired. Please request a new one.
              </p>
              <Link
                href="/verify-email"
                className="inline-block bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition"
              >
                Resend Verification Email
              </Link>
            </>
          )}

          {status === 'invalid' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-2xl mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-100 mb-2">Invalid Link</h1>
              <p className="text-gray-400 mb-6">
                This verification link is invalid or has already been used.
              </p>
              <div className="space-y-3">
                <Link
                  href="/login"
                  className="block bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition"
                >
                  Log In
                </Link>
                <Link
                  href="/signup"
                  className="block text-gray-400 hover:text-primary transition"
                >
                  or Sign Up Again
                </Link>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-2xl mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-100 mb-2">Something Went Wrong</h1>
              <p className="text-gray-400 mb-6">
                We couldn&apos;t verify your email. Please try again later.
              </p>
              <Link
                href="/verify-email"
                className="inline-block bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition"
              >
                Try Again
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
