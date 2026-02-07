//app/login/page.tsx

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include', // Important for cookies
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      // Force a hard navigation to ensure cookies are recognized
      router.refresh()

      // Redirect to verification page if email not verified
      if (data.requiresVerification) {
        router.push('/verify-email')
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const handleDemoLogin = async () => {
    setError('')
    setDemoLoading(true)

    try {
      const res = await fetch('/api/demo/login', {
        method: 'POST',
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Demo login failed')
        setDemoLoading(false)
        return
      }

      router.refresh()
      router.push('/dashboard')
    } catch (err) {
      setError('Something went wrong. Please try again.')
      setDemoLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">ClubCheck</h1>
          <p className="text-gray-400">Log in to your gym</p>
        </div>

        <div className="bg-theme-card p-8 rounded-lg shadow-xl border border-theme">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                placeholder="you@gym.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || demoLoading}
              className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-theme-card text-gray-500">or</span>
            </div>
          </div>

          {/* Demo Button */}
          <button
            onClick={handleDemoLogin}
            disabled={loading || demoLoading}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold py-2.5 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {demoLoading ? (
              'Loading demo...'
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Try Demo
              </>
            )}
          </button>
          <p className="text-center text-gray-500 text-xs mt-2">
            Explore ClubCheck with sample data — no signup required
          </p>

          <div className="mt-6 text-center space-y-2">
            <p className="text-gray-400 text-sm">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-primary hover:text-primary-light">
                Sign up
              </Link>
            </p>
            <p className="text-gray-500 text-sm">
              Staff member?{' '}
              <Link href="/staff-login" className="text-primary hover:text-primary-light">
                Staff Login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
