import { Info } from 'lucide-react'

/** Says plainly when a channel has no provider behind it, so "skipped" messages are not a mystery. */
export function DeliveryNotice({ delivery }: { delivery?: { email: boolean; sms: boolean } }) {
  if (!delivery || (delivery.email && delivery.sms)) return null
  const missing = [!delivery.email && 'Email (set RESEND_API_KEY)', !delivery.sms && 'SMS (set the TWILIO_* variables)'].filter(Boolean)
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>Not connected in this environment: {missing.join(' and ')}. Messages on a channel that isn't connected are recorded as “skipped” and nothing is sent.</span>
    </div>
  )
}
