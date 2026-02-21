'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Logo from '@/components/Logo'

interface Profile {
  id: string
  name: string
  email: string
  referralCode: string
  commissionPercent: number
  createdAt: string
}

export default function SalesSettingsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/profile', { credentials: 'include' })
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/sales/login')
          return
        }
        throw new Error()
      }
      setProfile(await res.json())
    } catch {
      console.error('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sales/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'include',
      })

      const data = await res.json()
      if (!res.ok) {
        setPasswordError(data.error || 'Update failed')
      } else {
        setPasswordSuccess('Password updated successfully')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      }
    } catch {
      setPasswordError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/sales/logout', { method: 'POST', credentials: 'include' })
    router.push('/sales/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-theme flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-theme flex items-center justify-center">
        <div className="text-red-400">Failed to load profile</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-theme">
      <header className="bg-theme-card border-b border-theme px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="md" />
            <h1 className="text-lg font-semibold text-theme-heading">Settings</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sales/dashboard"
              className="px-4 py-2 bg-theme-lighter border border-theme rounded-lg text-sm text-theme-secondary hover:text-theme-heading transition"
            >
              Back to Dashboard
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

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Profile Info */}
        <div className="bg-theme-card rounded-lg border border-theme p-6">
          <h2 className="text-lg font-semibold text-theme-heading mb-4">Profile</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-theme-secondary">Name</p>
              <p className="text-theme-heading font-medium">{profile.name}</p>
            </div>
            <div>
              <p className="text-theme-secondary">Email</p>
              <p className="text-theme-heading font-medium">{profile.email}</p>
            </div>
            <div>
              <p className="text-theme-secondary">Referral Code</p>
              <p className="text-primary font-mono font-semibold">{profile.referralCode}</p>
            </div>
            <div>
              <p className="text-theme-secondary">Commission</p>
              <p className="text-theme-heading font-medium">{profile.commissionPercent}%</p>
            </div>
            <div>
              <p className="text-theme-secondary">Member Since</p>
              <p className="text-theme-heading font-medium">{new Date(profile.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-theme-card rounded-lg border border-theme p-6">
          <h2 className="text-lg font-semibold text-theme-heading mb-4">Change Password</h2>
          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">New Password</label>
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
              <label className="block text-sm font-medium mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
              />
            </div>

            {passwordError && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="bg-green-900/20 border border-green-900 text-green-400 px-4 py-2 rounded-lg text-sm">
                {passwordSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Update Password'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
