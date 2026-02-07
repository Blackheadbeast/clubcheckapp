//app/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import SetupWizard from '@/components/SetupWizard'
import BillingStatusBanner from '@/components/BillingStatusBanner'

interface BillingAlert {
  id: string
  type: string
  message: string
  createdAt: string
}

interface SetupProgress {
  gymName: boolean
  firstMember: boolean
  kioskPin: boolean
  firstCheckin: boolean
  dismissed: boolean
  isDemo: boolean
}

interface DashboardData {
  activeMembers: number
  checkedInToday: number
  failedPayments: number
  cardsExpiringSoon: number
  revenue: string
  planType: string
  subscriptionStatus: string | null
  memberLimit: number
  billingAlerts: BillingAlert[]
  setupProgress: SetupProgress
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" })


        if (!res.ok) {
          router.push('/login')
          return
        }

        const dashboardData = await res.json()
        setData(dashboardData)
      } catch (error) {
        console.error('Failed to load dashboard:', error)
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [router])

  async function handleUpgrade(planType: 'starter' | 'pro') {
    setUpgrading(true)
    try {
      const res = await fetch('/api/stripe/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType }),
      })

      const data = await res.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        alert('Failed to create checkout session')
        setUpgrading(false)
      }
    } catch (error) {
      console.error('Upgrade error:', error)
      alert('Something went wrong')
      setUpgrading(false)
    }
  }

  async function handleDismissSetup() {
    try {
      await fetch('/api/dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss-setup' }),
        credentials: 'include',
      })
      setData((prev) =>
        prev
          ? { ...prev, setupProgress: { ...prev.setupProgress, dismissed: true } }
          : prev
      )
    } catch (error) {
      console.error('Failed to dismiss setup:', error)
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
    return null
  }

  const isNearLimit = data.activeMembers >= data.memberLimit * 0.9

  async function dismissAlert(eventId: string) {
    await fetch('/api/billing-events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
      credentials: 'include',
    })
    setData((prev) =>
      prev
        ? { ...prev, billingAlerts: prev.billingAlerts.filter((a) => a.id !== eventId) }
        : prev
    )
  }

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <BillingStatusBanner />
      <div className="max-w-7xl mx-auto p-8">
        {/* Billing Alerts Banner */}
        {data.billingAlerts && data.billingAlerts.length > 0 && (
          <div className="mb-6 space-y-3">
            {data.billingAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-center justify-between px-6 py-4 rounded-lg ${
                  alert.type === 'payment_failed'
                    ? 'bg-red-900/20 border border-red-900 text-red-400'
                    : alert.type === 'subscription_canceled'
                    ? 'bg-yellow-900/20 border border-yellow-900 text-yellow-400'
                    : 'bg-primary/20 border border-primary text-primary-light'
                }`}
              >
                <div>
                  <p className="font-semibold">{alert.message}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {new Date(alert.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => dismissAlert(alert.id)}
                  className="text-sm opacity-70 hover:opacity-100 ml-4 shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Subscription Status Banner */}
        {data.subscriptionStatus === 'past_due' && (
          <div className="mb-6 bg-red-900/20 border border-red-900 text-red-400 px-6 py-4 rounded-lg">
            <p className="font-semibold">Your subscription payment is past due</p>
            <p className="text-sm mt-1">Please update your payment method to continue using ClubCheck.</p>
          </div>
        )}

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary">Dashboard</h1>
          <p className="text-gray-400 mt-1">Overview of your gym</p>
        </div>

        {/* Setup Wizard */}
        <SetupWizard progress={data.setupProgress} onDismiss={handleDismissSetup} />

        {/* Subscription Upgrade Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Starter Plan */}
          <div className={`bg-dark-card p-6 rounded-lg border ${
            data.planType === 'starter' ? 'border-primary' : 'border-gray-800'
          }`}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-primary">Starter Plan</h3>
                <p className="text-gray-400 text-sm">Perfect for small gyms</p>
              </div>
              {data.planType === 'starter' && (
                <span className="bg-primary text-black text-xs font-semibold px-3 py-1 rounded-full">
                  Current
                </span>
              )}
            </div>
            <div className="mb-4">
              <span className="text-4xl font-bold text-primary">$49.99</span>
              <span className="text-gray-400">/month</span>
            </div>
            <ul className="space-y-2 mb-6">
              <li className="text-gray-300 text-sm">✓ Up to 75 active members</li>
              <li className="text-gray-300 text-sm">✓ QR code check-ins</li>
              <li className="text-gray-300 text-sm">✓ Member management</li>
              <li className="text-gray-300 text-sm">✓ Dashboard analytics</li>
            </ul>
            {data.planType !== 'starter' && (
              <button
                onClick={() => handleUpgrade('starter')}
                disabled={upgrading}
                className="w-full bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-4 rounded-lg border border-gray-700 transition disabled:opacity-50"
              >
                Downgrade to Starter
              </button>
            )}
          </div>

          {/* Pro Plan */}
          <div className={`bg-dark-card p-6 rounded-lg border ${
            data.planType === 'pro' ? 'border-primary' : 'border-gray-800'
          }`}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-primary">Pro Plan</h3>
                <p className="text-gray-400 text-sm">For growing gyms</p>
              </div>
              {data.planType === 'pro' && (
                <span className="bg-primary text-black text-xs font-semibold px-3 py-1 rounded-full">
                  Current
                </span>
              )}
            </div>
            <div className="mb-4">
              <span className="text-4xl font-bold text-primary">$99.99</span>
              <span className="text-gray-400">/month</span>
            </div>
            <ul className="space-y-2 mb-6">
              <li className="text-gray-300 text-sm">✓ Up to 150 active members</li>
              <li className="text-gray-300 text-sm">✓ QR code check-ins</li>
              <li className="text-gray-300 text-sm">✓ Member management</li>
              <li className="text-gray-300 text-sm">✓ Dashboard analytics</li>
              <li className="text-gray-300 text-sm">✓ Priority support</li>
            </ul>
            {data.planType !== 'pro' && (
              <button
                onClick={() => handleUpgrade('pro')}
                disabled={upgrading}
                className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg transition disabled:opacity-50"
              >
                {upgrading ? 'Processing...' : 'Upgrade to Pro'}
              </button>
            )}
          </div>
        </div>

        {/* Plan Warning */}
        {isNearLimit && (
          <div className="bg-primary/20 border border-primary text-primary-light px-6 py-4 rounded-lg mb-8">
            <p className="font-semibold">
              ⚠️ You're approaching your member limit ({data.activeMembers}/{data.memberLimit})
            </p>
            <p className="text-sm mt-1">
              {data.planType === 'starter'
                ? 'Upgrade to Pro to add up to 150 members'
                : 'Contact support to increase your limit'}
            </p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Active Members */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Active Members</div>
            <div className="text-4xl font-bold text-primary">{data.activeMembers}</div>
            <div className="text-gray-500 text-sm mt-2">
              of {data.memberLimit} ({data.planType})
            </div>
          </div>

          {/* Checked In Today */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Checked In Today</div>
            <div className="text-4xl font-bold text-green-400">{data.checkedInToday}</div>
            <div className="text-gray-500 text-sm mt-2">
              {data.activeMembers > 0
                ? `${Math.round((data.checkedInToday / data.activeMembers) * 100)}% of members`
                : 'No members yet'}
            </div>
          </div>

          {/* Revenue This Month */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Revenue This Month</div>
            <div className="text-4xl font-bold text-primary">${data.revenue}</div>
            <div className="text-gray-500 text-sm mt-2">Estimated member revenue</div>
          </div>

          {/* Failed Payments */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Failed Payments</div>
            <div className={`text-4xl font-bold ${data.failedPayments > 0 ? 'text-red-400' : 'text-gray-600'}`}>
              {data.failedPayments}
            </div>
            <div className="text-gray-500 text-sm mt-2">
              {data.failedPayments > 0 ? 'Needs attention' : 'All good'}
            </div>
          </div>
        </div>

        {/* Alerts */}
        {data.cardsExpiringSoon > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-900 text-yellow-400 px-6 py-4 rounded-lg">
            <p className="font-semibold">
              💳 {data.cardsExpiringSoon} member card{data.cardsExpiringSoon > 1 ? 's' : ''} expiring soon
            </p>
            <p className="text-sm mt-1">Check the members page to update payment methods</p>
          </div>
        )}
      </div>
    </div>
  )
}
