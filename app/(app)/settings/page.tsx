'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import PageHelpCard from '@/components/PageHelpCard'
import SystemStatus from '@/components/SystemStatus'
import { useTheme } from '@/components/ThemeProvider'
import { Theme } from '@/lib/theme'

type Tab = 'gym' | 'account' | 'billing' | 'waiver' | 'appearance' | 'system'

interface SettingsData {
  owner: {
    id: string
    email: string
    planType: string
    subscriptionStatus: string | null
    currentPeriodEnd: string | null
    createdAt: string
  }
  gym: {
    name: string
    address: string
    logoUrl: string
    billingMode: string
    externalProviderName: string
    billingContactEmail: string
  }
}

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('gym')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<SettingsData | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form states
  const [gymName, setGymName] = useState('')
  const [gymAddress, setGymAddress] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [billingMode, setBillingMode] = useState('stripe')
  const [externalProviderName, setExternalProviderName] = useState('')
  const [billingContactEmail, setBillingContactEmail] = useState('')

  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Waiver settings
  const [waiverEnabled, setWaiverEnabled] = useState(false)
  const [waiverText, setWaiverText] = useState('')
  const [waiverLoaded, setWaiverLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const json = await res.json()
        setData(json)
        setGymName(json.gym.name)
        setGymAddress(json.gym.address)
        setLogoUrl(json.gym.logoUrl)
        setBillingMode(json.gym.billingMode)
        setExternalProviderName(json.gym.externalProviderName)
        setBillingContactEmail(json.gym.billingContactEmail)
      } catch {
        console.error('Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  useEffect(() => {
    async function loadWaiver() {
      if (activeTab !== 'waiver' || waiverLoaded) return
      try {
        const res = await fetch('/api/settings/waiver', { credentials: 'include' })
        if (res.ok) {
          const json = await res.json()
          setWaiverEnabled(json.waiverEnabled)
          setWaiverText(json.waiverText || '')
          setWaiverLoaded(true)
        }
      } catch {
        console.error('Failed to load waiver settings')
      }
    }
    loadWaiver()
  }, [activeTab, waiverLoaded])

  async function handleSaveGym(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gymName,
          gymAddress,
          logoUrl,
        }),
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Failed to save' })
        return
      }

      setMessage({ type: 'success', text: 'Gym settings saved!' })
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveBilling(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingMode,
          externalProviderName,
          billingContactEmail,
        }),
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Failed to save' })
        return
      }

      setMessage({ type: 'success', text: 'Billing settings saved!' })
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' })
      return
    }

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }

    setSaving(true)

    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Failed to change password' })
        return
      }

      setMessage({ type: 'success', text: 'Password changed successfully!' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveWaiver(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/settings/waiver', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiverEnabled, waiverText }),
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Failed to save waiver settings' })
        return
      }

      setMessage({ type: 'success', text: 'Waiver settings saved!' })
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong' })
    } finally {
      setSaving(false)
    }
  }

  // Hooks run on every render, so this one sits above the early return below.
  const { theme, setTheme } = useTheme()

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-fg-muted">Loading...</div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'gym', label: 'Gym Info' },
    { id: 'account', label: 'Account' },
    { id: 'billing', label: 'Billing' },
    { id: 'waiver', label: 'Waiver' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'system', label: 'System' },
  ]

  return (
    <div className="min-h-full">
      <Navbar />
      <PageHelpCard pageKey="settings" />

      <div className="ui-rise mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6"><h1 className="ui-page-title">Business settings</h1><p className="mt-1.5 text-[0.9375rem] leading-6 text-fg-muted">Your gym's details, your account, the check-in kiosk, the waiver and how ClubCheck looks.</p></div>

        {/* Message */}
        {message && (
          <div
            className={`mb-6 px-4 py-3 rounded-lg ${
              message.type === 'success'
                ? 'border border-emerald-500/25 bg-emerald-500/10 text-sm font-medium text-emerald-700 dark:text-emerald-400'
                : 'border border-red-500/25 bg-red-500/10 text-sm font-medium text-red-700 dark:text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div role="tablist" aria-label="Settings sections" className="mb-6 flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setMessage(null)
              }}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`ui-focus min-h-10 rounded-lg px-3.5 text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'bg-surface text-fg-heading shadow-card'
                  : 'text-fg-muted hover:text-fg-heading'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Gym Info Tab */}
        {activeTab === 'gym' && (
          <form onSubmit={handleSaveGym} className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="ui-section-title mb-5 text-lg">Gym Information</h2>

            <div className="space-y-4">
              <div>
                <label className="ui-label mb-1.5 block">Gym Name</label>
                <input
                  type="text"
                  value={gymName}
                  onChange={(e) => setGymName(e.target.value)}
                  placeholder="Your Gym Name"
                  className="ui-input h-10"
                />
              </div>

              <div>
                <label className="ui-label mb-1.5 block">Address</label>
                <textarea
                  value={gymAddress}
                  onChange={(e) => setGymAddress(e.target.value)}
                  placeholder="123 Main St, City, State 12345"
                  rows={2}
                  className="ui-input resize-none"
                />
              </div>

              <div>
                <label className="ui-label mb-1.5 block">Logo URL</label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="ui-input h-10"
                />
                <p className="mt-1.5 text-sm text-fg-muted">
                  Enter a URL to your gym&apos;s logo. Recommended size: 200x200px.
                </p>
                {logoUrl && (
                  <div className="mt-3 flex items-center gap-3">
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      className="h-12 w-12 rounded-lg object-cover border border-line"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    <span className="text-sm text-fg-muted">Preview</span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="ui-focus mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg shadow-card transition hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        )}

        {/* Account Tab */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            {/* Account Info */}
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
              <h2 className="ui-section-title mb-5 text-lg">Account Information</h2>

              <div className="space-y-4">
                <div>
                  <label className="ui-label mb-1.5 block">Email</label>
                  <div className="text-fg-heading">{data?.owner.email}</div>
                </div>

                <div>
                  <label className="ui-label mb-1.5 block">Member Since</label>
                  <div className="text-fg-heading">
                    {data?.owner.createdAt
                      ? new Date(data.owner.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })
                      : '-'}
                  </div>
                </div>

                <div>
                  <label className="ui-label mb-1.5 block">Plan</label>
                  <div className="capitalize text-fg-heading">{data?.owner.planType || 'Starter'}</div>
                </div>
              </div>
            </div>

            {/* Change Password */}
            <form
              onSubmit={handleChangePassword}
              className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"
            >
              <h2 className="ui-section-title mb-5 text-lg">Change Password</h2>

              <div className="space-y-4">
                <div>
                  <label className="ui-label mb-1.5 block">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="ui-input h-10"
                  />
                </div>

                <div>
                  <label className="ui-label mb-1.5 block">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="ui-input h-10"
                  />
                </div>

                <div>
                  <label className="ui-label mb-1.5 block">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="ui-input h-10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !currentPassword || !newPassword}
                className="ui-focus mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg shadow-card transition hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>
        )}

        {/* Billing Tab */}
        {activeTab === 'billing' && (
          <form onSubmit={handleSaveBilling} className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="ui-section-title mb-5 text-lg">Billing Settings</h2>

            <div className="space-y-4">
              <div>
                <label className="ui-label mb-1.5 block">Billing Mode</label>
                <select
                  value={billingMode}
                  onChange={(e) => setBillingMode(e.target.value)}
                  className="ui-input h-10"
                >
                  <option value="stripe">Stripe (Automatic)</option>
                  <option value="external">External Provider</option>
                </select>
                <p className="mt-1.5 text-sm text-fg-muted">
                  Choose how you process member payments.
                </p>
              </div>

              {billingMode === 'external' && (
                <div>
                  <label className="ui-label mb-1.5 block">
                    External Provider Name
                  </label>
                  <input
                    type="text"
                    value={externalProviderName}
                    onChange={(e) => setExternalProviderName(e.target.value)}
                    placeholder="e.g., Square, PayPal, etc."
                    className="ui-input h-10"
                  />
                </div>
              )}

              <div>
                <label className="ui-label mb-1.5 block">
                  Billing Contact Email
                </label>
                <input
                  type="email"
                  value={billingContactEmail}
                  onChange={(e) => setBillingContactEmail(e.target.value)}
                  placeholder="billing@yourgym.com"
                  className="ui-input h-10"
                />
                <p className="mt-1.5 text-sm text-fg-muted">
                  Where billing-related notifications should be sent.
                </p>
              </div>

              {/* Subscription Info */}
              {data?.owner.subscriptionStatus && (
                <div className="mt-6 border-t border-line pt-6">
                  <h3 className="ui-section-title mb-4">Current Subscription</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-fg-muted">Status</div>
                      <div
                        className={`font-medium capitalize ${
                          data.owner.subscriptionStatus === 'active'
                            ? 'text-green-400'
                            : data.owner.subscriptionStatus === 'past_due'
                            ? 'text-red-400'
                            : 'text-yellow-400'
                        }`}
                      >
                        {data.owner.subscriptionStatus}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-fg-muted">Next Billing Date</div>
                      <div className="text-fg-heading">
                        {data.owner.currentPeriodEnd
                          ? new Date(data.owner.currentPeriodEnd).toLocaleDateString()
                          : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="ui-focus mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg shadow-card transition hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        )}

        {/* Waiver Tab */}
        {activeTab === 'waiver' && (
          <form onSubmit={handleSaveWaiver} className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="ui-section-title mb-5 text-lg">Liability Waiver</h2>

            <div className="space-y-6">
              {/* Enable Toggle */}
              <div className="flex items-center justify-between rounded-xl border border-line bg-subtle/60 p-4">
                <div>
                  <h3 className="font-medium text-fg-heading">Enable Digital Waiver</h3>
                  <p className="mt-1.5 text-sm text-fg-muted">
                    Require members to sign a liability waiver before their first check-in
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waiverEnabled}
                    onChange={(e) => setWaiverEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-line peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>

              {/* Waiver Text */}
              <div>
                <label className="ui-label mb-1.5 block">
                  Waiver Text
                </label>
                <textarea
                  value={waiverText}
                  onChange={(e) => setWaiverText(e.target.value)}
                  rows={12}
                  placeholder="Enter your gym's liability waiver text here...

Example:
ASSUMPTION OF RISK: I understand that participation in physical exercise and use of gym equipment involves inherent risks, including but not limited to injury, illness, or death.

RELEASE AND WAIVER: I hereby release and waive any claims against [Gym Name], its owners, employees, and agents from any and all liability for injuries or damages resulting from my participation in gym activities.

MEDICAL CONDITIONS: I confirm that I have no medical conditions that would prevent me from safely participating in physical exercise, or I have obtained clearance from a medical professional.

I have read this waiver in its entirety and understand that I am giving up substantial rights by signing it."
                  className="ui-input resize-none font-mono"
                />
                <p className="mt-2 text-sm text-fg-muted">
                  This text will be shown to members when they sign the waiver. Make sure to include all
                  necessary legal language for your jurisdiction.
                </p>
              </div>

              {/* Preview Info */}
              {waiverEnabled && (
                <div className="rounded-xl border border-accent/30 bg-accent/10 p-4">
                  <h3 className="mb-2 font-medium text-fg-heading">How it works</h3>
                  <ul className="space-y-1 text-sm text-fg-muted">
                    <li>1. Each member gets a unique waiver signing link</li>
                    <li>2. You can send the link from the member details page</li>
                    <li>3. Members sign by typing their name and verifying their email</li>
                    <li>4. Waiver status appears in the members list</li>
                  </ul>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="ui-focus mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg shadow-card transition hover:brightness-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Waiver Settings'}
            </button>
          </form>
        )}

        {/* Appearance Tab */}
        {activeTab === 'appearance' && (
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 className="ui-section-title mb-5 text-lg">Appearance</h2>

            <div className="space-y-6">
              <div>
                <label className="ui-label mb-3 block">Theme</label>
                <div className="grid grid-cols-3 gap-4">
                  {(['light', 'dark', 'auto'] as Theme[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTheme(option)}
                      className={`p-4 rounded-xl border-2 transition flex flex-col items-center gap-3 ${
                        theme === option
                          ? 'border-accent bg-accent/10'
                          : 'border-line hover:border-fg-muted/40'
                      }`}
                    >
                      <div
                        className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          option === 'light'
                            ? 'bg-gray-100'
                            : option === 'dark'
                            ? 'bg-gray-900'
                            : 'bg-gradient-to-br from-gray-100 to-gray-900'
                        }`}
                      >
                        {option === 'light' && (
                          <svg className="w-6 h-6 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
                          </svg>
                        )}
                        {option === 'dark' && (
                          <svg className="w-6 h-6 text-indigo-400" fill="currentColor" viewBox="0 0 24 24">
                            <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clipRule="evenodd" />
                          </svg>
                        )}
                        {option === 'auto' && (
                          <svg className="w-6 h-6 text-fg-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="text-center">
                        <div className={`font-medium capitalize ${'text-fg-heading'}`}>
                          {option}
                        </div>
                        <div className="mt-1.5 text-xs text-fg-muted">
                          {option === 'light' && 'Always light'}
                          {option === 'dark' && 'Always dark'}
                          {option === 'auto' && 'Match system'}
                        </div>
                      </div>
                      {theme === option && (
                        <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-line bg-subtle/60 p-4">
                <p className="text-sm text-fg-muted">
                  Your theme preference is saved automatically and synced across devices.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* System Tab */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            <SystemStatus />

            {/* Environment Info */}
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
              <h3 className="text-lg font-semibold mb-4">Environment</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-fg-muted">Mode:</span>
                  <span className="ml-2 text-fg-heading">
                    {process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted">Owner ID:</span>
                  <span className="ml-2 font-mono text-xs text-fg-heading">
                    {data?.owner.id.slice(0, 8)}...
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
