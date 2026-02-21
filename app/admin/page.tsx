'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Logo from '@/components/Logo'
import Link from 'next/link'

interface SalesRepData {
  id: string
  name: string
  email: string
  referralCode: string
  commissionPercent: number
  active: boolean
  createdAt: string
  lastLoginAt: string | null
  totalReferrals: number
  paidReferrals: number
}

interface AnalyticsData {
  totalReps: number
  activeReps: number
  inactiveReps: number
  referralsByStatus: Record<string, number>
  totalReferrals: number
  topPerformers: {
    id: string
    name: string
    email: string
    referralCode: string
    totalReferrals: number
    paidReferrals: number
  }[]
}

type Tab = 'reps' | 'analytics' | 'demo'

export default function AdminPage() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('reps')
  const [reps, setReps] = useState<SalesRepData[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  // Create rep form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newCommission, setNewCommission] = useState(10)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  // Demo reset
  const [resetting, setResetting] = useState(false)
  const [resetMessage, setResetMessage] = useState('')

  const verifyAdmin = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/verify', { credentials: 'include' })
      if (!res.ok) {
        router.push('/dashboard')
        return
      }
      setIsAdmin(true)
    } catch {
      router.push('/dashboard')
    }
  }, [router])

  const loadReps = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sales-reps', { credentials: 'include' })
      if (res.ok) setReps(await res.json())
    } catch {
      console.error('Failed to load reps')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/analytics', { credentials: 'include' })
      if (res.ok) setAnalytics(await res.json())
    } catch {
      console.error('Failed to load analytics')
    }
  }, [])

  useEffect(() => {
    verifyAdmin()
  }, [verifyAdmin])

  useEffect(() => {
    if (isAdmin) {
      loadReps()
      loadAnalytics()
    }
  }, [isAdmin, loadReps, loadAnalytics])

  const handleCreateRep = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)

    try {
      const res = await fetch('/api/admin/sales-reps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
          commissionPercent: newCommission,
        }),
        credentials: 'include',
      })

      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create')
        return
      }

      setShowCreateForm(false)
      setNewName('')
      setNewEmail('')
      setNewPassword('')
      setNewCommission(10)
      loadReps()
    } catch {
      setCreateError('Something went wrong')
    } finally {
      setCreating(false)
    }
  }

  const toggleRepActive = async (id: string, active: boolean) => {
    try {
      await fetch(`/api/admin/sales-reps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
        credentials: 'include',
      })
      loadReps()
    } catch {
      console.error('Failed to toggle rep')
    }
  }

  const handleResetDemo = async () => {
    if (!confirm('Are you sure you want to reset the demo environment? This will delete all demo data and recreate it.')) return

    setResetting(true)
    setResetMessage('')

    try {
      const res = await fetch('/api/admin/demo/reset', {
        method: 'POST',
        credentials: 'include',
      })

      const data = await res.json()
      if (res.ok) {
        setResetMessage('Demo environment reset successfully!')
      } else {
        setResetMessage(data.error || 'Reset failed')
      }
    } catch {
      setResetMessage('Something went wrong')
    } finally {
      setResetting(false)
    }
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-theme flex items-center justify-center">
        <div className="text-primary text-xl">Verifying access...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-theme">
      <header className="bg-theme-card border-b border-theme px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="md" />
            <h1 className="text-lg font-semibold text-theme-heading">Admin Panel</h1>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-theme-lighter border border-theme rounded-lg text-sm text-theme-secondary hover:text-theme-heading transition"
          >
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-theme-card rounded-lg border border-theme p-1 w-fit">
          {(['reps', 'analytics', 'demo'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2 rounded-md text-sm font-medium transition ${
                tab === t
                  ? 'bg-primary text-black'
                  : 'text-theme-secondary hover:text-theme-heading'
              }`}
            >
              {t === 'reps' ? 'Sales Reps' : t === 'analytics' ? 'Analytics' : 'Demo'}
            </button>
          ))}
        </div>

        {/* Sales Reps Tab */}
        {tab === 'reps' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-theme-heading">Sales Reps</h2>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-black font-medium rounded-lg text-sm transition"
              >
                {showCreateForm ? 'Cancel' : 'Add New Rep'}
              </button>
            </div>

            {showCreateForm && (
              <div className="bg-theme-card rounded-lg border border-theme p-6">
                <h3 className="text-lg font-semibold text-theme-heading mb-4">Create Sales Rep</h3>
                <form onSubmit={handleCreateRep} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Name</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Email</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={6}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Commission %</label>
                    <input
                      type="number"
                      value={newCommission}
                      onChange={(e) => setNewCommission(Number(e.target.value))}
                      min={0}
                      max={100}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div className="col-span-2">
                    {createError && (
                      <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm mb-4">
                        {createError}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={creating}
                      className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
                    >
                      {creating ? 'Creating...' : 'Create Sales Rep'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {loading ? (
              <p className="text-theme-secondary">Loading...</p>
            ) : (
              <div className="bg-theme-card rounded-lg border border-theme overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-theme-secondary border-b border-theme">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Commission</th>
                      <th className="px-4 py-3">Referrals</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {reps.map((rep) => (
                      <tr key={rep.id}>
                        <td className="px-4 py-3 text-theme-heading font-medium">{rep.name}</td>
                        <td className="px-4 py-3 text-theme-secondary">{rep.email}</td>
                        <td className="px-4 py-3 font-mono text-primary text-xs">{rep.referralCode}</td>
                        <td className="px-4 py-3">{rep.commissionPercent}%</td>
                        <td className="px-4 py-3">{rep.totalReferrals}</td>
                        <td className="px-4 py-3 text-green-400">{rep.paidReferrals}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${rep.active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                            {rep.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleRepActive(rep.id, rep.active)}
                            className={`text-xs font-medium ${rep.active ? 'text-red-400 hover:text-red-300' : 'text-green-400 hover:text-green-300'} transition`}
                          >
                            {rep.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {reps.length === 0 && (
                  <p className="text-center text-theme-secondary py-8">No sales reps yet</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Analytics Tab */}
        {tab === 'analytics' && analytics && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-theme-heading">Sales Analytics</h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-theme-card rounded-lg border border-theme p-4">
                <p className="text-xs text-theme-secondary mb-1">Total Reps</p>
                <p className="text-2xl font-bold">{analytics.totalReps}</p>
              </div>
              <div className="bg-theme-card rounded-lg border border-theme p-4">
                <p className="text-xs text-theme-secondary mb-1">Active Reps</p>
                <p className="text-2xl font-bold text-green-400">{analytics.activeReps}</p>
              </div>
              <div className="bg-theme-card rounded-lg border border-theme p-4">
                <p className="text-xs text-theme-secondary mb-1">Total Referrals</p>
                <p className="text-2xl font-bold text-blue-400">{analytics.totalReferrals}</p>
              </div>
              <div className="bg-theme-card rounded-lg border border-theme p-4">
                <p className="text-xs text-theme-secondary mb-1">Paid Conversions</p>
                <p className="text-2xl font-bold text-green-400">{analytics.referralsByStatus?.paid || 0}</p>
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="bg-theme-card rounded-lg border border-theme p-6">
              <h3 className="text-lg font-semibold text-theme-heading mb-4">Referral Status Breakdown</h3>
              <div className="grid grid-cols-5 gap-4">
                {['signed_up', 'verified', 'trialing', 'paid', 'churned'].map((status) => (
                  <div key={status} className="text-center">
                    <p className="text-2xl font-bold">{analytics.referralsByStatus?.[status] || 0}</p>
                    <p className="text-xs text-theme-secondary mt-1 capitalize">{status.replace('_', ' ')}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Performers */}
            <div className="bg-theme-card rounded-lg border border-theme p-6">
              <h3 className="text-lg font-semibold text-theme-heading mb-4">Top Performers</h3>
              {analytics.topPerformers.length === 0 ? (
                <p className="text-theme-secondary text-center py-4">No data yet</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-theme-secondary border-b border-theme">
                      <th className="pb-3 pr-4">#</th>
                      <th className="pb-3 pr-4">Name</th>
                      <th className="pb-3 pr-4">Code</th>
                      <th className="pb-3 pr-4">Total Referrals</th>
                      <th className="pb-3">Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {analytics.topPerformers.map((p, i) => (
                      <tr key={p.id}>
                        <td className="py-3 pr-4 text-theme-secondary">{i + 1}</td>
                        <td className="py-3 pr-4 text-theme-heading font-medium">{p.name}</td>
                        <td className="py-3 pr-4 font-mono text-primary text-xs">{p.referralCode}</td>
                        <td className="py-3 pr-4">{p.totalReferrals}</td>
                        <td className="py-3 text-green-400">{p.paidReferrals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Demo Tab */}
        {tab === 'demo' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-theme-heading">Demo Environment</h2>

            <div className="bg-theme-card rounded-lg border border-theme p-6">
              <h3 className="text-lg font-semibold text-theme-heading mb-2">Reset Demo Data</h3>
              <p className="text-theme-secondary text-sm mb-6">
                This will delete all existing demo data and recreate the demo owner with fresh sample members, check-ins, and analytics.
              </p>

              <button
                onClick={handleResetDemo}
                disabled={resetting}
                className="bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
              >
                {resetting ? 'Resetting...' : 'Reset Demo Environment'}
              </button>

              {resetMessage && (
                <div className={`mt-4 px-4 py-2 rounded-lg text-sm ${
                  resetMessage.includes('success')
                    ? 'bg-green-900/20 border border-green-900 text-green-400'
                    : 'bg-red-900/20 border border-red-900 text-red-400'
                }`}>
                  {resetMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
