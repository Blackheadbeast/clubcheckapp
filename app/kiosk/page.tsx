'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type KioskState = 'loading' | 'set-pin' | 'enter-pin' | 'active'

const KIOSK_STORAGE_KEY = 'clubcheck-kiosk-verified'
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

export default function KioskPage() {
  const router = useRouter()
  const [state, setState] = useState<KioskState>('loading')

  // PIN input
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)

  // Active kiosk state
  const [mode, setMode] = useState<'scanner' | 'manual'>('scanner')
  const [manualInput, setManualInput] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrRef = useRef<any>(null)

  // Check if PIN is verified in localStorage
  useEffect(() => {
    const stored = localStorage.getItem(KIOSK_STORAGE_KEY)
    if (stored) {
      const expiry = parseInt(stored, 10)
      if (Date.now() < expiry) {
        setState('active')
        return
      }
      localStorage.removeItem(KIOSK_STORAGE_KEY)
    }

    // Check if PIN exists
    fetch('/api/kiosk/pin', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setState(data.hasPin ? 'enter-pin' : 'set-pin')
      })
      .catch(() => router.push('/login'))
  }, [router])

  // Start QR scanner when active + scanner mode
  const startScanner = useCallback(async () => {
    if (!scannerRef.current || html5QrRef.current) return

    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('kiosk-scanner')
      html5QrRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleCheckin(decodedText, 'kiosk')
        },
        () => {} // ignore scan failures
      )
    } catch (err) {
      console.error('Scanner start error:', err)
      // Fall back to manual mode if camera isn't available
      setMode('manual')
    }
  }, [])

  const stopScanner = useCallback(async () => {
    if (html5QrRef.current) {
      try {
        await html5QrRef.current.stop()
      } catch {
        // ignore
      }
      html5QrRef.current = null
    }
  }, [])

  useEffect(() => {
    if (state === 'active' && mode === 'scanner') {
      startScanner()
    }
    return () => {
      stopScanner()
    }
  }, [state, mode, startScanner, stopScanner])

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault()
    setPinError('')

    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      setPinError('PIN must be 4–6 digits')
      return
    }
    if (pin !== confirmPin) {
      setPinError('PINs do not match')
      return
    }

    setPinLoading(true)
    try {
      const res = await fetch('/api/kiosk/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', pin }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setPinError(data.error || 'Failed to set PIN')
        return
      }
      // Auto-verify after setting
      localStorage.setItem(KIOSK_STORAGE_KEY, String(Date.now() + TWELVE_HOURS_MS))
      setState('active')
    } catch {
      setPinError('Something went wrong')
    } finally {
      setPinLoading(false)
    }
  }

  async function handleVerifyPin(e: React.FormEvent) {
    e.preventDefault()
    setPinError('')
    setPinLoading(true)

    try {
      const res = await fetch('/api/kiosk/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', pin }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setPinError(data.error || 'Invalid PIN')
        return
      }
      localStorage.setItem(KIOSK_STORAGE_KEY, String(Date.now() + TWELVE_HOURS_MS))
      setState('active')
    } catch {
      setPinError('Something went wrong')
    } finally {
      setPinLoading(false)
    }
  }

  async function handleCheckin(value: string, source: 'kiosk' | 'manual') {
    if (checking || !value.trim()) return
    setChecking(true)
    setFeedback(null)

    try {
      const isQr = value.startsWith('clubcheck-member-')
      const payload: Record<string, string> = {
        source: source,
      }
      if (isQr) {
        payload.qrCode = value
      } else {
        payload.phoneNumber = value
      }

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error || 'Check-in failed' })
      } else {
        setFeedback({ type: 'success', message: `${data.member.name} checked in!` })
        setManualInput('')
      }

      setTimeout(() => setFeedback(null), 4000)
    } catch {
      setFeedback({ type: 'error', message: 'Something went wrong' })
      setTimeout(() => setFeedback(null), 4000)
    } finally {
      setChecking(false)
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    handleCheckin(manualInput, 'manual')
  }

  function handleLock() {
    localStorage.removeItem(KIOSK_STORAGE_KEY)
    stopScanner()
    setPin('')
    setState('enter-pin')
  }

  // ---- LOADING ----
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme">
        <div className="text-primary text-xl">Loading kiosk...</div>
      </div>
    )
  }

  // ---- SET PIN (first time) ----
  if (state === 'set-pin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary">Kiosk Setup</h1>
            <p className="text-gray-400 mt-2">Set a 4–6 digit PIN to secure the kiosk</p>
          </div>
          <form onSubmit={handleSetPin} className="bg-theme-card p-6 rounded-lg border border-theme space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter PIN"
                autoFocus
                className="w-full px-4 py-3 bg-theme-lighter border border-gray-700 rounded-lg text-gray-100 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Confirm PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Confirm PIN"
                className="w-full px-4 py-3 bg-theme-lighter border border-gray-700 rounded-lg text-gray-100 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-primary"
              />
            </div>
            {pinError && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">{pinError}</div>
            )}
            <button
              type="submit"
              disabled={pinLoading || pin.length < 4}
              className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {pinLoading ? 'Setting...' : 'Set PIN & Start Kiosk'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ---- ENTER PIN ----
  if (state === 'enter-pin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary">ClubCheck Kiosk</h1>
            <p className="text-gray-400 mt-2">Enter your kiosk PIN to unlock</p>
          </div>
          <form onSubmit={handleVerifyPin} className="bg-theme-card p-6 rounded-lg border border-theme space-y-4">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN"
              autoFocus
              className="w-full px-4 py-4 bg-theme-lighter border border-gray-700 rounded-lg text-gray-100 text-center text-3xl tracking-[0.5em] focus:outline-none focus:border-primary"
            />
            {pinError && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">{pinError}</div>
            )}
            <button
              type="submit"
              disabled={pinLoading || pin.length < 4}
              className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 rounded-lg transition disabled:opacity-50 text-lg"
            >
              {pinLoading ? 'Verifying...' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ---- ACTIVE KIOSK ----
  return (
    <div className="min-h-screen bg-theme flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-theme">
        <h1 className="text-2xl font-bold text-primary">ClubCheck Kiosk</h1>
        <button
          onClick={handleLock}
          className="text-gray-400 hover:text-gray-200 text-sm border border-gray-700 px-3 py-1.5 rounded-lg transition"
        >
          Lock Kiosk
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {/* Feedback banner */}
        {feedback && (
          <div
            className={`w-full max-w-md mb-6 px-6 py-4 rounded-lg text-center text-lg font-semibold ${
              feedback.type === 'success'
                ? 'bg-green-900/30 border border-green-700 text-green-400'
                : 'bg-red-900/30 border border-red-700 text-red-400'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Mode tabs */}
        <div className="w-full max-w-md mb-6">
          <div className="flex gap-2 bg-theme-lighter p-1 rounded-lg">
            <button
              onClick={() => setMode('scanner')}
              className={`flex-1 py-3 rounded-lg font-semibold transition ${
                mode === 'scanner' ? 'bg-primary text-black' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Scan QR
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`flex-1 py-3 rounded-lg font-semibold transition ${
                mode === 'manual' ? 'bg-primary text-black' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Manual Entry
            </button>
          </div>
        </div>

        {/* Scanner mode */}
        {mode === 'scanner' && (
          <div className="w-full max-w-md">
            <div className="bg-theme-card rounded-lg border border-theme overflow-hidden">
              <div
                id="kiosk-scanner"
                ref={scannerRef}
                className="w-full"
                style={{ minHeight: 300 }}
              />
            </div>
            <p className="text-gray-500 text-sm text-center mt-4">
              Point the camera at a member&apos;s QR code
            </p>
          </div>
        )}

        {/* Manual mode */}
        {mode === 'manual' && (
          <div className="w-full max-w-md">
            <form onSubmit={handleManualSubmit} className="bg-theme-card p-6 rounded-lg border border-theme space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Phone Number or QR Code
                </label>
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Enter phone number or scan QR..."
                  autoFocus
                  className="w-full px-4 py-4 bg-theme-lighter border border-gray-700 rounded-lg text-gray-100 text-lg focus:outline-none focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={checking || !manualInput.trim()}
                className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-4 rounded-lg transition disabled:opacity-50 text-lg"
              >
                {checking ? 'Checking in...' : 'Check In'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
