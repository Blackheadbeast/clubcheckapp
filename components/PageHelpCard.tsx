'use client'

import { useState, useEffect } from 'react'

// One entry per page that shows this card. Keep each one true to what the page does today.
const HELP_CONTENT: Record<string, { title: string; steps: string[] }> = {
  kiosk: {
    title: 'Kiosk mode',
    steps: [
      'Set a 4 to 6 digit PIN the first time you open this page. It keeps the kiosk locked to check-in.',
      'Leave a tablet on this page at the front desk so members can check themselves in.',
      'Members scan their QR code with the camera, or type their phone number.',
      'The screen clears itself after each check-in, ready for the next person.',
    ],
  },
  invoices: {
    title: 'ClubCheck invoices',
    steps: [
      'These are the invoices for your own ClubCheck subscription, not your members\' invoices.',
      'Use View to open an invoice, or PDF to download it for your records.',
      'Invoices for memberships and sales you charge your members are under Billing, then Invoices.',
    ],
  },
  referrals: {
    title: 'Referrals',
    steps: [
      'Copy your referral link and share it with another gym owner.',
      'When they sign up with your link and become a paying customer, you earn one free month.',
      'Everyone you have referred, and the credit you have earned, is listed below.',
    ],
  },
  settings: {
    title: 'Business settings',
    steps: [
      'Gym Info holds your gym\'s name, address and logo. Account is your own sign-in.',
      'Waiver turns the sign-up waiver on and sets its wording. Appearance switches light, dark or automatic.',
      'Booking rules, member payments, texting, online booking and API keys each have their own page in the tabs above.',
      'Waivers and agreements that need a signature are managed under Documents.',
    ],
  },
  billing: {
    title: 'Your ClubCheck plan',
    steps: [
      'This page is about what your gym pays ClubCheck. What members pay you is under Billing.',
      'Pick Starter (up to 75 members) or Pro (up to 150), billed monthly or yearly.',
      'Subscribing and changing your card both happen on Stripe\'s secure checkout.',
      'Past invoices are under Invoice History at the bottom.',
    ],
  },
}

interface PageHelpCardProps {
  pageKey: string
}

export default function PageHelpCard({ pageKey }: PageHelpCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)

  const content = HELP_CONTENT[pageKey]

  useEffect(() => {
    const dismissed = localStorage.getItem(`help-dismissed-${pageKey}`)
    setExpanded(dismissed !== 'true')
    setMounted(true)
  }, [pageKey])

  if (!content || !mounted) return null

  const handleDismiss = () => {
    setExpanded(false)
    localStorage.setItem(`help-dismissed-${pageKey}`, 'true')
  }

  const handleExpand = () => {
    setExpanded(true)
    localStorage.removeItem(`help-dismissed-${pageKey}`)
  }

  if (!expanded) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-8">
        <button
          onClick={handleExpand}
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary bg-theme-card border border-theme rounded-lg px-3 py-1.5 transition hover:border-primary/40"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          How to use this
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <svg
              className="w-5 h-5 text-primary mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg-heading mb-1.5">
                {content.title}
              </h3>
              <ul className="space-y-1">
                {content.steps.map((step, i) => (
                  <li key={i} className="text-xs text-theme-secondary flex items-start gap-2">
                    <span className="text-primary/60 font-medium mt-px flex-shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-500 hover:text-gray-300 p-1 flex-shrink-0 rounded hover:bg-theme-lighter transition"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
