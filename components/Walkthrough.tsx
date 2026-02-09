'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'

interface WalkthroughStep {
  target: string // CSS selector for the element to highlight
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
}

const walkthroughSteps: WalkthroughStep[] = [
  {
    target: '[data-walkthrough="nav-menu"]',
    title: 'Navigation Menu',
    description: 'Access all features from here - members, check-ins, analytics, billing, and settings.',
    position: 'left',
  },
  {
    target: '[data-walkthrough="stats-cards"]',
    title: 'Dashboard Overview',
    description: 'See your gym\'s key metrics at a glance - active members, check-ins today, and revenue.',
    position: 'bottom',
  },
  {
    target: '[data-walkthrough="quick-actions"]',
    title: 'Quick Actions',
    description: 'Quickly add new members, record check-ins, or send broadcasts to your members.',
    position: 'top',
  },
  {
    target: '[data-walkthrough="members-link"]',
    title: 'Member Management',
    description: 'Add, edit, and manage your gym members. Each member gets a unique QR code for easy check-ins.',
    position: 'bottom',
  },
  {
    target: '[data-walkthrough="checkin-link"]',
    title: 'Check-In System',
    description: 'Record member check-ins via QR scan, phone lookup, or manual entry. Track attendance streaks!',
    position: 'bottom',
  },
  {
    target: '[data-walkthrough="help-button"]',
    title: 'Need Help?',
    description: 'Click here anytime for quick tips and support options. We\'re here to help you succeed!',
    position: 'left',
  },
]

interface WalkthroughProps {
  isOpen: boolean
  onComplete: () => void
  onSkip: () => void
  isDemo?: boolean
}

