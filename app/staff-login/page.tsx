'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function StaffLoginPage() {
  const router = useRouter()
  const [gymCode, setGymCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/staff-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gymCode, email, password }),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-theme flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex flex-col items-center gap-3">
            <div className="h-16 w-16 bg-gradient-to-br from-primary to-primary-dark rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
              <span className="text-black font-bold text-3xl">C</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">ClubCheck</span>
          </Link>
          <h1 className="text-2xl font-bold text-theme-heading mt-4">Staff Login</h1>
          <p className="text-theme-secondary mt-2">Sign in to your staff account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-theme-card p-8 rounded-lg border border-theme">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Gym Code
              </label>
              <input
                type="text"
                value={gymCode}
                onChange={(e) => setGymCode(e.target.value)}
                required
                placeholder="Enter your gym's code"
                className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
              />
              <p className="text-gray-500 text-xs mt-1">
                Ask your gym owner for this code
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 bg-red-900/20 border border-red-900 text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-gray-400 text-sm">
            Are you a gym owner?{' '}
            <Link href="/login" className="text-primary hover:text-primary-light">
              Owner Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
