'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, Receipt } from 'lucide-react'
import { qs, useApi, useDebounced } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Button, Card, DateRangePicker, EmptyState, ErrorState, Page, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Stat, StatusBadge, Table, Td, Th, rangeQuery, type RangeValue } from '@/components/ui'
import { RefundModal, type RefundTarget } from '@/components/billing/PaymentModals'

interface Tx {
  id: string; type: string; status: string; amountCents: number; refundedCents: number; method: string; failureReason: string | null; note: string | null; staffName: string | null; createdAt: string
  member: { id: string; name: string } | null; invoice: { id: string; number: string } | null; location: { name: string } | null
}

export default function TransactionsPage() {
  const { money, dateTime, can, locationId } = useSession()
  const [range, setRange] = useState<RangeValue>({ preset: '30d', from: '', to: '' })
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [refund, setRefund] = useState<RefundTarget | null>(null)
  const debounced = useDebounced(search)
  const filters = { ...rangeQuery(range), type, status, method, search: debounced, locationId }
  useEffect(() => setPage(1), [JSON.stringify(filters)]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data, meta, error, loading, reload } = useApi<Tx[]>(`/api/billing/transactions${qs({ ...filters, page })}`)
  const m = (meta || {}) as Record<string, number>

  return (
    <Page>
      <PageHeader title="Transactions" description="Every payment, refund and credit." actions={<><DateRangePicker value={range} onChange={setRange} /><a href={`/api/billing/transactions${qs({ ...filters, format: 'csv' })}`}><Button icon={<Download className="h-4 w-4" />}>Export</Button></a></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected" value={money(m.collectedCents)} />
        <Stat label="Refunded" value={money(m.refundedCents)} />
        <Stat label="Net" value={money((m.collectedCents || 0) - (m.refundedCents || 0))} />
        <Stat label="Failed" value={money(m.failedCents)} hint={`${m.failedCount || 0} attempt${m.failedCount === 1 ? '' : 's'}`} href="/billing/failed" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search member, invoice or transaction ID" className="min-w-[14rem] flex-1 sm:max-w-sm" />
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-auto"><option value="">All types</option><option value="payment">Payments</option><option value="refund">Refunds</option><option value="credit">Credits</option></Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto"><option value="">Any status</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option></Select>
        <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-auto"><option value="">Any method</option>{Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select>
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No transactions match" description="Payments appear here when you sell a membership, take a payment or ring up a sale." />
        ) : (
          <>
            <Table primary={1}>
              <thead><tr><Th>Date</Th><Th>Member</Th><Th>Type</Th><Th>Method</Th><Th>Invoice</Th><Th>Status</Th><Th align="right">Amount</Th><Th>ID</Th><Th /></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <Td className="text-fg-muted">{dateTime(t.createdAt)}</Td>
                    <Td>{t.member ? <Link href={`/members/${t.member.id}?tab=billing`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{t.member.name}</Link> : <span className="text-fg-subtle">Walk-in</span>}</Td>
                    <Td>{titleCase(t.type)}</Td>
                    <Td className="text-fg-muted">{titleCase(t.method)}</Td>
                    <Td>{t.invoice ? <Link href={`/billing/invoices?invoice=${t.invoice.id}`} className="ui-focus rounded text-fg-muted hover:underline">{t.invoice.number}</Link> : '—'}</Td>
                    <Td>
                      <StatusBadge status={t.type === 'payment' && t.status === 'succeeded' && t.refundedCents > 0 ? (t.refundedCents >= t.amountCents ? 'refunded' : 'partially_refunded') : t.status} />
                      {(t.failureReason || t.note) && <span className="ml-2 max-w-[12rem] truncate align-middle text-xs text-fg-subtle">{t.failureReason || t.note}</span>}
                    </Td>
                    <Td align="right" className={t.type === 'refund' ? 'text-amber-700 dark:text-amber-400' : t.status === 'failed' ? 'text-fg-subtle line-through' : 'font-medium'}>{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</Td>
                    <Td className="font-mono text-xs text-fg-subtle">{t.id.slice(0, 8)}</Td>
                    <Td align="right">{t.type === 'payment' && t.status === 'succeeded' && t.refundedCents < t.amountCents && can('billing.refund') && <Button size="sm" onClick={() => setRefund({ id: t.id, amountCents: t.amountCents, refundedCents: t.refundedCents, method: t.method })}>Refund</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="transactions" />}
          </>
        )}
      </Card>
      <RefundModal transaction={refund} onClose={() => setRefund(null)} onDone={reload} />
    </Page>
  )
}
