'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'

interface SetupStep {
  id: string
  title: string
  description: string
  link: string
  linkText: string
  icon: React.ReactNode
  tips: string[]
}

interface SetupProgress {
  gymName: boolean
  firstMember: boolean
  kioskPin: boolean
  firstCheckin: boolean
}

export default function SetupGuidePage() {
  const router = useRouter()
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProgress() {
      try {
        const res = await fetch('/api/dashboard', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const data = await res.json()
        setProgress(data.setupProgress)
      } catch {
        console.error('Failed to load progress')
      } finally {
        setLoading(false)
      }
    }
    loadProgress()
  }, [router])

  const steps: SetupStep[] = [
    {
      id: 'gymName',
      title: 'Set Up Your Gym Profile',
      description: 'Add your gym name, logo, and address. This branding appears on member emails and the kiosk.',
      link: '/settings',
      linkText: 'Go to Settings',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      tips: [
        'Use a square logo (200x200px recommended) for best display',
        'Include your full address for member communications',
        'Your gym name will appear in all emails to members',
      ],
    },
    {
      id: 'firstMember',
      title: 'Add Your First Member',
      description: 'Create member profiles with email and phone. Each member gets a unique QR code for check-ins.',
      link: '/members',
      linkText: 'Go to Members',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      ),
      tips: [
        'Members receive their QR code via email automatically',
        'You can also manually send QR codes from the member detail page',
        'Use the bulk import feature for adding many members at once',
      ],
    },
    {
      id: 'kioskPin',
      title: 'Set Up Your Kiosk',
      description: 'Create a PIN code for kiosk mode. Use any tablet or computer as a self-service check-in station.',
      link: '/kiosk',
      linkText: 'Set Up Kiosk',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      tips: [
        'Use a 4-6 digit PIN that staff can remember',
        'Kiosk mode locks the screen to just the check-in interface',
        'Works great on iPads, Android tablets, or any web browser',
      ],
    },
    {
      id: 'firstCheckin',
      title: 'Complete Your First Check-In',
      description: 'Test the system by checking in a member using their QR code or phone number.',
      link: '/checkin',
      linkText: 'Go to Check-In',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tips: [
        'Scan the QR code or enter the member\'s phone number',
        'Check-ins are logged with timestamp and method',
        'View all check-ins on the dashboard and analytics pages',
      ],
    },
  ]

  const completedCount = progress
    ? Object.values(progress).filter(Boolean).length
    : 0

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">Setup Guide</h1>
          <p className="text-gray-400">
            Follow these steps to get your gym up and running with ClubCheck.
          </p>
        </div>

        {/* Progress Overview */}
        <div className="bg-dark-card p-6 rounded-lg border border-gray-800 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-100">Your Progress</h2>
            <span className="text-primary font-medium">{completedCount} of {steps.length} complete</span>
          </div>
          <div className="w-full bg-dark-lighter rounded-full h-3">
            <div
              className="bg-gradient-to-r from-primary to-primary-dark h-3 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
          {completedCount === steps.length && (
            <div className="mt-4 p-4 bg-green-900/20 border border-green-800 rounded-lg">
              <p className="text-green-400 font-medium flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Setup complete! Your gym is ready to go.
              </p>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="space-y-6">
          {steps.map((step, index) => {
            const isComplete = progress?.[step.id as keyof SetupProgress] ?? false

            return (
              <div
                key={step.id}
                className={`bg-dark-card rounded-lg border ${
                  isComplete ? 'border-green-800' : 'border-gray-800'
                } overflow-hidden`}
              >
                <div className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Step Number / Check */}
                    <div
                      className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                        isComplete
                          ? 'bg-green-900/30 text-green-400'
                          : 'bg-primary/20 text-primary'
                      }`}
                    >
                      {isComplete ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className="font-bold">{index + 1}</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={isComplete ? 'text-green-400' : 'text-primary'}>
                          {step.icon}
                        </div>
                        <h3 className={`text-lg font-semibold ${isComplete ? 'text-green-400' : 'text-gray-100'}`}>
                          {step.title}
                        </h3>
                        {isComplete && (
                          <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded">
                            Complete
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 mb-4">{step.description}</p>

                      {/* Tips */}
                      <div className="bg-dark-lighter rounded-lg p-4 mb-4">
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Tips:</h4>
                        <ul className="space-y-1">
                          {step.tips.map((tip, tipIndex) => (
                            <li key={tipIndex} className="text-sm text-gray-500 flex items-start gap-2">
                              <span className="text-primary mt-1">•</span>
                              {tip}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Action Button */}
                      <Link
                        href={step.link}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
                          isComplete
                            ? 'bg-dark-lighter text-gray-400 hover:text-gray-100'
                            : 'bg-primary text-black hover:bg-primary-dark'
                        }`}
                      >
                        {step.linkText}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Additional Resources */}
        <div className="mt-12 bg-dark-card p-6 rounded-lg border border-gray-800">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">Additional Features</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Link
              href="/prospects"
              className="p-4 bg-dark-lighter rounded-lg border border-gray-700 hover:border-primary transition group"
            >
              <h3 className="font-medium text-gray-100 group-hover:text-primary mb-1">
                Lead Management
              </h3>
              <p className="text-sm text-gray-500">
                Track prospects and convert them to members
              </p>
            </Link>

            <Link
              href="/broadcast"
              className="p-4 bg-dark-lighter rounded-lg border border-gray-700 hover:border-primary transition group"
            >
              <h3 className="font-medium text-gray-100 group-hover:text-primary mb-1">
                Broadcast Emails
              </h3>
              <p className="text-sm text-gray-500">
                Send announcements to all members at once
              </p>
            </Link>

            <Link
              href="/settings"
              className="p-4 bg-dark-lighter rounded-lg border border-gray-700 hover:border-primary transition group"
            >
              <h3 className="font-medium text-gray-100 group-hover:text-primary mb-1">
                Digital Waivers
              </h3>
              <p className="text-sm text-gray-500">
                Require members to sign liability waivers
              </p>
            </Link>

            <Link
              href="/staff"
              className="p-4 bg-dark-lighter rounded-lg border border-gray-700 hover:border-primary transition group"
            >
              <h3 className="font-medium text-gray-100 group-hover:text-primary mb-1">
                Staff Accounts
              </h3>
              <p className="text-sm text-gray-500">
                Add staff with role-based permissions
              </p>
            </Link>
          </div>
        </div>

        {/* Help Section */}
        <div className="mt-8 text-center">
          <p className="text-gray-500">
            Need help? Check the{' '}
            <button
              onClick={() => {
                // Trigger help modal from navbar if available
                const helpBtn = document.querySelector('[title="Help"]') as HTMLButtonElement
                helpBtn?.click()
              }}
              className="text-primary hover:text-primary-light"
            >
              Help section
            </button>
            {' '}or contact us at{' '}
            <a href="mailto:support@clubcheckapp.com" className="text-primary hover:text-primary-light">
              support@clubcheckapp.com
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
