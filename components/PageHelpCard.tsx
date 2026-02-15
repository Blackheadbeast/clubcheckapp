'use client'

import { useState, useEffect } from 'react'

const HELP_CONTENT: Record<string, { title: string; steps: string[] }> = {
  dashboard: {
    title: 'Dashboard',
    steps: [
      'View key metrics like active members, check-ins today, and estimated revenue.',
      'Check your billing status and member count at the top.',
      'Use the quick action cards to jump to Members, Check-in, or Broadcast.',
    ],
  },
  members: {
    title: 'Members',
    steps: [
      'Click "Add Member" to create a new member — they\'ll get a unique QR code.',
      'Use the search bar or status filters to find members quickly.',
      'Click a member\'s name to edit their info, send their QR code, or record a payment.',
      'Use bulk actions (select multiple) to activate, deactivate, or email members.',
    ],
  },
  checkin: {
    title: 'Check-in',
    steps: [
      'Use the "QR Scan" tab to scan a member\'s QR code for instant check-in.',
      'Use the "Phone" tab to look up a member by phone number.',
      'View today\'s check-in history below with timestamps and member names.',
      'Filter by date range to review past check-in activity.',
    ],
  },
  kiosk: {
    title: 'Kiosk Mode',
    steps: [
      'Set a 4-digit PIN in Settings to protect kiosk access.',
      'Place a tablet at your front desk and open this page for self-service check-ins.',
      'Members can scan their QR code or enter their phone number to check in.',
      'The screen auto-resets after each check-in for the next member.',
    ],
  },
  prospects: {
    title: 'Prospects',
    steps: [
      'Click "Add Prospect" to track a potential new member (name, email, source).',
      'Update status as they progress: New, Contacted, Toured, Converted, or Lost.',
      'Click "Convert" on a prospect to create them as a full member automatically.',
      'Use the status tabs at the top to filter your pipeline.',
    ],
  },
  broadcast: {
    title: 'Broadcast',
    steps: [
      'Choose a target group: all members, active only, inactive, or overdue.',
      'Write a subject and message body for your email blast.',
      'Preview your message before sending to make sure it looks right.',
      'Broadcasts are sent via email to all members in the selected group.',
    ],
  },
  analytics: {
    title: 'Analytics',
    steps: [
      'View check-in trends, revenue charts, and member growth over time.',
      'Use the date range selector to zoom into a specific period.',
      'Compare metrics across days, weeks, or months with the chart controls.',
      'Track peak check-in hours to optimize staffing and classes.',
    ],
  },
  invoices: {
    title: 'Invoices',
    steps: [
      'View all Stripe invoices with status (paid, open, overdue).',
      'Click an invoice to open it on Stripe or download the PDF.',
      'Invoices sync automatically from Stripe — no manual entry needed.',
      'Use the search/filter to find invoices by date or amount.',
    ],
  },
  referrals: {
    title: 'Referrals',
    steps: [
      'Share your unique referral code with other gym owners.',
      'When someone signs up with your code, you both benefit.',
      'Track your referrals and earned credits on this page.',
      'Copy your referral link with one click to share via email or social media.',
    ],
  },
  staff: {
    title: 'Staff',
    steps: [
      'Click "Add Staff" to create a staff login with name, email, and password.',
      'Assign a role: Manager (most features) or Front Desk (check-in & view only).',
      'Share the Gym Code shown on this page — staff need it to log in at /staff-login.',
      'Deactivate staff members anytime to revoke their access.',
    ],
  },
  settings: {
    title: 'Settings',
    steps: [
      'Update your gym name, address, and logo in the Gym Info tab.',
      'Set a Kiosk PIN to enable self-service check-in mode.',
      'Configure waivers in the Waiver tab — members can sign digitally.',
      'Switch theme (Light, Dark, Auto) in the Appearance tab.',
    ],
  },
  billing: {
    title: 'Billing',
    steps: [
      'Choose between Starter (75 members) and Pro (150 members) plans.',
      'Toggle between monthly and yearly billing — save ~$200/year with annual.',
      'Click "Subscribe" to start your paid plan via Stripe Checkout.',
      'Manage your existing subscription or update payment info from this page.',
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3">
      <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
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
              <h3 className="text-sm font-semibold text-primary mb-1.5">
                How to use: {content.title}
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
