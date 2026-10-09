'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { Badge, Button, Card, CardHeader, ErrorState, FormError, Page, PageHeader, SkeletonRows } from '@/components/ui'

interface Status {
  configured: boolean
  connected: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  disabledReason: string | null
  accountId: string | null
  platformFeeBps: number
}

export default function PaymentsSettingsPage() {
  // refresh=1 asks Stripe for the latest state, so returning from onboarding does not wait on the webhook.
  const { data, error, loading, reload } = useApi<Status>(`/api/billing/connect?refresh=1`)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (window.location.search.includes('connect=')) window.history.replaceState(null, '', '/settings/payments')
  }, [])

  const connect = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const { url } = await api<{ url: string }>('/api/billing/connect', { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setProblem((err as ClientError).message)
      setBusy(false)
    }
  }

  const disconnected = data?.disabledReason === 'disconnected'

  return (
    <Page width="narrow">
      <PageHeader title="Payments" description="Charge members' cards and bank accounts, and collect renewals automatically." />
      {loading ? <Card padded={false}><SkeletonRows rows={3} /></Card> : error || !data ? <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card> : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Stripe account"
              description="Payments go straight into your own Stripe account. ClubCheck never holds your money or sees card numbers."
              action={data.chargesEnabled ? <Badge tone="green">Connected</Badge> : data.connected && !disconnected ? <Badge tone="amber">Setup incomplete</Badge> : <Badge>Not connected</Badge>}
            />
            {!data.configured ? (
              <p className="text-sm text-fg-muted">Card payments are not available on this installation yet. Please contact ClubCheck support.</p>
            ) : data.chargesEnabled ? (
              <div className="space-y-3 text-sm">
                <p className="flex items-start gap-2 text-fg"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />You can save cards and bank accounts on members, and renewals set to pay by card or bank debit are charged automatically.</p>
                {!data.payoutsEnabled && <p className="flex items-start gap-2 text-fg"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />Stripe is not paying out to your bank yet. Finish the remaining steps in Stripe so your money reaches you.</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer" className="ui-focus inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-fg shadow-card hover:bg-subtle">Open Stripe dashboard<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
                  {!data.payoutsEnabled && <Button onClick={connect} loading={busy}>Finish setup</Button>}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-fg-muted">
                  {disconnected
                    ? 'This Stripe account was disconnected from ClubCheck. Connect again to keep charging members.'
                    : data.connected
                      ? 'Stripe still needs a few details before you can take payments.'
                      : 'Connect a Stripe account to take card and bank payments. It takes a few minutes and you can use an existing Stripe account.'}
                </p>
                <Button variant="primary" onClick={connect} loading={busy}>{data.connected && !disconnected ? 'Continue setup in Stripe' : 'Connect Stripe'}</Button>
              </div>
            )}
            <div className="mt-3"><FormError message={problem} /></div>
          </Card>

          <Card>
            <CardHeader title="How collection works" />
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
              <li>Renewal invoices are charged to the member's default card or bank account on the day they are due.</li>
              <li>A declined payment is retried on day 3, day 5 and day 7. The member is notified by the "Payment failed" automation.</li>
              <li>Bank debits take a few business days to clear and show as pending until they do.</li>
              <li>Refunds issued in ClubCheck are returned to the original card or bank account.</li>
              <li>The grace period and automatic cancellation for unpaid memberships are set in <Link href="/settings/rules" className="font-medium text-accent-text hover:underline">Booking &amp; billing rules</Link>.</li>
              {data.platformFeeBps > 0 && <li>ClubCheck charges a platform fee of {(data.platformFeeBps / 100).toFixed(2)}% on each payment, on top of Stripe's own fees.</li>}
            </ul>
          </Card>
        </div>
      )}
    </Page>
  )
}
