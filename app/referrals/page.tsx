'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface ReferralData {
  referralCode: string
  totalReferred: number
  payingReferrals: number
  creditedMonths: number
  referrals: {
    id: string
    gymName: string
    email: string
    status: string
    referredAt: string
    creditEarned: boolean
  }[]
}

export default function ReferralsPage() {
  const router = useRouter()
  const [data, setData] = useState<ReferralData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/referrals', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const json = await res.json()
        setData(json)
      } catch {
        console.error('Failed to load referrals')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  async function copyToClipboard() {
    if (!data) return
    setCopying(true)

    const signupUrl = `${window.location.origin}/signup?ref=${data.referralCode}`

    try {
      await navigator.clipboard.writeText(signupUrl)
      setTimeout(() => setCopying(false), 2000)
    } catch {
      // Fallback
      const input = document.createElement('input')
      input.value = signupUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setTimeout(() => setCopying(false), 2000)
    }
  }

  async function regenerateCode() {
    if (regenerating) return
    setRegenerating(true)

    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        const json = await res.json()
        setData((prev) => (prev ? { ...prev, referralCode: json.referralCode } : prev))
      }
    } catch {
      console.error('Failed to regenerate code')
    } finally {
      setRegenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400 text-xl">Failed to load referrals</div>
      </div>
    )
  }

  const signupUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/signup?ref=${data.referralCode}`

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary">Referrals</h1>
          <p className="text-gray-400 mt-1">Earn free months by referring other gyms</p>
        </div>

        {/* How it works */}
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-primary mb-3">How Referrals Work</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-300 text-sm">
            <li>Share your unique referral link with other gym owners</li>
            <li>When they sign up using your link and become a paying customer</li>
            <li>You earn <span className="text-primary font-semibold">1 free month</span> of ClubCheck!</li>
          </ol>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Total Referred</div>
            <div className="text-4xl font-bold text-primary">{data.totalReferred}</div>
            <div className="text-gray-500 text-sm mt-2">gyms signed up</div>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Paying Referrals</div>
            <div className="text-4xl font-bold text-green-400">{data.payingReferrals}</div>
            <div className="text-gray-500 text-sm mt-2">converted to paid</div>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Credits Earned</div>
            <div className="text-4xl font-bold text-blue-400">{data.creditedMonths}</div>
            <div className="text-gray-500 text-sm mt-2">free months</div>
          </div>
        </div>

        {/* Referral Code Card */}
        <div className="bg-dark-card p-6 rounded-lg border border-gray-800 mb-8">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">Your Referral Link</h2>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 bg-dark-lighter border border-gray-700 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Referral Code</div>
              <div className="text-primary font-mono font-bold text-lg">{data.referralCode}</div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={copyToClipboard}
                className="bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition flex items-center gap-2"
              >
                {copying ? (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy Link
                  </>
                )}
              </button>

              <button
                onClick={regenerateCode}
                disabled={regenerating}
                className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-3 px-4 rounded-lg border border-gray-700 transition disabled:opacity-50"
                title="Generate new code"
              >
                <svg
                  className={`w-5 h-5 ${regenerating ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-4 p-3 bg-dark-lighter rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Full URL</div>
            <div className="text-gray-300 text-sm font-mono break-all">{signupUrl}</div>
          </div>
        </div>

        {/* Referral History */}
        <div className="bg-dark-card rounded-lg border border-gray-800">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-gray-100">Referral History</h2>
          </div>

          {data.referrals.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-gray-500 text-lg mb-2">No referrals yet</div>
              <p className="text-gray-600 text-sm">Share your referral link to start earning free months!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-lighter">
                  <tr>
                    <th className="text-left px-6 py-3 text-gray-400 text-sm font-medium">Gym</th>
                    <th className="text-left px-6 py-3 text-gray-400 text-sm font-medium">Date</th>
                    <th className="text-left px-6 py-3 text-gray-400 text-sm font-medium">Status</th>
                    <th className="text-left px-6 py-3 text-gray-400 text-sm font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.referrals.map((ref) => (
                    <tr key={ref.id} className="border-t border-gray-800 hover:bg-dark-lighter">
                      <td className="px-6 py-4">
                        <div className="text-gray-100 font-medium">{ref.gymName}</div>
                        <div className="text-gray-500 text-sm">{ref.email}</div>
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-sm">
                        {new Date(ref.referredAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            ref.status === 'active' || ref.status === 'trialing'
                              ? 'bg-green-900/30 text-green-400'
                              : ref.status === 'past_due'
                              ? 'bg-red-900/30 text-red-400'
                              : 'bg-gray-800 text-gray-400'
                          }`}
                        >
                          {ref.status || 'pending'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {ref.creditEarned ? (
                          <span className="text-green-400 flex items-center gap-1">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Earned
                          </span>
                        ) : (
                          <span className="text-gray-500">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
