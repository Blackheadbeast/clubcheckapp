'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Logo from '@/components/Logo'
import QRCode from 'qrcode'

export default function SalesDemoPage() {
  const router = useRouter()
  const [demoUrl, setDemoUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const generateDemo = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/sales/demo', {
        method: 'POST',
        credentials: 'include',
      })

      if (!res.ok) {
        if (res.status === 401) {
          router.push('/sales/login')
          return
        }
        const data = await res.json()
        setError(data.error || 'Failed to generate demo')
        return
      }

      const data = await res.json()
      setDemoUrl(data.demoUrl)
      setExpiresAt(data.expiresAt)

      const qr = await QRCode.toDataURL(data.demoUrl, { width: 256, margin: 2 })
      setQrDataUrl(qr)
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(demoUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLogout = async () => {
    await fetch('/api/sales/logout', { method: 'POST', credentials: 'include' })
    router.push('/sales/login')
  }

  return (
    <div className="min-h-screen bg-theme">
      <header className="bg-theme-card border-b border-theme px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="md" />
            <h1 className="text-lg font-semibold text-theme-heading">Demo Sessions</h1>
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
        <div className="bg-theme-card rounded-lg border border-theme p-6">
          <h2 className="text-lg font-semibold text-theme-heading mb-2">Launch a Demo for Prospects</h2>
          <p className="text-theme-secondary text-sm mb-6">
            Generate a shareable demo link that gives gym owners a 1-hour read-only preview of ClubCheck with sample data.
            The demo will display a &quot;DEMO MODE&quot; banner.
          </p>

          <button
            onClick={generateDemo}
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate Demo Link'}
          </button>

          {error && (
            <div className="mt-4 bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {demoUrl && (
          <>
            <div className="bg-theme-card rounded-lg border border-theme p-6">
              <h2 className="text-lg font-semibold text-theme-heading mb-4">Demo Link Ready</h2>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  readOnly
                  value={demoUrl}
                  className="flex-1 px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg text-sm text-gray-300 font-mono truncate"
                />
                <button
                  onClick={copyLink}
                  className="px-4 py-2 bg-primary hover:bg-primary-dark text-black font-medium rounded-lg text-sm transition whitespace-nowrap"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-sm text-theme-secondary">
                Expires: {new Date(expiresAt).toLocaleString()}
              </p>
              <p className="text-xs text-yellow-400 mt-2">
                This link is single-use per browser session. Share it directly with the prospect.
              </p>
            </div>

            <div className="bg-theme-card rounded-lg border border-theme p-6 flex flex-col items-center">
              <h2 className="text-lg font-semibold text-theme-heading mb-4">QR Code</h2>
              {qrDataUrl && (
                <img src={qrDataUrl} alt="Demo QR Code" className="w-48 h-48 rounded-lg" />
              )}
              <p className="text-xs text-theme-secondary mt-3">Prospect can scan to open the demo</p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
