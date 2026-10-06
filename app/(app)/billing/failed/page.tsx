'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { qs, useApi } from '@/lib/client'
import { timeAgo } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, EmptyState, ErrorState, Page, PageHeader, SkeletonRows, Stat, Table, Td, Th } from '@/components/ui'
import { PayModal, type PayTarget } from '@/components/billing/PaymentModals'
import { ComposeModal } from '@/components/members/ComposeModal'

interface Inv { id: string; number: string; totalCents: number; amountPaidCents: number; dueDate: string | null; attemptCount: number; nextAttemptAt: string | null; member: { id: string; name: string } | null; items: { description: string }[] }
interface Tx { id: string; amountCents: number; method: string; failureReason: string | null; createdAt: string; member: { id: string; name: string } | null; invoice: { id: string; number: string } | null }

export default function FailedPaymentsPage() {
  const { money, date, can } = useSession()
  const overdue = useApi<Inv[]>(`/api/billing/invoices${qs({ status: 'overdue', pageSize: 100 })}`)
  const failed = useApi<Tx[]>(`/api/billing/transactions${qs({ type: 'payment', status: 'failed', range: '30d', pageSize: 50 })}`)
  const [pay, setPay] = useState<PayTarget | null>(null)
  const [messaging, setMessaging] = useState(false)
  const rows = overdue.data || []
  const owed = rows.reduce((s, i) => s + i.totalCents - i.amountPaidCents, 0)
  const memberIds = Array.from(new Set(rows.map((r) => r.member?.id).filter(Boolean))) as string[]
  const reload = () => { overdue.reload(); failed.reload() }

  return (
    <Page>
      <PageHeader title="Failed payments" description="Overdue invoices and declined attempts that need following up." actions={can('communication.send') && memberIds.length > 0 && <Button onClick={() => setMessaging(true)}>Message everyone who owes</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Overdue balance" value={money(owed)} hint={`${rows.length} invoice${rows.length === 1 ? '' : 's'}`} />
        <Stat label="Members who owe" value={memberIds.length} href="/members?payment=overdue" />
        <Stat label="Failed attempts, 30 days" value={failed.meta ? (failed.meta.failedCount as number) : '—'} hint={failed.meta ? money(failed.meta.failedCents as number) : undefined} />
      </div>
      <div className="space-y-4">
        <Card padded={false}>
          <CardHeader title="Overdue invoices" className="px-4 pt-4 sm:px-5" />
          {overdue.loading ? <SkeletonRows /> : overdue.error ? <ErrorState error={overdue.error} onRetry={overdue.reload} /> : rows.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Nothing is overdue" description="Every invoice is paid or not yet due." />
          ) : (
            <Table>
              <thead><tr><Th>Member</Th><Th>Invoice</Th><Th>For</Th><Th>Due</Th><Th align="right">Attempts</Th><Th align="right">Balance</Th><Th /></tr></thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id}>
                    <Td>{inv.member ? <Link href={`/members/${inv.member.id}?tab=billing`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{inv.member.name}</Link> : '—'}</Td>
                    <Td><Link href={`/billing/invoices?invoice=${inv.id}`} className="ui-focus rounded text-fg-muted hover:underline">{inv.number}</Link></Td>
                    <Td className="max-w-[16rem] truncate text-fg-muted">{inv.items[0]?.description}</Td>
                    <Td className="text-red-600 dark:text-red-400">{date(inv.dueDate)} <span className="text-xs text-fg-subtle">({timeAgo(inv.dueDate)})</span></Td>
                    <Td align="right">{inv.attemptCount || '—'}</Td>
                    <Td align="right" className="font-medium">{money(inv.totalCents - inv.amountPaidCents)}</Td>
                    <Td align="right">{can('billing.manage') && <Button size="sm" variant="primary" onClick={() => setPay({ id: inv.id, number: inv.number, balanceCents: inv.totalCents - inv.amountPaidCents })}>Take payment</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card padded={false}>
          <CardHeader title="Declined attempts" description="Last 30 days" className="px-4 pt-4 sm:px-5" />
          {failed.loading ? <SkeletonRows rows={3} /> : failed.error ? <ErrorState error={failed.error} onRetry={failed.reload} /> : !failed.data || failed.data.length === 0 ? <EmptyState title="No declined payments in the last 30 days" /> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Member</Th><Th>Invoice</Th><Th>Reason</Th><Th align="right">Amount</Th></tr></thead>
              <tbody>
                {failed.data.map((t) => (
                  <tr key={t.id}>
                    <Td className="text-fg-muted">{timeAgo(t.createdAt)}</Td>
                    <Td>{t.member ? <Link href={`/members/${t.member.id}?tab=billing`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{t.member.name}</Link> : '—'}</Td>
                    <Td className="text-fg-muted">{t.invoice?.number || '—'}</Td>
                    <Td className="text-fg-muted">{t.failureReason || 'Declined'}</Td>
                    <Td align="right">{money(t.amountCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      <PayModal invoice={pay} onClose={() => setPay(null)} onDone={reload} />
      <ComposeModal open={messaging} onClose={() => setMessaging(false)} audience={{ type: 'members', ids: memberIds }} label={`${memberIds.length} member${memberIds.length === 1 ? '' : 's'} with an overdue balance`} />
    </Page>
  )
}
