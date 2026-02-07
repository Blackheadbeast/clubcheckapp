'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface MemberDetail {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  qrCode: string
  createdAt: string
  lastCheckInAt: string | null
  checkInCount: number
  qrCodeUrl: string
  waiverSignedAt: string | null
  waiverSignature: string | null
  waiverEnabled: boolean
}

interface CheckinEntry {
  id: string
  timestamp: string
  source: string | null
  deviceName: string | null
}

type Tab = 'profile' | 'checkins' | 'billing'

export default function MemberDetailPage() {
  const router = useRouter()
  const params = useParams()
  const memberId = params.id as string

  const [member, setMember] = useState<MemberDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sendingQr, setSendingQr] = useState(false)
  const [qrEmailSent, setQrEmailSent] = useState(false)
  const [sendingWaiver, setSendingWaiver] = useState(false)
  const [waiverEmailSent, setWaiverEmailSent] = useState(false)
  const [copiedWaiverLink, setCopiedWaiverLink] = useState(false)

  // Check-in history state
  const [checkins, setCheckins] = useState<CheckinEntry[]>([])
  const [checkinsTotal, setCheckinsTotal] = useState(0)
  const [checkinsLoading, setCheckinsLoading] = useState(false)
  const [checkinsOffset, setCheckinsOffset] = useState(0)
  const CHECKINS_LIMIT = 20

  useEffect(() => {
    loadMember()
  }, [memberId])

  useEffect(() => {
    if (activeTab === 'checkins') {
      loadCheckins(0)
    }
  }, [activeTab])

  async function loadMember() {
    try {
      const res = await fetch(`/api/members/${memberId}`, { credentials: 'include' })
      if (!res.ok) {
        if (res.status === 401) router.push('/login')
        else router.push('/members')
        return
      }
      const data = await res.json()
      setMember(data.member)
      setEditName(data.member.name)
      setEditEmail(data.member.email)
      setEditPhone(data.member.phone || '')
      setEditStatus(data.member.status)
    } catch {
      router.push('/members')
    } finally {
      setLoading(false)
    }
  }

  async function loadCheckins(offset: number) {
    setCheckinsLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(CHECKINS_LIMIT),
        offset: String(offset),
      })
      const res = await fetch(`/api/members/${memberId}/checkins?${params}`, {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setCheckins(data.checkins)
        setCheckinsTotal(data.total)
        setCheckinsOffset(offset)
      }
    } catch {
      console.error('Failed to load checkins')
    } finally {
      setCheckinsLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          email: editEmail,
          phone: editPhone || null,
          status: editStatus,
        }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update')
        setSaving(false)
        return
      }
      await loadMember()
      setEditing(false)
    } catch {
      setError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this member permanently? This cannot be undone.')) return
    try {
      await fetch(`/api/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      router.push('/members')
    } catch {
      setError('Failed to delete member')
    }
  }

  async function handleSendQr() {
    setSendingQr(true)
    setQrEmailSent(false)
    try {
      const res = await fetch(`/api/members/${memberId}/send-qr`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setQrEmailSent(true)
        setTimeout(() => setQrEmailSent(false), 5000)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to send email')
      }
    } catch {
      setError('Failed to send email')
    } finally {
      setSendingQr(false)
    }
  }

  async function handleSendWaiverEmail() {
    setSendingWaiver(true)
    setWaiverEmailSent(false)
    try {
      const res = await fetch(`/api/members/${memberId}/send-waiver`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setWaiverEmailSent(true)
        setTimeout(() => setWaiverEmailSent(false), 5000)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to send waiver email')
      }
    } catch {
      setError('Failed to send waiver email')
    } finally {
      setSendingWaiver(false)
    }
  }

  function handleCopyWaiverLink() {
    const link = `${window.location.origin}/waiver/${memberId}`
    navigator.clipboard.writeText(link)
    setCopiedWaiverLink(true)
    setTimeout(() => setCopiedWaiverLink(false), 3000)
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-900/20 text-green-400 border-green-900',
      inactive: 'bg-gray-800 text-gray-400 border-gray-700',
      delinquent: 'bg-red-900/20 text-red-400 border-red-900',
      paused: 'bg-yellow-900/20 text-yellow-400 border-yellow-900',
    }
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${colors[status] || colors.inactive}`}>
        {status}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  if (!member) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'checkins', label: 'Check-ins' },
    { key: 'billing', label: 'Billing' },
  ]

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Back + Header */}
        <div className="mb-6">
          <Link href="/members" className="text-gray-400 hover:text-primary text-sm mb-4 inline-block">
            ← Back to Members
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-100">{member.name}</h1>
              <p className="text-gray-400 mt-1">{member.email}</p>
            </div>
            <div className="flex items-center gap-3">
              {statusBadge(member.status)}
              <button
                onClick={handleDelete}
                className="text-red-400 hover:text-red-300 text-sm font-medium border border-red-900/50 hover:border-red-700 px-3 py-1.5 rounded-lg transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-dark-card p-4 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-xs mb-1">Total Check-ins</div>
            <div className="text-2xl font-bold text-primary">{member.checkInCount}</div>
          </div>
          <div className="bg-dark-card p-4 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-xs mb-1">Last Check-in</div>
            <div className="text-lg font-semibold text-gray-100">
              {member.lastCheckInAt
                ? new Date(member.lastCheckInAt).toLocaleDateString()
                : 'Never'}
            </div>
          </div>
          <div className="bg-dark-card p-4 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-xs mb-1">Member Since</div>
            <div className="text-lg font-semibold text-gray-100">
              {new Date(member.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'profile' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Profile Info / Edit */}
            <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-primary">Profile Info</h2>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="text-primary hover:text-primary-light text-sm font-medium"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-3 py-2 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full px-3 py-2 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="paused">Paused</option>
                      <option value="delinquent">Delinquent</option>
                    </select>
                  </div>
                  {error && (
                    <div className="bg-red-900/20 border border-red-900 text-red-400 px-3 py-2 rounded-lg text-sm">
                      {error}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg text-sm transition disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false)
                        setEditName(member.name)
                        setEditEmail(member.email)
                        setEditPhone(member.phone || '')
                        setEditStatus(member.status)
                        setError('')
                      }}
                      className="text-gray-400 hover:text-gray-200 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-gray-500">Name</div>
                    <div className="text-gray-100">{member.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Email</div>
                    <div className="text-gray-100">{member.email}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Phone</div>
                    <div className="text-gray-100">{member.phone || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Status</div>
                    <div className="mt-1">{statusBadge(member.status)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">QR Code ID</div>
                    <div className="text-gray-400 text-xs font-mono break-all">{member.qrCode}</div>
                  </div>
                </div>
              )}
            </div>

            {/* QR Code */}
            <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
              <h2 className="text-lg font-bold text-primary mb-4">QR Code</h2>
              <div className="flex justify-center mb-4">
                <img src={member.qrCodeUrl} alt="Member QR Code" className="w-48 h-48" />
              </div>
              <p className="text-gray-500 text-xs text-center mb-4">Scan at kiosk for check-in</p>
              <div className="space-y-2">
                <a
                  href={`/api/members/${member.id}/qr`}
                  className="block text-center bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-4 rounded-lg border border-gray-700 transition text-sm"
                >
                  Download QR (PNG)
                </a>
                <button
                  onClick={handleSendQr}
                  disabled={sendingQr}
                  className="w-full bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-4 rounded-lg border border-gray-700 transition text-sm disabled:opacity-50"
                >
                  {sendingQr ? 'Sending...' : 'Resend QR Email'}
                </button>
                {qrEmailSent && (
                  <p className="text-green-400 text-xs text-center">Email sent to {member.email}</p>
                )}
              </div>
            </div>

            {/* Waiver Card */}
            {member.waiverEnabled && (
              <div className="bg-dark-card p-6 rounded-lg border border-gray-800 md:col-span-2">
                <h2 className="text-lg font-bold text-primary mb-4">Liability Waiver</h2>

                {member.waiverSignedAt ? (
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-900/20 rounded-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-green-400 font-medium">Waiver Signed</p>
                      <p className="text-gray-500 text-sm">
                        Signed on {new Date(member.waiverSignedAt).toLocaleDateString()} by &quot;{member.waiverSignature}&quot;
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-yellow-900/20 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-yellow-400 font-medium">Waiver Not Signed</p>
                        <p className="text-gray-500 text-sm">Send the waiver link to this member</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleSendWaiverEmail}
                        disabled={sendingWaiver}
                        className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg text-sm transition disabled:opacity-50"
                      >
                        {sendingWaiver ? 'Sending...' : 'Send Waiver Email'}
                      </button>
                      <button
                        onClick={handleCopyWaiverLink}
                        className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-4 rounded-lg border border-gray-700 text-sm transition"
                      >
                        {copiedWaiverLink ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                    {waiverEmailSent && (
                      <p className="text-green-400 text-xs mt-2">Waiver email sent to {member.email}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'checkins' && (
          <div className="bg-dark-card rounded-lg border border-gray-800">
            <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-primary">
                Check-in History ({checkinsTotal} total)
              </h2>
            </div>

            {checkinsLoading ? (
              <div className="p-8 text-center text-gray-400">Loading...</div>
            ) : checkins.length === 0 ? (
              <div className="p-8 text-center text-gray-400">No check-ins recorded yet</div>
            ) : (
              <>
                <div className="divide-y divide-gray-800">
                  {checkins.map((ci) => (
                    <div key={ci.id} className="px-6 py-3 flex justify-between items-center hover:bg-dark-lighter">
                      <div>
                        <div className="text-gray-100 text-sm">
                          {new Date(ci.timestamp).toLocaleString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </div>
                        {ci.deviceName && (
                          <div className="text-xs text-gray-500">{ci.deviceName}</div>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 bg-dark-lighter px-2 py-1 rounded">
                        {ci.source || '-'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {checkinsTotal > CHECKINS_LIMIT && (
                  <div className="px-6 py-3 border-t border-gray-800 flex justify-between items-center">
                    <button
                      onClick={() => loadCheckins(Math.max(0, checkinsOffset - CHECKINS_LIMIT))}
                      disabled={checkinsOffset === 0}
                      className="text-sm text-primary hover:text-primary-light disabled:text-gray-600 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-500">
                      {checkinsOffset + 1}–{Math.min(checkinsOffset + CHECKINS_LIMIT, checkinsTotal)} of {checkinsTotal}
                    </span>
                    <button
                      onClick={() => loadCheckins(checkinsOffset + CHECKINS_LIMIT)}
                      disabled={checkinsOffset + CHECKINS_LIMIT >= checkinsTotal}
                      className="text-sm text-primary hover:text-primary-light disabled:text-gray-600 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="bg-dark-card p-8 rounded-lg border border-gray-800 text-center">
            <p className="text-gray-400">Billing details coming in a later step.</p>
          </div>
        )}
      </div>
    </div>
  )
}
