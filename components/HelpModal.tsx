'use client'

import { useState } from 'react'

interface HelpModalProps {
  isOpen: boolean
  onClose: () => void
}

const faqs = [
  {
    question: 'How do I add a new member?',
    answer:
      'Go to the Members page and click "Add Member". Fill in their name, email, and phone number. They\'ll automatically get a QR code for check-ins.',
  },
  {
    question: 'How does the kiosk mode work?',
    answer:
      'Kiosk mode lets members check themselves in using their QR code or phone number. Set a PIN in Settings, then access /kiosk on a tablet at your front desk.',
  },
  {
    question: 'How do I send QR codes to members?',
    answer:
      'On the Members page, click on a member to view their profile. You can download their QR code or send it directly to their email.',
  },
  {
    question: 'What do the member statuses mean?',
    answer:
      'Active = can check in. Inactive = membership on hold. Paused = temporary pause. Overdue = payment past due.',
  },
  {
    question: 'How do I export my data?',
    answer:
      'You can export members and check-ins as CSV files. Look for the "Export" button on the Members page or the Check-in history page.',
  },
  {
    question: 'How do I change my subscription plan?',
    answer:
      'Go to the Dashboard and scroll to the plan cards. Click "Upgrade to Pro" or "Downgrade to Starter" to change your plan.',
  },
]

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg bg-theme-card rounded-xl border border-theme shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-theme">
            <h2 className="text-xl font-semibold text-gray-100">Help & FAQ</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-100 p-1 rounded-lg hover:bg-theme-lighter transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* FAQ List */}
          <div className="px-6 py-4 max-h-96 overflow-y-auto">
            <div className="space-y-2">
              {faqs.map((faq, index) => (
                <div key={index} className="border border-theme rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-theme-lighter transition"
                  >
                    <span className="text-gray-100 font-medium text-sm">{faq.question}</span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${
                        expandedIndex === index ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {expandedIndex === index && (
                    <div className="px-4 pb-3">
                      <p className="text-gray-400 text-sm">{faq.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-theme bg-theme-lighter rounded-b-xl">
            <p className="text-gray-400 text-sm mb-3">Still need help?</p>
            <a
              href="mailto:support@clubcheckapp.com?subject=ClubCheck Support Request"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg transition text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
