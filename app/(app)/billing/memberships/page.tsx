'use client'

import { useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Button, Card, ConfirmModal, EmptyState, ErrorState, Page, PageHeader, SkeletonRows, Stat, StatusBadge, Table, Td, Th, useToast } from '@/components/ui'

interface Row { id: string; status: string; priceCents: number; paymentMethod: string; currentPeriodEnd: string | null; autoRenew: boolean; cancelAt: string | null; trialEndsAt: string | null; failedPaymentCount: number; freezeEndsAt: string | null; member: { id: string; name: string }; plan: { name: string; billingInterval: string; intervalCount: number } }
interface Summary { invoicesCreated: number; paymentsCollected: number; paymentsFailed: number; trialsConverted: number; markedPastDue: number; cancelled: number; expired: number; unfrozen: number; errors: string[] }

export default function MembershipBillingPage() {
  const toast = useToast()
  const { money, date, can } = useSession()
  const { data, error, loading, reload } = useApi<{ memberships: Row[]; mrrCents: number; billableCount: number }>('/api/billing/renewals')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const week = new Date(Date.now() + 7 * 86_400_000)
  const dueSoon = (data?.memberships || []).filter((m) => m.currentPeriodEnd && new Date(m.currentPeriodEnd) <= week && ['active', 'trial', 'past_due'].includes(m.status))

  const run = async () => {
    setBusy(true)
    try {
      const s = await api<Summary>('/api/billing/renewals', { body: {} })
      const parts = [s.invoicesCreated && `${s.invoicesCreated} invoice${s.invoicesCreated === 1 ? '' : 's'} raised`, s.trialsConverted && `${s.trialsConverted} trial${s.trialsConverted === 1 ? '' : 's'} converted`, s.markedPastDue && `${s.markedPastDue} marked past due`, s.cancelled && `${s.cancelled} cancelled`, s.expired && `${s.expired} expired`, s.unfrozen && `${s.unfrozen} unfrozen`].filter(Boolean)
      if (s.errors.length) toast.error(`${s.errors.length} membership${s.errors.length === 1 ? '' : 's'} could not be processed. Check the audit log.`)
      else toast.success(parts.length ? parts.join(', ') : 'Everything is already up to date')
      setConfirming(false)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Membership billing" description="Recurring memberships in the order they next bill." actions={can('billing.manage') && <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirming(true)}>Run billing now</Button>} />
      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Monthly recurring revenue" value={money(data.mrrCents)} />
          <Stat label="Renewing memberships" value={data.billableCount} />
          <Stat label="Billing in the next 7 days" value={dueSoon.length} hint={money(dueSoon.reduce((s, m) => s + m.priceCents, 0))} />
          <Stat label="Past due" value={data.memberships.filter((m) => m.status === 'past_due').length} href="/billing/failed" />
        </div>
      )}
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.memberships.length === 0 ? (
          <EmptyState title="No recurring memberships yet" description="Sell a recurring membership from a member's profile and it will appear here with its next billing date." />
        ) : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Plan</Th><Th>Status</Th><Th>Next billing</Th><Th>Pays by</Th><Th align="right">Amount</Th></tr></thead>
            <tbody>
              {data.memberships.map((m) => (
                <tr key={m.id}>
                  <Td><Link href={`/members/${m.member.id}?tab=memberships`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{m.member.name}</Link></Td>
                  <Td className="text-fg-muted">{m.plan.name}</Td>
                  <Td><StatusBadge status={m.status} />{m.failedPaymentCount > 0 && <span className="ml-2 text-xs text-fg-subtle">{m.failedPaymentCount} failed</span>}</Td>
                  <Td className="text-fg-muted">
                    {m.status === 'frozen' ? `Frozen until ${date(m.freezeEndsAt)}` : m.cancelAt ? `Cancels ${date(m.cancelAt)}` : !m.autoRenew ? `Ends ${date(m.currentPeriodEnd)}` : m.status === 'trial' ? `Trial ends ${date(m.currentPeriodEnd)}` : date(m.currentPeriodEnd)}
                  </Td>
                  <Td className="text-fg-muted">{titleCase(m.paymentMethod)}</Td>
                  <Td align="right">{money(m.priceCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ConfirmModal open={confirming} onClose={() => setConfirming(false)} onConfirm={run} loading={busy} title="Run membership billing now?" confirmLabel="Run billing">
        <p>This does what the nightly job does: raises renewal invoices that are due, converts finished trials, applies scheduled cancellations and freezes, and marks memberships past due once an invoice is unpaid beyond your grace period.</p>
        <p>It never bills the same period twice, so it's safe to run at any time. Invoices are left open for you to collect: ClubCheck doesn't charge cards automatically yet.</p>
      </ConfirmModal>
    </Page>
  )
}
