//app/checkin/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Checkin {
  id: string
  timestamp: string
  member: {
    id: string
    name: string
    email: string
  }
}

export default function CheckinPage() {
  const router = useRouter()
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'qr' | 'phone'>('qr')
  
  // QR input
  const [qrInput, setQrInput] = useState('')
  
  // Phone input
  const [phoneInput, setPhoneInput] = useState('')
  
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadCheckins()
  }, [])

  async function loadCheckins() {
    try {
      const res = await fetch('/api/checkin')
      
      if (!res.ok) {
        router.push('/login')
        return
      }

      const data = await res.json()
      setCheckins(data.checkins)
    } catch (error) {
      console.error('Failed to load check-ins:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleCheckin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const payload = activeTab === 'qr' 
        ? { qrCode: qrInput }
        : { phoneNumber: phoneInput }

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Check-in failed')
        setSubmitting(false)
        return
      }

      setSuccess(`✓ ${data.member.name} checked in!`)
      setQrInput('')
      setPhoneInput('')
      
      await loadCheckins()
      
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-primary">Check-In</h1>
            <p className="text-gray-400 mt-1">{checkins.length} check-ins today</p>
          </div>
          <Link
            href="/dashboard"
            className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-6 rounded-lg border border-gray-700 transition"
          >
            Dashboard
          </Link>
        </div>

        {/* Check-in Card */}
        <div className="bg-dark-card p-8 rounded-lg border border-gray-800 mb-8">
          <h2 className="text-xl font-bold text-primary mb-6">Member Check-In</h2>
          
          {/* Tabs */}
          <div className="flex gap-2 mb-6 bg-dark-lighter p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('qr')}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                activeTab === 'qr'
                  ? 'bg-primary text-black'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              📱 QR Code
            </button>
            <button
              onClick={() => setActiveTab('phone')}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                activeTab === 'phone'
                  ? 'bg-primary text-black'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              📞 Phone Number
            </button>
          </div>

          <form onSubmit={handleCheckin} className="space-y-4">
            {/* QR Code Input */}
            {activeTab === 'qr' && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Scan or Enter QR Code
                </label>
                <input
                  type="text"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder="Scan member's QR code here..."
                  autoFocus
                  className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 text-lg"
                />
                <p className="text-gray-500 text-sm mt-2">
                  Click here and scan the member's QR code from their phone
                </p>
              </div>
            )}

            {/* Phone Number Input */}
            {activeTab === 'phone' && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Enter Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="(555) 123-4567"
                  autoFocus
                  className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 text-lg"
                />
                <p className="text-gray-500 text-sm mt-2">
                  Enter member's phone number to check them in
                </p>
              </div>
            )}

            {error && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-900/20 border border-green-900 text-green-400 px-4 py-3 rounded-lg font-semibold">
                {success}
              </div>
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

        {/* Recent Check-ins */}
        <div className="bg-dark-card rounded-lg border border-gray-800">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-bold text-primary">Today's Check-Ins</h2>
          </div>
          
          {checkins.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No check-ins yet today
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {checkins.map((checkin) => (
                <div key={checkin.id} className="px-6 py-4 hover:bg-dark-lighter">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-100">{checkin.member.name}</p>
                      <p className="text-sm text-gray-400">{checkin.member.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-400">
                        {new Date(checkin.timestamp).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}