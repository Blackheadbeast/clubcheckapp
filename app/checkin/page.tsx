'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import PageHelpCard from '@/components/PageHelpCard'

interface CheckinRecord {
  id: string
  timestamp: string
  source: string | null
  member: {
    id: string
    name: string
    email: string
  }
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function CheckinPage() {
  const router = useRouter()
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Tab state
  const [activeTab, setActiveTab] = useState<'qr' | 'phone'>('qr')

  // Inputs
  const [qrInput, setQrInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Date range
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())

  const loadCheckins = useCallback(async () => {
    try {
      const params = new URLSearchParams({ from: dateFrom, to: dateTo })
      const res = await fetch(`/api/checkin?${params}`, { credentials: 'include' })
      if (!res.ok) {
        router.push('/login')
        return
      }
      const data = await res.json()
      setCheckins(data.checkins)
    } catch (err) {
      console.error('Failed to load check-ins:', err)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, router])

  useEffect(() => {
    loadCheckins()
  }, [loadCheckins])

  async function handleCheckin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const payload: Record<string, string> = {}
      if (activeTab === 'qr') {
        payload.qrCode = qrInput
        payload.source = 'qr'
      } else {
        payload.phoneNumber = phoneInput
        payload.source = 'phone'
      }

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Check-in failed')
        setSubmitting(false)
        return
      }

      setSuccess(`${data.member.name} checked in!`)
      setQrInput('')
      setPhoneInput('')

      await loadCheckins()
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  function handleExport() {
    const params = new URLSearchParams({ from: dateFrom, to: dateTo })
    window.location.href = `/api/checkin/export?${params}`
  }

  const sourceLabel = (source: string | null) => {
    const labels: Record<string, string> = {
      qr: 'QR',
      phone: 'Phone',
      kiosk: 'Kiosk',
      manual: 'Manual',
    }
    return source ? labels[source] || source : '-'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-theme">
      <Navbar />
      <PageHelpCard pageKey="checkin" />
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-primary">Check-In</h1>
            <p className="text-gray-400 mt-1">{checkins.length} check-ins shown</p>
          </div>
          <button
            onClick={handleExport}
            className="bg-theme-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-5 rounded-lg border border-gray-700 transition"
          >
            Export CSV
          </button>
        </div>

        {/* Check-in Card */}
        <div className="bg-theme-card p-8 rounded-lg border border-theme mb-8">
          <h2 className="text-xl font-bold text-primary mb-6">Member Check-In</h2>

          {/* Method Tabs */}
          <div className="flex gap-2 mb-6 bg-theme-lighter p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('qr')}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                activeTab === 'qr' ? 'bg-primary text-black' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              QR Code
            </button>
            <button
              onClick={() => setActiveTab('phone')}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                activeTab === 'phone' ? 'bg-primary text-black' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Phone Number
            </button>
          </div>

          <form onSubmit={handleCheckin} className="space-y-4">
            {activeTab === 'qr' && (
              <div>
                <label className="block text-sm font-medium mb-2">Scan or Enter QR Code</label>
                <input
                  type="text"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder="Scan member's QR code here..."
                  autoFocus
                  className="w-full px-4 py-3 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 text-lg"
                />
                <p className="text-gray-500 text-sm mt-2">Click here and scan the member&apos;s QR code</p>
              </div>
            )}

            {activeTab === 'phone' && (
              <div>
                <label className="block text-sm font-medium mb-2">Enter Phone Number</label>
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="(555) 123-4567"
                  autoFocus
                  className="w-full px-4 py-3 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 text-lg"
                />
              </div>
            )}

            {error && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-3 rounded-lg">{error}</div>
            )}
            {success && (
              <div className="bg-green-900/20 border border-green-900 text-green-400 px-4 py-3 rounded-lg font-semibold">{success}</div>
            )}

            <button
              type="submit"
              disabled={submitting || (activeTab === 'qr' && !qrInput) || (activeTab === 'phone' && !phoneInput)}
              className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-lg"
            >
              {submitting ? 'Checking in...' : 'Check In'}
            </button>
          </form>
        </div>

        {/* History Section */}
        <div className="bg-theme-card rounded-lg border border-theme">
          <div className="px-6 py-4 border-b border-theme flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <h2 className="text-xl font-bold text-primary">Check-In History</h2>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 bg-theme-lighter border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-primary"
              />
              <span className="text-gray-500 text-sm">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 bg-theme-lighter border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {checkins.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No check-ins for this date range</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-theme-lighter border-b border-theme">
                  <tr>
                    <th className="text-left px-6 py-3 text-gray-400 font-medium text-sm">Member</th>
                    <th className="text-left px-6 py-3 text-gray-400 font-medium text-sm">Time</th>
                    <th className="text-left px-6 py-3 text-gray-400 font-medium text-sm">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {checkins.map((checkin) => (
                    <tr key={checkin.id} className="border-b border-theme hover:bg-theme-lighter">
                      <td className="px-6 py-3">
                        <Link href={`/members/${checkin.member.id}`} className="hover:text-primary transition">
                          <div className="font-medium text-gray-100">{checkin.member.name}</div>
                          <div className="text-xs text-gray-500">{checkin.member.email}</div>
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-sm">
                        {new Date(checkin.timestamp).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-xs text-gray-400 bg-theme-lighter px-2 py-1 rounded">
                          {sourceLabel(checkin.source)}
                        </span>
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
