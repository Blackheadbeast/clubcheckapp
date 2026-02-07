'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'

interface BillingData {
  planType: 'starter' | 'pro'
  subscriptionStatus: string | null
  billingPeriod: 'monthly' | 'yearly' | null
  trialEndsAt: string | null
  activeMembers: number
  memberLimit: number
  isDemo: boolean
}

const prices = {
  starter: { monthly: 49.99, yearly: 499.99, limit: 75 },
  pro: { monthly: 99.99, yearly: 999.99, limit: 150 },
}

const savings = {
  starter: Math.round(prices.starter.monthly * 12 - prices.starter.yearly),
  pro: Math.round(prices.pro.monthly * 12 - prices.pro.yearly),
}

export default function BillingPage() {
  const router = useRouter()
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [upgrading, setUpgrading] = useState<string | null>(null)

  useEffect(() => {
    async function loadBillingData() {
      try {
        const res = await fetch('/api/billing-status', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const billingData = await res.json()
        setData(billingData)
        if (billingData.billingPeriod) {
          setBillingPeriod(billingData.billingPeriod)
        }
      } catch (error) {
        console.error('Failed to load billing data:', error)
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    loadBillingData()
  }, [router])

  async function handleSubscribe(planType: 'starter' | 'pro') {
    setUpgrading(planType)
    try {
      const res = await fetch('/api/stripe/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType, billingPeriod }),
        credentials: 'include',
      })
      const result = await res.json()
      if (result.url) {
        window.location.href = result.url
      } else {
        alert(result.error || 'Failed to create checkout session')
        setUpgrading(null)
      }
    } catch (error) {
      console.error('Subscription error:', error)
      alert('Something went wrong')
      setUpgrading(null)
    }
  }

  async function handleManageSubscription() {
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        credentials: 'include',
      })
      const result = await res.json()
      if (result.url) {
        window.location.href = result.url
      }
    } catch (error) {
      console.error('Portal error:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  if (!data) return null

  const daysRemaining = data.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  const isTrialing = data.subscriptionStatus === 'trialing' || (!data.subscriptionStatus && daysRemaining !== null && daysRemaining > 0)

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary">Billing</h1>
          <p className="text-gray-400 mt-1">Manage your subscription and billing</p>
        </div>

        {/* Current Status Card */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400 mb-1">Current Plan</div>
              <div className="text-2xl font-bold text-gray-100 capitalize">
                {data.planType} Plan
              </div>
              <div className="text-gray-500 text-sm mt-1">
                {data.activeMembers} / {data.memberLimit} members
              </div>
            </div>
            <div className="text-right">
              {isTrialing && daysRemaining !== null ? (
                <div className="inline-flex items-center gap-2 bg-primary/20 text-primary px-4 py-2 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">{daysRemaining} days left in trial</span>
                </div>
              ) : data.subscriptionStatus === 'active' ? (
                <span className="inline-flex items-center gap-2 bg-green-600/20 text-green-400 px-4 py-2 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Active Subscription
                </span>
              ) : data.subscriptionStatus === 'past_due' ? (
                <span className="inline-flex items-center gap-2 bg-red-600/20 text-red-400 px-4 py-2 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Payment Past Due
                </span>
              ) : (
                <span className="text-gray-500">No active subscription</span>
              )}
            </div>
          </div>

          {/* Manage Subscription Button */}
          {data.subscriptionStatus === 'active' && !data.isDemo && (
            <div className="mt-6 pt-6 border-t border-gray-800">
              <button
                onClick={handleManageSubscription}
                className="text-primary hover:text-primary-light font-medium text-sm flex items-center gap-2"
              >
                Manage subscription on Stripe
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Billing Period Toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 p-1 bg-dark-card border border-gray-800 rounded-lg">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                billingPeriod === 'monthly'
                  ? 'bg-primary text-black'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('yearly')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 ${
                billingPeriod === 'yearly'
                  ? 'bg-primary text-black'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Yearly
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                billingPeriod === 'yearly'
                  ? 'bg-green-600 text-white'
                  : 'bg-green-600/20 text-green-400'
              }`}>
                Save ${billingPeriod === 'yearly' ? savings[data.planType] : savings.pro}
              </span>
            </button>
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Starter Plan */}
          <div className={`bg-dark-card p-6 rounded-xl border-2 transition ${
            data.planType === 'starter' ? 'border-primary' : 'border-gray-800'
          }`}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-100">Starter Plan</h3>
                <p className="text-gray-500 text-sm">Perfect for small gyms</p>
              </div>
              {data.planType === 'starter' && (
                <span className="bg-primary text-black text-xs font-semibold px-3 py-1 rounded-full">
                  Current
                </span>
              )}
            </div>

            <div className="mb-4">
              <span className="text-4xl font-bold text-primary">
                ${billingPeriod === 'monthly' ? prices.starter.monthly : prices.starter.yearly}
              </span>
              <span className="text-gray-500">/{billingPeriod === 'monthly' ? 'month' : 'year'}</span>
              {billingPeriod === 'yearly' && (
                <p className="text-green-400 text-sm mt-1">Save ${savings.starter}/year</p>
              )}
            </div>

            <ul className="space-y-2 mb-6">
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Up to 75 active members
              </li>
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                QR code check-ins
              </li>
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Member management
              </li>
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Dashboard analytics
              </li>
            </ul>

            {data.planType !== 'starter' && !data.isDemo && (
              <button
                onClick={() => handleSubscribe('starter')}
                disabled={upgrading !== null}
                className="w-full bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-3 px-4 rounded-lg border border-gray-700 transition disabled:opacity-50"
              >
                {upgrading === 'starter' ? 'Processing...' : 'Downgrade to Starter'}
              </button>
            )}
          </div>

          {/* Pro Plan */}
          <div className={`bg-dark-card p-6 rounded-xl border-2 transition relative ${
            data.planType === 'pro' ? 'border-primary' : 'border-gray-800'
          }`}>
            {/* Popular Badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-gradient-to-r from-purple-500 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                POPULAR
              </span>
            </div>

            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-100">Pro Plan</h3>
                <p className="text-gray-500 text-sm">For growing gyms</p>
              </div>
              {data.planType === 'pro' && (
                <span className="bg-primary text-black text-xs font-semibold px-3 py-1 rounded-full">
                  Current
                </span>
              )}
            </div>

            <div className="mb-4">
              <span className="text-4xl font-bold text-primary">
                ${billingPeriod === 'monthly' ? prices.pro.monthly : prices.pro.yearly}
              </span>
              <span className="text-gray-500">/{billingPeriod === 'monthly' ? 'month' : 'year'}</span>
              {billingPeriod === 'yearly' && (
                <p className="text-green-400 text-sm mt-1">Save ${savings.pro}/year</p>
              )}
            </div>

            <ul className="space-y-2 mb-6">
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Up to 150 active members
              </li>
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Everything in Starter
              </li>
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Priority support
              </li>
              <li className="flex items-center gap-2 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Advanced analytics
              </li>
            </ul>

            {data.planType !== 'pro' && !data.isDemo && (
              <button
                onClick={() => handleSubscribe('pro')}
                disabled={upgrading !== null}
                className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50"
              >
                {upgrading === 'pro' ? 'Processing...' : 'Upgrade to Pro'}
              </button>
            )}
          </div>
        </div>

        {/* Invoice Link */}
        <div className="bg-dark-card border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-100">Invoice History</h3>
              <p className="text-gray-500 text-sm mt-1">View and download your past invoices</p>
            </div>
            <Link
              href="/invoices"
              className="flex items-center gap-2 text-primary hover:text-primary-light font-medium"
            >
              View Invoices
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Demo Warning */}
        {data.isDemo && (
          <div className="mt-6 bg-purple-900/20 border border-purple-700 text-purple-300 px-6 py-4 rounded-lg">
            <p className="font-medium">Demo Mode</p>
            <p className="text-sm mt-1">Billing features are disabled in demo mode. Sign up for a real account to manage subscriptions.</p>
          </div>
        )}
      </div>
    </div>
  )
}