export default function Walkthrough({ isOpen, onComplete, onSkip, isDemo }: WalkthroughProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [mounted, setMounted] = useState(false)

  const step = walkthroughSteps[currentStep]

  const updateTargetPosition = useCallback(() => {
    if (!step) return
    const element = document.querySelector(step.target)
    if (element) {
      setTargetRect(element.getBoundingClientRect())
    } else {
      setTargetRect(null)
    }
  }, [step])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updateTargetPosition()

    // Update position on scroll/resize
    window.addEventListener('scroll', updateTargetPosition, true)
    window.addEventListener('resize', updateTargetPosition)

    return () => {
      window.removeEventListener('scroll', updateTargetPosition, true)
      window.removeEventListener('resize', updateTargetPosition)
    }
  }, [isOpen, currentStep, updateTargetPosition])

  const handleNext = () => {
    if (currentStep < walkthroughSteps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      onComplete()
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    onSkip()
  }

  if (!isOpen || !mounted) return null

  const getTooltipPosition = (): { top: string; left: string; transform: string; actualPosition: string } => {
    if (!targetRect) {
      // Center of screen if no target found
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        actualPosition: 'center',
      }
    }

    const padding = 20
    const tooltipWidth = 320
    const tooltipHeight = 260 // Approximate height
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Helper to clamp left position within viewport
    const clampLeft = (left: number) => {
      return Math.max(padding, Math.min(left, viewportWidth - tooltipWidth - padding))
    }

    // Helper to clamp top position within viewport
    const clampTop = (top: number) => {
      return Math.max(padding, Math.min(top, viewportHeight - tooltipHeight - padding))
    }

    // Calculate available space in each direction
    const spaceTop = targetRect.top
    const spaceBottom = viewportHeight - targetRect.bottom
    const spaceLeft = targetRect.left
    const spaceRight = viewportWidth - targetRect.right

    // Determine best position based on available space
    let actualPosition = step.position

    // Check if preferred position has enough space, otherwise flip
    if (step.position === 'top' && spaceTop < tooltipHeight + padding) {
      actualPosition = 'bottom'
    } else if (step.position === 'bottom' && spaceBottom < tooltipHeight + padding) {
      actualPosition = 'top'
    } else if (step.position === 'left' && spaceLeft < tooltipWidth + padding) {
      actualPosition = spaceBottom > spaceTop ? 'bottom' : 'top'
    } else if (step.position === 'right' && spaceRight < tooltipWidth + padding) {
      actualPosition = spaceBottom > spaceTop ? 'bottom' : 'top'
    }

    // Calculate centered horizontal position
    const centeredLeft = clampLeft(targetRect.left + targetRect.width / 2 - tooltipWidth / 2)

    // Calculate centered vertical position
    const centeredTop = clampTop(targetRect.top + targetRect.height / 2 - tooltipHeight / 2)

    switch (actualPosition) {
      case 'top':
        return {
          top: `${clampTop(targetRect.top - tooltipHeight - padding)}px`,
          left: `${centeredLeft}px`,
          transform: 'none',
          actualPosition,
        }
      case 'bottom':
        return {
          top: `${clampTop(targetRect.bottom + padding)}px`,
          left: `${centeredLeft}px`,
          transform: 'none',
          actualPosition,
        }
      case 'left':
        return {
          top: `${centeredTop}px`,
          left: `${clampLeft(targetRect.left - tooltipWidth - padding)}px`,
          transform: 'none',
          actualPosition,
        }
      case 'right':
        return {
          top: `${centeredTop}px`,
          left: `${clampLeft(targetRect.right + padding)}px`,
          transform: 'none',
          actualPosition,
        }
      default:
        return {
          top: `${clampTop(targetRect.bottom + padding)}px`,
          left: `${centeredLeft}px`,
          transform: 'none',
          actualPosition: 'bottom',
        }
    }
  }

  const getArrowPosition = (actualPosition: string) => {
    if (!targetRect) return ''

    switch (actualPosition) {
      case 'top':
        // Arrow points down (at bottom of tooltip)
        return 'bottom-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-primary'
      case 'bottom':
        // Arrow points up (at top of tooltip)
        return 'top-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-primary'
      case 'left':
        // Arrow points right (at right of tooltip)
        return 'right-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-l-8 border-t-transparent border-b-transparent border-l-primary'
      case 'right':
        // Arrow points left (at left of tooltip)
        return 'left-[-8px] top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-primary'
      default:
        return 'top-[-8px] left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-primary'
    }
  }

  const tooltipPosition = getTooltipPosition()
  const tooltipStyle = {
    top: tooltipPosition.top,
    left: tooltipPosition.left,
    transform: tooltipPosition.transform,
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop with spotlight effect */}
      <div className="absolute inset-0 bg-black/70" onClick={handleSkip} />

      {/* Spotlight on target element */}
      {targetRect && (
        <div
          className="absolute bg-transparent rounded-lg ring-4 ring-primary ring-offset-4 ring-offset-transparent pointer-events-none"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="absolute w-80 max-w-[calc(100vw-40px)] bg-gradient-to-br from-gray-900 to-gray-800 border-2 border-primary rounded-xl p-5 shadow-2xl shadow-primary/20"
        style={tooltipStyle}
      >
        {/* Arrow */}
        <div className={`absolute w-0 h-0 ${getArrowPosition(tooltipPosition.actualPosition)}`} />

        {/* Step indicator */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="ClubCheck"
              width={32}
              height={32}
              className="rounded-lg"
            />
            {isDemo && (
              <span className="bg-purple-500 text-white text-xs font-bold px-2 py-0.5 rounded">
                DEMO
              </span>
            )}
          </div>
          <span className="text-gray-400 text-sm">
            {currentStep + 1} of {walkthroughSteps.length}
          </span>
        </div>

        {/* Content */}
        <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
        <p className="text-gray-300 text-sm leading-relaxed mb-4">{step.description}</p>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mb-4">
          {walkthroughSteps.map((_, index) => (
            <div
              key={index}
              className={`h-1.5 rounded-full transition-all ${
                index === currentStep
                  ? 'w-6 bg-primary'
                  : index < currentStep
                  ? 'w-1.5 bg-primary/50'
                  : 'w-1.5 bg-gray-600'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-gray-400 hover:text-white text-sm transition"
          >
            Skip Tour
          </button>

          <div className="flex gap-2">
            {currentStep > 0 && (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-bold bg-gradient-to-r from-primary to-primary-dark text-black rounded-lg hover:opacity-90 transition"
            >
              {currentStep === walkthroughSteps.length - 1 ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
