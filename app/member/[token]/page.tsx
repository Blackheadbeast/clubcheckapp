'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode'

interface MemberData {
  member: {
    id: string
    name: string
    email: string
    phone: string | null
    qrCode: string
    status: string
    createdAt: string
    lastCheckInAt: string | null
    currentStreak: number
    longestStreak: number
    waiverSigned: boolean
  }
  gym: {
    name: string
    logoUrl: string | null
  }
  recentCheckins: {
    id: string
    timestamp: string
    source: string | null
  }[]
  badge: {
    name: string
    icon: string
    level: string
  } | null
}

export default function MemberPortalPage() {
  const params = useParams()
  const [data, setData] = useState<MemberData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'qr' | 'history' | 'profile'>('qr')

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch(`/api/member-portal?token=${params.token}`)
        if (!res.ok) {
          const err = await res.json()
          setError(err.error || 'Failed to load portal')
          setLoading(false)
          return
        }

        const json = await res.json()
        setData(json)

        // Generate QR code
        const qr = await QRCode.toDataURL(json.member.qrCode, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        })
        setQrDataUrl(qr)
      } catch {
        setError('Something went wrong')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [params.token])

  if (loading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center p-4">
        <div className="bg-dark-card border border-gray-800 rounded-xl p-8 text-center max-w-md">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-100 mb-2">Access Denied</h1>
          <p className="text-gray-400">{error || 'Invalid or expired link'}</p>
        </div>
      </div>
    )
  }

  const { member, gym, recentCheckins, badge } = data

  return (
    <div className="min-h-screen bg-dark">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/20 to-transparent pb-8">
        <div className="max-w-lg mx-auto px-4 pt-6">
          <div className="text-center">
            {gym.logoUrl ? (
              <img src={gym.logoUrl} alt={gym.name} className="w-16 h-16 mx-auto rounded-xl mb-4" />
            ) : (
              <div className="w-16 h-16 mx-auto rounded-xl bg-primary/20 flex items-center justify-center mb-4">
                <span className="text-2xl font-bold text-primary">{gym.name[0]}</span>
              </div>
            )}
            <h1 className="text-xl font-bold text-gray-100">{gym.name}</h1>
            <p className="text-gray-400 mt-1">Member Portal</p>
          </div>

          {/* Member Card */}
          <div className="mt-6 bg-dark-card border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">{member.name[0]}</span>
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-gray-100">{member.name}</h2>
                <p className="text-gray-500 text-sm">{member.email}</p>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                member.status === 'active' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
              }`}>
                {member.status}
              </div>
            </div>

            {/* Streak Stats */}
            <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{member.currentStreak}</div>
                <div className="text-gray-500 text-xs">Current Streak</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-100">{member.longestStreak}</div>
                <div className="text-gray-500 text-xs">Best Streak</div>
              </div>
            </div>

            {/* Badge */}
            {badge && (
              <div className="mt-4 p-3 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/30">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    badge.level === 'gold' ? 'bg-yellow-500' :
                    badge.level === 'silver' ? 'bg-gray-400' : 'bg-orange-600'
                  }`}>
                    {badge.icon === 'trophy' && (
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M5 3h14v2h-2v2c0 2.76-2.24 5-5 5s-5-2.24-5-5V5H5V3zm7 12c3.31 0 6-2.69 6-6V5H6v4c0 3.31 2.69 6 6 6zm-3 2h6v2H9v-2zm-1 4h8v2H8v-2z"/>
                      </svg>
                    )}
                    {badge.icon === 'star' && (
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                    )}
                    {badge.icon === 'fire' && (
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 23a7.5 7.5 0 01-5.138-12.963C8.204 8.774 11.5 6.5 11 1.5c6 4 9 8 3 14 1 0 2.5 0 5-2.47.27.773.5 1.604.5 2.47A7.5 7.5 0 0112 23z"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-primary">{badge.name}</div>
                    <div className="text-gray-500 text-xs">{member.longestStreak} day streak achieved!</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4">
        <div className="flex gap-2 mb-6">
          {(['qr', 'history', 'profile'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition ${
                activeTab === tab
                  ? 'bg-primary text-black'
                  : 'bg-dark-card text-gray-400 hover:text-gray-100'
              }`}
            >
              {tab === 'qr' && 'QR Code'}
              {tab === 'history' && 'History'}
              {tab === 'profile' && 'Profile'}
            </button>
          ))}
        </div>

        {/* QR Tab */}
        {activeTab === 'qr' && (
          <div className="bg-dark-card border border-gray-800 rounded-xl p-6 text-center">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Your Check-in QR Code</h3>
            {qrDataUrl && (
              <div className="inline-block bg-white p-4 rounded-xl">
                <img src={qrDataUrl} alt="QR Code" className="w-64 h-64" />
              </div>
            )}
            <p className="text-gray-500 text-sm mt-4">
              Show this code at the front desk to check in
            </p>
            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download="my-qr-code.png"
                className="inline-flex items-center gap-2 mt-4 bg-primary hover:bg-primary-dark text-black font-medium py-2 px-4 rounded-lg transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download QR Code
              </a>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="bg-dark-card border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Recent Check-ins</h3>
            {recentCheckins.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No check-ins yet</p>
            ) : (
              <div className="space-y-3">
                {recentCheckins.map((checkin) => (
                  <div
                    key={checkin.id}
                    className="flex items-center justify-between py-3 border-b border-gray-800 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-600/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-gray-100 font-medium">
                          {new Date(checkin.timestamp).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                        <div className="text-gray-500 text-sm">
                          {new Date(checkin.timestamp).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="text-gray-500 text-sm capitalize">
                      {checkin.source || 'check-in'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="bg-dark-card border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Your Profile</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
                <div className="text-gray-100">{member.name}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
                <div className="text-gray-100">{member.email}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Phone</label>
                <div className="text-gray-100">{member.phone || 'Not set'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Member Since</label>
                <div className="text-gray-100">
                  {new Date(member.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Waiver Status</label>
                <div className={`inline-flex items-center gap-2 ${member.waiverSigned ? 'text-green-400' : 'text-yellow-400'}`}>
                  {member.waiverSigned ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Signed
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Not signed
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-8">
          <p className="text-gray-600 text-sm">
            Powered by <span className="text-primary font-medium">ClubCheck</span>
          </p>
        </div>
      </div>
    </div>
  )
}
