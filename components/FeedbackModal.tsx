'use client'

import { useState } from 'react'

interface FeedbackModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [rating, setRating] = useState(0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (rating === 0) {
      setError('Please select a rating')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, message: message.trim() || null }),
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to submit feedback')
        setLoading(false)
        return
      }

      setSubmitted(true)
      setLoading(false)

      // Close after 2 seconds
      setTimeout(() => {
        handleClose()
      }, 2000)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  function handleClose() {
    setRating(0)
    setHoveredRating(0)
    setMessage('')
    setSubmitted(false)
    setError(null)
    onClose()
  }

  const displayRating = hoveredRating || rating

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-dark-card border border-gray-800 rounded-xl shadow-2xl w-full max-w-md">
        {submitted ? (
          // Success State
          <div className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-600 rounded-full mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-100 mb-2">Thank You!</h2>
            <p className="text-gray-400">Your feedback helps us improve ClubCheck.</p>
          </div>
        ) : (
          // Form State
          <>
            {/* Header */}
            <div className="p-6 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-100">Send Feedback</h2>
                  <p className="text-gray-400 text-sm mt-1">How&apos;s your experience with ClubCheck?</p>
                </div>
                <button
                  onClick={handleClose}
                  className="text-gray-500 hover:text-gray-300 p-2 rounded-lg hover:bg-dark-lighter transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6">
              {/* Star Rating */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Rate your experience
                </label>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoveredRating(star)}
                      onMouseLeave={() => setHoveredRating(0)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <svg
                        className={`w-10 h-10 transition-colors ${
                          star <= displayRating
                            ? 'text-primary fill-primary'
                            : 'text-gray-600'
                        }`}
                        fill={star <= displayRating ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                        />
                      </svg>
                    </button>
                  ))}
                </div>
                {rating > 0 && (
                  <p className="text-center text-gray-400 text-sm mt-2">
                    {rating === 1 && 'Poor'}
                    {rating === 2 && 'Fair'}
                    {rating === 3 && 'Good'}
                    {rating === 4 && 'Great'}
                    {rating === 5 && 'Excellent!'}
                  </p>
                )}
              </div>

              {/* Message */}
              <div className="mb-6">
                <label htmlFor="feedback-message" className="block text-sm font-medium text-gray-300 mb-2">
                  Tell us more <span className="text-gray-500 font-normal">(optional)</span>
                </label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What could we improve? Any features you'd like to see?"
                  rows={4}
                  className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 placeholder-gray-500 resize-none"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || rating === 0}
                className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  'Send Feedback'
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
