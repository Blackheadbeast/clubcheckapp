'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Logo from '@/components/Logo'
import QRCode from 'qrcode'

interface Referral {
  id: string
  status: string
  createdAt: string
  verifiedAt: string | null
  trialStartedAt: string | null
  paidAt: string | null
  ownerEmail: string
  gymName: string | null
  planType: string
  subscriptionStatus: string | null
}

interface DashboardData {
  salesRep: {
    id: string
    name: string
    email: string
    referralCode: string
    commissionPercent: number
  }
  funnel: {
    total: number
    signed_up: number
    verified: number
    trialing: number
    paid: number
    churned: number
  }
  referrals: Referral[]
}

const STATUS_COLORS: Record<string, string> = {
  signed_up: 'bg-gray-600 text-gray-200',
  verified: 'bg-blue-900/50 text-blue-300',
  trialing: 'bg-yellow-900/50 text-yellow-300',
  paid: 'bg-green-900/50 text-green-300',
  churned: 'bg-red-900/50 text-red-300',
}

export default function SalesDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/dashboard', { credentials: 'include' })
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/sales/login')
          return
        }
        throw new Error('Failed to load')
      }
      const json = await res.json()
      setData(json)
    } catch {
      console.error('Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (data?.salesRep.referralCode && appUrl) {
      const referralUrl = `${appUrl}/signup?ref=${data.salesRep.referralCode}`
      QRCode.toDataURL(referralUrl, { width: 256, margin: 2 })
        .then(setQrDataUrl)
        .catch(console.error)
    }
  }, [data?.salesRep.referralCode, appUrl])

  const handleLogout = async () => {
    await fetch('/api/sales/logout', { method: 'POST', credentials: 'include' })
    router.push('/sales/login')
  }

  const copyReferralLink = () => {
    if (!data) return
    navigator.clipboard.writeText(`${appUrl}/signup?ref=${data.salesRep.referralCode}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-theme flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-theme flex items-center justify-center">
        <div className="text-red-400">Failed to load dashboard</div>
      </div>
    )
  }

  const { salesRep, funnel, referrals } = data

  return (
    <div className="min-h-screen bg-theme">
      {/* Header */}
      <header className="bg-theme-card border-b border-theme px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="md" />
            <div>
              <h1 className="text-lg font-semibold text-theme-heading">Sales Portal</h1>
              <p className="text-sm text-theme-secondary">{salesRep.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sales/demo"
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition"
            >
              Launch Demo
            </Link>
            <Link
              href="/sales/settings"
              className="px-4 py-2 bg-theme-lighter border border-theme rounded-lg text-sm text-theme-secondary hover:text-theme-heading transition"
            >
              Settings
            </Link>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm text-gray-400 hover:text-red-400 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Total Signups" value={funnel.total} color="text-white" />
          <StatCard label="Pending Verify" value={funnel.signed_up} color="text-gray-400" />
          <StatCard label="Verified" value={funnel.verified} color="text-blue-400" />
          <StatCard label="Trialing" value={funnel.trialing} color="text-yellow-400" />
          <StatCard label="Paid" value={funnel.paid} color="text-green-400" />
          <StatCard label="Churned" value={funnel.churned} color="text-red-400" />
        </div>

        {/* Referral Link & QR Code */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-theme-card rounded-lg border border-theme p-6">
            <h2 className="text-lg font-semibold text-theme-heading mb-4">Your Referral Link</h2>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={`${appUrl}/signup?ref=${salesRep.referralCode}`}
                className="flex-1 px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg text-sm text-gray-300 font-mono"
              />
              <button
                onClick={copyReferralLink}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-black font-medium rounded-lg text-sm transition whitespace-nowrap"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-sm text-theme-secondary">
              Referral Code: <span className="font-mono font-semibold text-primary">{salesRep.referralCode}</span>
            </p>
            <p className="text-sm text-theme-secondary mt-1">
              Commission: <span className="font-semibold">{salesRep.commissionPercent}%</span>
            </p>
          </div>

          <div className="bg-theme-card rounded-lg border border-theme p-6 flex flex-col items-center">
            <h2 className="text-lg font-semibold text-theme-heading mb-4">QR Code</h2>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Referral QR Code" className="w-48 h-48 rounded-lg" />
            ) : (
              <div className="w-48 h-48 bg-theme-lighter rounded-lg flex items-center justify-center text-theme-secondary">
                Loading...
              </div>
            )}
            <p className="text-xs text-theme-secondary mt-3">Scan to open signup with your referral</p>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="bg-theme-card rounded-lg border border-theme p-6">
          <h2 className="text-lg font-semibold text-theme-heading mb-4">Conversion Funnel</h2>
          <div className="space-y-3">
            <FunnelBar label="Signed Up" count={funnel.total} max={funnel.total} color="bg-gray-500" />
            <FunnelBar label="Verified" count={funnel.verified + funnel.trialing + funnel.paid} max={funnel.total} color="bg-blue-500" />
            <FunnelBar label="Trialing" count={funnel.trialing + funnel.paid} max={funnel.total} color="bg-yellow-500" />
            <FunnelBar label="Paid" count={funnel.paid} max={funnel.total} color="bg-green-500" />
          </div>
        </div>

        {/* Referrals Table */}
        <div className="bg-theme-card rounded-lg border border-theme p-6">
          <h2 className="text-lg font-semibold text-theme-heading mb-4">Referral History</h2>
          {referrals.length === 0 ? (
            <p className="text-theme-secondary text-center py-8">
              No referrals yet. Share your link to get started!
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-theme-secondary border-b border-theme">
                    <th className="pb-3 pr-4">Gym</th>
                    <th className="pb-3 pr-4">Email</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Signed Up</th>
                    <th className="pb-3 pr-4">Verified</th>
                    <th className="pb-3">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {referrals.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 pr-4 text-theme-heading">{r.gymName || '—'}</td>
                      <td className="py-3 pr-4 text-theme-secondary font-mono text-xs">{r.ownerEmail}</td>
                      <td className="py-3 pr-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-gray-600'}`}>
                          {r.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-theme-secondary text-xs">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 pr-4 text-theme-secondary text-xs">
                        {r.verifiedAt ? new Date(r.verifiedAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 text-theme-secondary text-xs">
                        {r.paidAt ? new Date(r.paidAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-theme-card rounded-lg border border-theme p-4">
      <p className="text-xs text-theme-secondary mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function FunnelBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-theme-secondary w-20">{label}</span>
      <div className="flex-1 bg-theme-lighter rounded-full h-6 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="text-sm font-medium text-theme-heading w-8 text-right">{count}</span>
    </div>
  )
}
