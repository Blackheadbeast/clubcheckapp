'use client'

import Link from 'next/link'

interface SetupProgress {
  gymName: boolean
  firstMember: boolean
  kioskPin: boolean
  firstCheckin: boolean
  dismissed: boolean
  isDemo: boolean
}

interface SetupWizardProps {
  progress: SetupProgress
  onDismiss: () => void
}

const steps = [
  {
    id: 'gymName',
    title: 'Add your gym name',
    description: 'Brand your ClubCheck dashboard',
    href: '/settings',
    cta: 'Go to Settings',
  },
  {
    id: 'firstMember',
    title: 'Add your first member',
    description: 'Start building your member database',
    href: '/members',
    cta: 'Add Member',
  },
  {
    id: 'kioskPin',
    title: 'Set up kiosk PIN',
    description: 'Secure your check-in kiosk',
    href: '/kiosk',
    cta: 'Setup Kiosk',
  },
  {
    id: 'firstCheckin',
    title: 'Complete first check-in',
    description: 'Test the check-in flow',
    href: '/checkin',
    cta: 'Try Check-in',
  },
]

export default function SetupWizard({ progress, onDismiss }: SetupWizardProps) {
  // Don't show for demo accounts or if dismissed
  if (progress.isDemo || progress.dismissed) {
    return null
  }

  const completedCount = steps.filter((step) => progress[step.id as keyof SetupProgress]).length
  const allComplete = completedCount === steps.length

  // Don't show if all steps complete
  if (allComplete) {
    return null
  }

  const progressPercent = Math.round((completedCount / steps.length) * 100)

  return (
    <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/30 rounded-xl p-6 mb-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
            <span className="text-2xl">🚀</span>
            Get Started with ClubCheck
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Complete these steps to set up your gym
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-500 hover:text-gray-300 text-sm px-3 py-1 rounded-lg hover:bg-theme-lighter transition"
        >
          Dismiss
        </button>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-400">Progress</span>
          <span className="text-primary font-medium">{completedCount} of {steps.length} complete</span>
        </div>
        <div className="h-2 bg-theme-lighter rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary-light transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {steps.map((step) => {
          const isComplete = progress[step.id as keyof SetupProgress]

          return (
            <div
              key={step.id}
              className={`flex items-center gap-4 p-4 rounded-lg border transition ${
                isComplete
                  ? 'bg-green-900/10 border-green-800/50'
                  : 'bg-theme-card border-theme hover:border-gray-700'
              }`}
            >
              {/* Checkbox */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isComplete
                    ? 'bg-green-600 text-white'
                    : 'bg-theme-lighter border-2 border-gray-600'
                }`}
              >
                {isComplete ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-gray-500 text-sm font-medium">
                    {steps.indexOf(step) + 1}
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3
                  className={`font-medium ${
                    isComplete ? 'text-green-400 line-through' : 'text-gray-100'
                  }`}
                >
                  {step.title}
                </h3>
                <p className="text-gray-500 text-sm truncate">{step.description}</p>
              </div>

              {/* Action */}
              {!isComplete && (
                <Link
                  href={step.href}
                  className="shrink-0 bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium px-4 py-2 rounded-lg transition"
                >
                  {step.cta}
                </Link>
              )}
            </div>
          )
        })}
      </div>

      {/* Full Guide Link */}
      <div className="mt-4 pt-4 border-t border-primary/20 text-center">
        <Link
          href="/setup-guide"
          className="text-sm text-gray-400 hover:text-primary transition inline-flex items-center gap-1"
        >
          View full setup guide with tips
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
