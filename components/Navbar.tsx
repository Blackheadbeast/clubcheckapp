'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import HelpModal from './HelpModal'
import DemoBanner from './DemoBanner'
import NavigationDrawer from './NavigationDrawer'

interface GymProfile {
  name: string
  logoUrl: string
}

interface SettingsData {
  owner: {
    id: string
  }
  gym: GymProfile
  isStaff?: boolean
  staffRole?: string
  staffName?: string
}

const DEMO_OWNER_ID = 'demo-owner-00000000-0000-0000-0000'

export default function Navbar() {
  const [gym, setGym] = useState<GymProfile | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)

  useEffect(() => {
    async function loadGymProfile() {
      try {
        const res = await fetch('/api/settings', { credentials: 'include' })
        if (res.ok) {
          const data: SettingsData = await res.json()
          setGym(data.gym)
          setIsDemo(data.owner.id === DEMO_OWNER_ID)
          setIsStaff(data.isStaff || false)
          setStaffRole(data.staffRole || null)
        }
      } catch {
        // Silently fail - navbar will show default branding
      }
    }
    loadGymProfile()
  }, [])

  const userRole = isStaff ? (staffRole || 'front_desk') : 'owner'

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    window.location.href = '/login'
  }

  return (
    <>
      {isDemo && <DemoBanner />}

      <nav className="bg-dark-card border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo / Gym Name */}
            <div className="flex items-center">
              <Link href="/dashboard" className="flex items-center gap-3">
                {gym?.logoUrl ? (
                  <img
                    src={gym.logoUrl}
                    alt={gym.name || 'Gym logo'}
                    className="h-8 w-8 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 bg-gradient-to-br from-primary to-primary-dark rounded-lg flex items-center justify-center">
                    <span className="text-black font-bold text-lg">C</span>
                  </div>
                )}
                <span className="text-lg font-semibold text-gray-100">
                  {gym?.name || 'ClubCheck'}
                </span>
                {isDemo && (
                  <span className="bg-purple-500 text-white text-xs font-bold px-2 py-0.5 rounded ml-1">
                    DEMO
                  </span>
                )}
              </Link>
            </div>

            {/* Right side: Help + Hamburger */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHelp(true)}
                className="text-gray-400 hover:text-gray-100 p-2 rounded-lg hover:bg-dark-lighter transition"
                title="Help"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>

              {/* Hamburger menu button */}
              <button
                onClick={() => setShowDrawer(true)}
                className="text-gray-400 hover:text-gray-100 p-2 rounded-lg hover:bg-dark-lighter transition"
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Navigation Drawer */}
      <NavigationDrawer
        isOpen={showDrawer}
        onClose={() => setShowDrawer(false)}
        gymName={gym?.name || 'ClubCheck'}
        gymLogo={gym?.logoUrl || null}
        isDemo={isDemo}
        userRole={userRole}
        onLogout={handleLogout}
      />

      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  )
}
