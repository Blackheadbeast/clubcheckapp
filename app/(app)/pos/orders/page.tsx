'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Button, Card, Checkbox, DateRangePicker, EmptyState, ErrorState, FormError, Input, Modal, Page, PageHeader, Pagination, SearchInput, SkeletonRows, Stat, StatusBadge, Table, Td, Th, rangeQuery, useToast, type RangeValue } from '@/components/ui'

interface Row { id: string; number: string; status: string; totalCents: number; paymentMethod: string; staffName: string | null; createdAt: string; member: { id: string; name: string } | null; items: { name: string; quantity: number }[]; location: { name: string } | null }
interface Detail { id: string; number: string; status: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; paymentMethod: string; couponCode: string | null; staffName: string | null; createdAt: string; member: { id: string; name: string } | null; items: { id: string; name: string; quantity: number; unitPriceCents: number; amountCents: number }[]; invoice: { id: string; number: string } | null }

export default function OrdersPage() {
  const toast = useToast()
  const { money, dateTime, can, locationId } = useSession()
  const [range, setRange] = useState<RangeValue>({ preset: '30d', from: '', to: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  useEffect(() => setPage(1), [range, debounced, locationId])
  const { data, meta, error, loading, reload } = useApi<Row[]>(`/api/pos/orders${qs({ ...rangeQuery(range), search: debounced, locationId, page })}`)
  const [openId, setOpenId] = useState<string | null>(null)
  const detail = useApi<Detail>(openId ? `/api/pos/orders/${openId}` : null)
  const [refunding, setRefunding] = useState(false)
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { setRefunding(false); setProblem(null); setReason(''); setRestock(true) }, [openId])

  const refund = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await api<{ refundedCents: number }>(`/api/pos/orders/${openId}`, { body: { action: 'refund', restock, reason: reason || null } })
      toast.success(`${money(result.refundedCents)} refunded`)
      setRefunding(false)
      detail.reload()
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const o = detail.data

  return (
    <Page>
      <PageHeader title="Orders" description="Product sales rung up at the desk." actions={<><DateRangePicker value={range} onChange={setRange} />{can('pos.sell') && <Link href="/pos"><Button variant="primary">New sale</Button></Link>}</>} />
      {meta && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Product sales" value={money(meta.salesCents as number)} />
          <Stat label="Orders" value={meta.completed as number} />
          <Stat label="Average order" value={money((meta.completed as number) > 0 ? Math.round((meta.salesCents as number) / (meta.completed as number)) : 0)} />
        </div>
      )}
      <SearchInput value={search} onChange={setSearch} placeholder="Search order number or member" className="mb-3 sm:max-w-sm" />
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<ShoppingBag className="h-5 w-5" />} title="No orders in this period" />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Order</Th><Th>When</Th><Th>Customer</Th><Th>Items</Th><Th>Paid by</Th><Th>Sold by</Th><Th>Status</Th><Th align="right">Total</Th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpenId(r.id)}>
                    <Td><button type="button" className="ui-focus rounded font-medium text-fg-heading hover:underline">{r.number}</button></Td>
                    <Td className="text-fg-muted">{dateTime(r.createdAt)}</Td>
                    <Td>{r.member?.name || <span className="text-fg-subtle">Walk-in</span>}</Td>
                    <Td className="max-w-[16rem] truncate text-fg-muted">{r.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(', ')}</Td>
                    <Td className="text-fg-muted">{titleCase(r.paymentMethod)}</Td>
                    <Td className="text-fg-muted">{r.staffName || '—'}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td align="right" className={r.status === 'refunded' ? 'text-fg-subtle line-through' : 'font-medium'}>{money(r.totalCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="orders" />}
          </>
        )}
      </Card>

      <Modal
        open={!!openId}
        onClose={() => setOpenId(null)}
        title={o ? `Order ${o.number}` : 'Order'}
        description={o ? `${dateTime(o.createdAt)}${o.staffName ? ` · sold by ${o.staffName}` : ''}` : undefined}
        footer={o && o.status !== 'refunded' && can('billing.refund') ? (refunding ? <><Button onClick={() => setRefunding(false)}>Back</Button><Button variant="danger" loading={busy} onClick={refund}>Refund {money(o.totalCents)}</Button></> : <Button onClick={() => setRefunding(true)}>Refund order</Button>) : undefined}
      >
        {detail.loading ? <SkeletonRows rows={4} /> : detail.error || !o ? <ErrorState error={detail.error || 'Not found'} onRetry={detail.reload} /> : refunding ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">This records a full refund of {money(o.totalCents)}. Return the money the same way it was paid ({titleCase(o.paymentMethod).toLowerCase()}).</p>
            <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} label="Put the items back into stock" />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" maxLength={300} />
            <FormError message={problem} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm"><span>{o.member ? <Link href={`/members/${o.member.id}`} className="font-medium text-fg-heading hover:underline">{o.member.name}</Link> : <span className="text-fg-muted">Walk-in customer</span>}</span><StatusBadge status={o.status} /></div>
            <ul className="divide-y divide-line/60 rounded-lg border border-line text-sm">
              {o.items.map((i) => <li key={i.id} className="flex justify-between gap-3 px-3 py-2"><span>{i.quantity > 1 && <span className="tabular text-fg-muted">{i.quantity}× </span>}{i.name}</span><span className="tabular">{money(i.amountCents)}</span></li>)}
            </ul>
            <dl className="tabular space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-fg-muted">Subtotal</dt><dd>{money(o.subtotalCents)}</dd></div>
              {o.discountCents > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Discount{o.couponCode ? ` (${o.couponCode})` : ''}</dt><dd>−{money(o.discountCents)}</dd></div>}
              {o.taxCents > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Tax</dt><dd>{money(o.taxCents)}</dd></div>}
              <div className="flex justify-between font-semibold text-fg-heading"><dt>Total · {titleCase(o.paymentMethod)}</dt><dd>{money(o.totalCents)}</dd></div>
            </dl>
            {o.invoice && can('billing.view') && <Link href={`/billing/invoices?invoice=${o.invoice.id}`} className="text-sm font-medium text-accent-text hover:underline">View invoice {o.invoice.number}</Link>}
          </div>
        )}
      </Modal>
    </Page>
  )
}
