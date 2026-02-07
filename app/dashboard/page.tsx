//app/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import SetupWizard from '@/components/SetupWizard'
import BillingStatusBanner from '@/components/BillingStatusBanner'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'

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

interface TrendPoint {
  date: string
  value: number
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
  trialDaysRemaining: number | null
  trends: {
    members: TrendPoint[]
    checkins: TrendPoint[]
    revenue: TrendPoint[]
    failedPayments: TrendPoint[]
  }
}

function MiniChart({ data, color, isNegative = false }: { data: TrendPoint[], color: string, isNegative?: boolean }) {
  const gradientId = `gradient-${color.replace('#', '')}`

  return (
    <div className="h-[60px] w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

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

  // Determine billing status display
  const getBillingStatus = () => {
    if (data.trialDaysRemaining !== null && data.trialDaysRemaining > 0) {
      return {
        label: 'Trial',
        sublabel: `${data.trialDaysRemaining} days left`,
        color: 'text-primary',
        bgColor: 'bg-primary/20',
      }
    }
    if (data.subscriptionStatus === 'active') {
      return {
        label: data.planType.charAt(0).toUpperCase() + data.planType.slice(1),
        sublabel: 'Active',
        color: 'text-green-400',
        bgColor: 'bg-green-600/20',
      }
    }
    if (data.subscriptionStatus === 'past_due') {
      return {
        label: 'Past Due',
        sublabel: 'Payment required',
        color: 'text-red-400',
        bgColor: 'bg-red-600/20',
      }
    }
    return {
      label: 'No Plan',
      sublabel: 'Subscribe to continue',
      color: 'text-gray-400',
      bgColor: 'bg-gray-600/20',
    }
  }

  const billingStatus = getBillingStatus()

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

        {/* Billing Status Strip */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-4 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`px-3 py-1 rounded-lg ${billingStatus.bgColor}`}>
                <span className={`font-semibold ${billingStatus.color}`}>{billingStatus.label}</span>
              </div>
              <div className="text-gray-400 text-sm">
                {billingStatus.sublabel}
              </div>
              <div className="text-gray-600">|</div>
              <div className="text-gray-400 text-sm">
                <span className="text-gray-100 font-medium">{data.activeMembers}</span> / {data.memberLimit} members
              </div>
            </div>
            <Link
              href="/billing"
              className="flex items-center gap-2 text-primary hover:text-primary-light font-medium text-sm transition"
            >
              Manage Billing
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Plan Warning */}
        {isNearLimit && (
          <div className="bg-primary/20 border border-primary text-primary-light px-6 py-4 rounded-lg mb-8">
            <p className="font-semibold">
              You&apos;re approaching your member limit ({data.activeMembers}/{data.memberLimit})
            </p>
            <p className="text-sm mt-1">
              {data.planType === 'starter'
                ? 'Upgrade to Pro to add up to 150 members'
                : 'Contact support to increase your limit'}
            </p>
          </div>
        )}

        {/* Stats Grid with Sparklines */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Active Members */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-gray-400 text-sm mb-1">Active Members</div>
                <div className="text-3xl font-bold text-primary">{data.activeMembers}</div>
              </div>
              <div className="text-gray-500 text-xs bg-dark-lighter px-2 py-1 rounded">
                12w trend
              </div>
            </div>
            <MiniChart data={data.trends.members} color="#f59e0b" />
          </div>

          {/* Checked In Today */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-gray-400 text-sm mb-1">Check-ins Today</div>
                <div className="text-3xl font-bold text-green-400">{data.checkedInToday}</div>
              </div>
              <div className="text-gray-500 text-xs bg-dark-lighter px-2 py-1 rounded">
                14d trend
              </div>
            </div>
            <MiniChart data={data.trends.checkins} color="#22c55e" />
          </div>

          {/* Revenue This Month */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-gray-400 text-sm mb-1">Est. Revenue</div>
                <div className="text-3xl font-bold text-primary">${data.revenue}</div>
              </div>
              <div className="text-gray-500 text-xs bg-dark-lighter px-2 py-1 rounded">
                30d trend
              </div>
            </div>
            <MiniChart data={data.trends.revenue} color="#f59e0b" />
          </div>

          {/* Failed Payments */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-gray-400 text-sm mb-1">Failed Payments</div>
                <div className={`text-3xl font-bold ${data.failedPayments > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                  {data.failedPayments}
                </div>
              </div>
              <div className="text-gray-500 text-xs bg-dark-lighter px-2 py-1 rounded">
                30d trend
              </div>
            </div>
            <MiniChart data={data.trends.failedPayments} color="#ef4444" isNegative />
          </div>
        </div>

        {/* Alerts */}
        {data.cardsExpiringSoon > 0 && (
          <div className="bg-yellow-900/20 border border-yellow-900 text-yellow-400 px-6 py-4 rounded-lg">
            <p className="font-semibold">
              {data.cardsExpiringSoon} member card{data.cardsExpiringSoon > 1 ? 's' : ''} expiring soon
            </p>
            <p className="text-sm mt-1">Check the members page to update payment methods</p>
          </div>
        )}
      </div>
    </div>
  )
}
