'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import HelpModal from './HelpModal'
import DemoBanner from './DemoBanner'

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
  const pathname = usePathname()
  const [gym, setGym] = useState<GymProfile | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)

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

  // Build nav links based on role
  const allNavLinks = [
    { href: '/dashboard', label: 'Dashboard', roles: ['owner', 'manager', 'front_desk'] },
    { href: '/members', label: 'Members', roles: ['owner', 'manager', 'front_desk'] },
    { href: '/prospects', label: 'Prospects', roles: ['owner', 'manager'] },
    { href: '/broadcast', label: 'Broadcast', roles: ['owner', 'manager'] },
    { href: '/checkin', label: 'Check In', roles: ['owner', 'manager', 'front_desk'] },
    { href: '/kiosk', label: 'Kiosk', roles: ['owner', 'manager', 'front_desk'] },
    { href: '/analytics', label: 'Analytics', roles: ['owner', 'manager'] },
    { href: '/invoices', label: 'Invoices', roles: ['owner', 'manager'] },
    { href: '/referrals', label: 'Referrals', roles: ['owner'] },
    { href: '/staff', label: 'Staff', roles: ['owner'] },
    { href: '/settings', label: 'Settings', roles: ['owner'] },
  ]

  const userRole = isStaff ? staffRole : 'owner'
  const navLinks = allNavLinks.filter((link) =>
    link.roles.includes(userRole || 'owner')
  )

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

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
                <span className="text-lg font-semibold text-gray-100 hidden sm:block">
                  {gym?.name || 'ClubCheck'}
                </span>
                {isDemo && (
                  <span className="hidden sm:inline-block bg-purple-500 text-white text-xs font-bold px-2 py-0.5 rounded ml-1">
                    DEMO
                  </span>
                )}
              </Link>
            </div>

            {/* Desktop Nav Links */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isActive(link.href)
                      ? 'bg-primary/20 text-primary'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-dark-lighter'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Right side: Help + Logout */}
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

              <button
                onClick={handleLogout}
                className="hidden sm:block text-gray-400 hover:text-red-400 px-3 py-2 rounded-lg text-sm font-medium hover:bg-dark-lighter transition"
              >
                {isDemo ? 'Exit Demo' : 'Logout'}
              </button>

              {/* Mobile menu button */}
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="md:hidden text-gray-400 hover:text-gray-100 p-2 rounded-lg hover:bg-dark-lighter transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {showMobileMenu ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {showMobileMenu && (
          <div className="md:hidden border-t border-gray-800 bg-dark-card">
            <div className="px-4 py-3 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setShowMobileMenu(false)}
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isActive(link.href)
                      ? 'bg-primary/20 text-primary'
                      : 'text-gray-400 hover:text-gray-100 hover:bg-dark-lighter'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={handleLogout}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-dark-lighter transition"
              >
                {isDemo ? 'Exit Demo' : 'Logout'}
              </button>
            </div>
          </div>
        )}
      </nav>

      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  )
}
