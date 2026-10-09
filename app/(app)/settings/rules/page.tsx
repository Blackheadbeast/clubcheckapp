'use client'

import { useEffect, useState } from 'react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, Checkbox, ErrorState, Field, FormError, Input, Page, PageHeader, Select, SkeletonRows, useToast } from '@/components/ui'

interface Settings { timezone: string; currency: string; defaultTaxRateBps: number; bookingWindowDays: number; bookingCutoffMinutes: number; cancelWindowHours: number; waitlistOfferMinutes: number; lateCancelUsesCredit: boolean; pastDueGraceDays: number; pastDueCancelDays: number; memberSelfCheckin: boolean; memberSelfFreeze: boolean; memberSelfCancel: boolean; memberSelfChangePlan: boolean }
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland']

export default function RulesPage() {
  const toast = useToast()
  const session = useSession()
  const { data, error, loading, reload } = useApi<Settings>('/api/business-settings')
  const [f, setF] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (data) setF(data) }, [data])
  const num = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setF((prev) => prev && { ...prev, [key]: Math.max(0, Number(e.target.value) || 0) })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f) return
    setBusy(true)
    setProblem(null)
    try {
      const { timezone, currency, defaultTaxRateBps, bookingWindowDays, bookingCutoffMinutes, cancelWindowHours, waitlistOfferMinutes, lateCancelUsesCredit, pastDueGraceDays, pastDueCancelDays, memberSelfCheckin, memberSelfFreeze, memberSelfCancel, memberSelfChangePlan } = f
      await api('/api/business-settings', { method: 'PUT', body: { timezone, currency, defaultTaxRateBps, bookingWindowDays, bookingCutoffMinutes, cancelWindowHours, waitlistOfferMinutes, lateCancelUsesCredit, pastDueGraceDays, pastDueCancelDays, memberSelfCheckin, memberSelfFreeze, memberSelfCancel, memberSelfChangePlan } })
      toast.success('Rules saved')
      session.reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page width="narrow">
      <PageHeader title="Booking & billing rules" description="The rules ClubCheck applies automatically when members book, cancel and pay." />
      {loading || !f ? <Card padded={false}>{error ? <ErrorState error={error} onRetry={reload} /> : <SkeletonRows />}</Card> : (
        <form onSubmit={save} className="space-y-4">
          <Card>
            <CardHeader title="Region" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Timezone" hint="Class times, “today” and report dates use this."><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{(ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</Select></Field>
              <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{['usd', 'cad', 'gbp', 'eur', 'aud', 'nzd'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</Select></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Class booking" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Members can book up to (days ahead)"><Input type="number" min={1} max={365} value={f.bookingWindowDays} onChange={num('bookingWindowDays')} /></Field>
              <Field label="Booking closes (minutes before class)" hint="0 lets members book right up to the start."><Input type="number" min={0} max={1440} value={f.bookingCutoffMinutes} onChange={num('bookingCutoffMinutes')} /></Field>
              <Field label="Free cancellation until (hours before class)" hint="Later than this counts as a late cancellation."><Input type="number" min={0} max={168} value={f.cancelWindowHours} onChange={num('cancelWindowHours')} /></Field>
              <Field label="Waitlist offer held for (minutes)" hint="0 books the next person in automatically, with no need to confirm."><Input type="number" min={0} max={1440} value={f.waitlistOfferMinutes} onChange={num('waitlistOfferMinutes')} /></Field>
              <div className="sm:col-span-2"><Checkbox checked={f.lateCancelUsesCredit} onChange={(e) => setF({ ...f, lateCancelUsesCredit: e.target.checked })} label="A late cancellation still uses the class credit (and counts toward weekly limits)" /></div>
            </div>
            <p className="mt-3 text-xs text-fg-subtle">Staff can always book and cancel outside these limits, and can waive a late cancellation.</p>
          </Card>
          <Card>
            <CardHeader title="Billing" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default tax rate (%)" hint="Applied to memberships and products that don't set their own."><Input type="number" min={0} max={30} step={0.01} value={f.defaultTaxRateBps / 100} onChange={(e) => setF({ ...f, defaultTaxRateBps: Math.round((parseFloat(e.target.value) || 0) * 100) })} /></Field>
              <Field label="Grace period before past due (days)" hint="How long a renewal invoice can stay unpaid."><Input type="number" min={0} max={60} value={f.pastDueGraceDays} onChange={num('pastDueGraceDays')} /></Field>
              <Field label="Cancel unpaid memberships after (days past due)" hint="0 keeps them past due until staff decide."><Input type="number" min={0} max={180} value={f.pastDueCancelDays} onChange={num('pastDueCancelDays')} /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Member self-service" description="What members can do for themselves in their account. Plan rules (freeze limits, notice periods, contracts) always apply." />
            <div className="space-y-3">
              <Checkbox checked={f.memberSelfCheckin} onChange={(e) => setF({ ...f, memberSelfCheckin: e.target.checked })} label="Check themselves in from their phone" />
              <Checkbox checked={f.memberSelfFreeze} onChange={(e) => setF({ ...f, memberSelfFreeze: e.target.checked })} label="Freeze and resume their membership" />
              <Checkbox checked={f.memberSelfCancel} onChange={(e) => setF({ ...f, memberSelfCancel: e.target.checked })} label="Cancel at the end of the paid period (never mid-contract)" />
              <Checkbox checked={f.memberSelfChangePlan} onChange={(e) => setF({ ...f, memberSelfChangePlan: e.target.checked })} label="Switch to another public membership from the next billing date" />
            </div>
          </Card>
          <FormError message={problem} />
          <div className="flex justify-end"><Button variant="primary" type="submit" loading={busy}>Save rules</Button></div>
        </form>
      )}
    </Page>
  )
}
