'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface WaiverData {
  memberId: string
  memberName: string
  memberEmail: string
  gymName: string
  waiverText: string
  alreadySigned: boolean
  signedAt: string | null
  signature: string | null
}

export default function WaiverSignPage() {
  const params = useParams()
  const memberId = params.memberId as string

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<WaiverData | null>(null)
  const [error, setError] = useState('')

  const [email, setEmail] = useState('')
  const [signature, setSignature] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    async function loadWaiver() {
      try {
        const res = await fetch(`/api/waiver/${memberId}`)
        if (!res.ok) {
          const err = await res.json()
          setError(err.error || 'Waiver not found')
          return
        }
        const json = await res.json()
        setData(json)
      } catch {
        setError('Failed to load waiver')
      } finally {
        setLoading(false)
      }
    }
    loadWaiver()
  }, [memberId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!agreed) {
      setError('Please read and agree to the waiver')
      return
    }

    if (!signature.trim()) {
      setError('Please type your full name as signature')
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch(`/api/waiver/${memberId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: signature.trim(), email }),
      })

      if (!res.ok) {
        const err = await res.json()
        setError(err.error || 'Failed to sign waiver')
        return
      }

      setSuccess(true)
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="text-primary text-xl">Loading waiver...</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center p-4">
        <div className="bg-dark-card p-8 rounded-lg border border-gray-800 max-w-md text-center">
          <div className="text-red-400 text-lg mb-4">{error}</div>
          <p className="text-gray-400">
            This waiver link may be invalid or expired. Please contact your gym for assistance.
          </p>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  if (data.alreadySigned || success) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center p-4">
        <div className="bg-dark-card p-8 rounded-lg border border-gray-800 max-w-md text-center">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-green-400 mb-2">Waiver Signed</h1>
          <p className="text-gray-400 mb-4">
            Thank you, {data.memberName}! Your waiver for {data.gymName} has been signed.
          </p>
          {(data.signedAt || success) && (
            <p className="text-gray-500 text-sm">
              Signed on {new Date(data.signedAt || new Date()).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">{data.gymName}</h1>
          <p className="text-gray-400">Liability Waiver</p>
        </div>

        {/* Waiver Content */}
        <div className="bg-dark-card rounded-lg border border-gray-800 p-6 mb-6">
          <div className="mb-4">
            <p className="text-gray-300 text-sm">
              Prepared for: <span className="font-semibold text-gray-100">{data.memberName}</span>
            </p>
          </div>

          <div className="bg-dark-lighter rounded-lg p-4 mb-6 max-h-96 overflow-y-auto">
            <div className="text-gray-300 text-sm whitespace-pre-wrap">{data.waiverText}</div>
          </div>

          {/* Signature Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-1 rounded border-gray-600 accent-primary"
                />
                <span className="text-gray-300 text-sm">
                  I have read and understand the above waiver, and I agree to its terms and conditions.
                </span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Your Email (for verification)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
              />
              <p className="text-gray-500 text-xs mt-1">
                Must match the email on file with the gym
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Electronic Signature (type your full legal name)
              </label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Type your full name"
                required
                className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary font-signature text-xl"
                style={{ fontFamily: "'Brush Script MT', cursive" }}
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !agreed}
              className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
            >
              {submitting ? 'Signing...' : 'Sign Waiver'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-500 text-xs">
          By signing this waiver electronically, you agree that your electronic signature is the legal
          equivalent of your manual signature.
        </p>
      </div>
    </div>
  )
}
