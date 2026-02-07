'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface Counts {
  all: number
  active: number
  inactive: number
  'miss-you': number
}

type TargetGroup = 'all' | 'active' | 'inactive' | 'miss-you'

const TARGET_OPTIONS: { value: TargetGroup; label: string; description: string }[] = [
  { value: 'all', label: 'All Members', description: 'Send to every member in your database' },
  { value: 'active', label: 'Active Members', description: 'Members with active status' },
  { value: 'inactive', label: 'Inactive Members', description: 'Members with inactive or paused status' },
  { value: 'miss-you', label: 'We Miss You', description: 'Active members who haven\'t checked in for 14+ days' },
]

const TEMPLATES = [
  {
    name: 'We Miss You',
    subject: 'We miss seeing you at the gym!',
    message: `It's been a while since your last visit, and we wanted to check in!

We know life gets busy, but your fitness goals are still waiting for you. The gym is here whenever you're ready to get back on track.

Here are a few reasons to come back:
- Your progress is waiting to continue
- New equipment and classes to try
- Your gym community misses you

We'd love to see you soon. Just show your QR code at the front desk and you're all set!

See you soon,
Your Gym Team`,
  },
  {
    name: 'Holiday Hours',
    subject: 'Updated Holiday Hours',
    message: `We wanted to give you a heads up about our holiday schedule.

Please check our updated hours before your next visit. We want to make sure you can plan your workouts accordingly.

Thank you for being a valued member!

Best,
Your Gym Team`,
  },
  {
    name: 'New Class Announcement',
    subject: 'Exciting News: New Classes Available!',
    message: `We're thrilled to announce new classes at the gym!

We've added some exciting new options to our schedule based on your feedback. Check out what's new and sign up for a class today.

As always, thank you for being part of our community.

See you in class!
Your Gym Team`,
  },
  {
    name: 'Custom',
    subject: '',
    message: '',
  },
]

export default function BroadcastPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<Counts>({ all: 0, active: 0, inactive: 0, 'miss-you': 0 })
  const [gymName, setGymName] = useState('')

  const [targetGroup, setTargetGroup] = useState<TargetGroup>('active')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{
    success?: boolean
    sent?: number
    failed?: number
    total?: number
    error?: string
  } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/broadcast', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const data = await res.json()
        setCounts(data.counts)
        setGymName(data.gymName)
      } catch {
        console.error('Failed to load broadcast data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  function handleTemplateChange(templateName: string) {
    setSelectedTemplate(templateName)
    const template = TEMPLATES.find((t) => t.name === templateName)
    if (template) {
      setSubject(template.subject)
      setMessage(template.message)
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)

    const recipientCount = counts[targetGroup]
    if (recipientCount === 0) {
      setResult({ error: 'No members in the selected group' })
      return
    }

    if (!confirm(`Send this email to ${recipientCount} member${recipientCount !== 1 ? 's' : ''}?`)) {
      return
    }

    setSending(true)

    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message, targetGroup }),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setResult({ error: data.error || 'Failed to send broadcast' })
        return
      }

      setResult({
        success: true,
        sent: data.sent,
        failed: data.failed,
        total: data.total,
      })

      // Clear form on success
      if (data.sent > 0) {
        setSubject('')
        setMessage('')
        setSelectedTemplate('')
      }
    } catch {
      setResult({ error: 'Something went wrong' })
    } finally {
      setSending(false)
    }
  }

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
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary">Broadcast Email</h1>
          <p className="text-gray-400 mt-1">Send emails to your members</p>
        </div>

        {/* Result Banner */}
        {result && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              result.success
                ? 'bg-green-900/20 border border-green-800 text-green-400'
                : 'bg-red-900/20 border border-red-800 text-red-400'
            }`}
          >
            {result.success ? (
              <div>
                <p className="font-semibold">Broadcast sent successfully!</p>
                <p className="text-sm mt-1">
                  {result.sent} of {result.total} emails sent
                  {result.failed && result.failed > 0 ? ` (${result.failed} failed)` : ''}
                </p>
              </div>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2">
            <form onSubmit={handleSend} className="bg-dark-card rounded-lg border border-gray-800 p-6">
              {/* Target Group */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Send To
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {TARGET_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTargetGroup(opt.value)}
                      className={`p-4 rounded-lg border text-left transition ${
                        targetGroup === opt.value
                          ? 'border-primary bg-primary/10'
                          : 'border-gray-700 bg-dark-lighter hover:border-gray-600'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-medium text-gray-100">{opt.label}</span>
                        <span className="text-primary font-bold">{counts[opt.value]}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{opt.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Selector */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Template (Optional)
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                >
                  <option value="">Choose a template...</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subject */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Subject *
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  placeholder="Email subject line"
                  className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                />
              </div>

              {/* Message */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Message *
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={12}
                  placeholder="Write your message here..."
                  className="w-full px-4 py-3 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 resize-none"
                />
                <p className="text-gray-500 text-xs mt-2">
                  Each member will be addressed by their first name automatically.
                </p>
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={sending || counts[targetGroup] === 0}
                className="w-full bg-primary hover:bg-primary-dark text-black font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
              >
                {sending
                  ? 'Sending...'
                  : `Send to ${counts[targetGroup]} Member${counts[targetGroup] !== 1 ? 's' : ''}`}
              </button>
            </form>
          </div>

          {/* Preview Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-dark-card rounded-lg border border-gray-800 p-6 sticky top-24">
              <h3 className="text-lg font-semibold text-gray-100 mb-4">Preview</h3>

              <div className="bg-dark-lighter rounded-lg p-4 text-sm">
                <div className="mb-3 pb-3 border-b border-gray-700">
                  <div className="text-gray-500 text-xs mb-1">From</div>
                  <div className="text-gray-300">{gymName}</div>
                </div>

                <div className="mb-3 pb-3 border-b border-gray-700">
                  <div className="text-gray-500 text-xs mb-1">Subject</div>
                  <div className="text-gray-100 font-medium">
                    {subject || <span className="text-gray-600 italic">No subject</span>}
                  </div>
                </div>

                <div>
                  <div className="text-gray-500 text-xs mb-1">Message</div>
                  <div className="text-gray-300 whitespace-pre-wrap text-xs leading-relaxed max-h-64 overflow-y-auto">
                    {message ? (
                      <>
                        <span className="text-primary">Hi [Member Name],</span>
                        <br />
                        <br />
                        {message}
                      </>
                    ) : (
                      <span className="text-gray-600 italic">No message</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                <p className="text-primary text-xs">
                  Emails are sent from <strong>noreply@clubcheckapp.com</strong> with your gym name as the sender.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
