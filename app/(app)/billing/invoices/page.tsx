'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, FileText, Plus, Trash2 } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, MoneyInput, Page, PageHeader, Pagination, SearchInput, SkeletonRows, StatusBadge, Table, Tabs, Td, Textarea, Th, useToast } from '@/components/ui'
import { PayModal, RefundModal, type PayTarget, type RefundTarget } from '@/components/billing/PaymentModals'

interface Row { id: string; number: string; status: string; totalCents: number; amountPaidCents: number; refundedCents: number; dueDate: string | null; createdAt: string; attemptCount: number; member: { id: string; name: string } | null; items: { description: string }[] }
interface Detail extends Row {
  subtotalCents: number; discountCents: number; taxCents: number; couponCode: string | null; notes: string | null; paidAt: string | null
  member: { id: string; name: string; email: string; creditBalanceCents: number } | null
  items: { id: string; description: string; quantity: number; unitPriceCents: number; amountCents: number }[]
  transactions: { id: string; type: string; status: string; amountCents: number; refundedCents: number; method: string; failureReason: string | null; note: string | null; createdAt: string }[]
}
const TABS = [{ key: '', label: 'All' }, { key: 'open', label: 'Open' }, { key: 'overdue', label: 'Overdue' }, { key: 'paid', label: 'Paid' }, { key: 'void', label: 'Void' }]

function Invoices() {
  const router = useRouter()
  const params = useSearchParams()
  const { money, date, can } = useSession()
  const status = params.get('status') || ''
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const debounced = useDebounced(search)
  useEffect(() => setPage(1), [status, debounced])
  const { data, meta, error, loading, reload } = useApi<Row[]>(`/api/billing/invoices${qs({ status, search: debounced, page })}`)
  const openId = params.get('invoice')
  const setOpen = (id: string | null) => router.replace(`/billing/invoices${qs({ status, invoice: id })}`)

  return (
    <Page>
      <PageHeader
        title="Invoices"
        description={meta ? `${money(meta.outstandingCents as number)} outstanding across ${meta.openCount} open invoice${meta.openCount === 1 ? '' : 's'}` : undefined}
        actions={<><a href={`/api/billing/invoices${qs({ status, search: debounced, format: 'csv' })}`}><Button icon={<Download className="h-4 w-4" />}>Export</Button></a>{can('billing.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New invoice</Button>}</>}
      />
      <Tabs tabs={TABS} value={status} onChange={(key) => router.replace(`/billing/invoices${qs({ status: key })}`)} />
      <SearchInput value={search} onChange={setSearch} placeholder="Search invoice number or member" className="mb-3 sm:max-w-sm" />
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No invoices match" description="Invoices are created when you sell a membership or product, or you can raise one by hand." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Member</Th><Th>For</Th><Th>Status</Th><Th>Due</Th><Th align="right">Total</Th><Th align="right">Balance</Th></tr></thead>
              <tbody>
                {data.map((inv) => {
                  const overdue = inv.status === 'open' && inv.dueDate && new Date(inv.dueDate) < new Date()
                  return (
                    <tr key={inv.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen(inv.id)}>
                      <Td><button type="button" className="ui-focus rounded font-medium text-fg-heading hover:underline">{inv.number}</button></Td>
                      <Td>{inv.member?.name || <span className="text-fg-subtle">Walk-in</span>}</Td>
                      <Td className="max-w-[18rem] truncate text-fg-muted">{inv.items[0]?.description || '—'}</Td>
                      <Td><StatusBadge status={overdue ? 'overdue' : inv.status} /></Td>
                      <Td className="text-fg-muted">{date(inv.dueDate)}</Td>
                      <Td align="right">{money(inv.totalCents)}</Td>
                      <Td align="right" className={inv.status === 'open' ? 'font-medium' : 'text-fg-subtle'}>{inv.status === 'open' ? money(inv.totalCents - inv.amountPaidCents) : '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="invoices" />}
          </>
        )}
      </Card>
      <InvoiceDrawer id={openId} onClose={() => setOpen(null)} onChanged={reload} />
      <CreateInvoiceModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { reload(); setOpen(id) }} />
    </Page>
  )
}

function InvoiceDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { money, date, dateTime, can, gym } = useSession()
  const { data: inv, error, loading, reload } = useApi<Detail>(id ? `/api/billing/invoices/${id}` : null)
  const [pay, setPay] = useState<PayTarget | null>(null)
  const [refund, setRefund] = useState<RefundTarget | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)
  if (!id) return null
  const changed = () => { reload(); onChanged() }
  const balance = inv ? inv.totalCents - inv.amountPaidCents : 0
  const doVoid = async () => {
    setBusy(true)
    setVoidError(null)
    try {
      await api(`/api/billing/invoices/${id}`, { body: { action: 'void' } })
      toast.success('Invoice voided')
      setVoiding(false)
      changed()
    } catch (err) {
      setVoidError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Modal
        open={!pay && !refund && !voiding}
        onClose={onClose}
        size="lg"
        title={inv ? `Invoice ${inv.number}` : 'Invoice'}
        description={inv ? `Issued ${date(inv.createdAt)} by ${gym.name}` : undefined}
        footer={inv && inv.status === 'open' && can('billing.manage') ? (
          <>
            {inv.amountPaidCents === 0 && <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setVoiding(true)}>Void invoice</Button>}
            <Button variant="primary" onClick={() => setPay({ id: inv.id, number: inv.number, balanceCents: balance, creditBalanceCents: inv.member?.creditBalanceCents, memberId: inv.member?.id })}>Take payment</Button>
          </>
        ) : undefined}
      >
        {loading ? <SkeletonRows rows={5} /> : error || !inv ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {inv.member ? (
                <Link href={`/members/${inv.member.id}?tab=billing`} className="ui-focus flex items-center gap-2.5 rounded"><Avatar name={inv.member.name} size="md" /><span><span className="block text-sm font-medium text-fg-heading hover:underline">{inv.member.name}</span><span className="block text-xs text-fg-muted">{inv.member.email}</span></span></Link>
              ) : <span className="text-sm text-fg-muted">Walk-in sale</span>}
              <div className="text-right">
                <StatusBadge status={inv.status === 'open' && inv.dueDate && new Date(inv.dueDate) < new Date() ? 'overdue' : inv.status} />
                <p className="mt-1 text-xs text-fg-subtle">{inv.status === 'paid' ? `Paid ${date(inv.paidAt)}` : `Due ${date(inv.dueDate)}`}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <Table>
                <thead><tr><Th>Item</Th><Th align="right">Qty</Th><Th align="right">Price</Th><Th align="right">Amount</Th></tr></thead>
                <tbody>{inv.items.map((i) => <tr key={i.id}><Td>{i.description}</Td><Td align="right">{i.quantity}</Td><Td align="right">{money(i.unitPriceCents)}</Td><Td align="right">{money(i.amountCents)}</Td></tr>)}</tbody>
              </Table>
              <dl className="tabular space-y-1 border-t border-line bg-subtle/40 px-4 py-3 text-sm sm:px-5">
                <div className="flex justify-between"><dt className="text-fg-muted">Subtotal</dt><dd>{money(inv.subtotalCents)}</dd></div>
                {inv.discountCents > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Discount{inv.couponCode ? ` (${inv.couponCode})` : ''}</dt><dd>−{money(inv.discountCents)}</dd></div>}
                {inv.taxCents > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Tax</dt><dd>{money(inv.taxCents)}</dd></div>}
                <div className="flex justify-between font-semibold text-fg-heading"><dt>Total</dt><dd>{money(inv.totalCents)}</dd></div>
                {inv.amountPaidCents > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Paid</dt><dd>−{money(inv.amountPaidCents)}</dd></div>}
                {inv.refundedCents > 0 && <div className="flex justify-between"><dt className="text-fg-muted">Refunded</dt><dd>{money(inv.refundedCents)}</dd></div>}
                {inv.status === 'open' && <div className="flex justify-between border-t border-line pt-1 font-semibold text-fg-heading"><dt>Balance due</dt><dd>{money(balance)}</dd></div>}
              </dl>
            </div>
            {inv.notes && <p className="whitespace-pre-wrap text-sm text-fg-muted">{inv.notes}</p>}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-fg-heading">Payments</h3>
              {inv.transactions.length === 0 ? <p className="text-sm text-fg-subtle">No payments recorded.</p> : (
                <ul className="divide-y divide-line/60 rounded-lg border border-line">
                  {inv.transactions.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1"><span className="block text-fg">{titleCase(t.type)} · {titleCase(t.method)}</span><span className="block text-xs text-fg-subtle">{dateTime(t.createdAt)}{t.failureReason || t.note ? ` · ${t.failureReason || t.note}` : ''}</span></span>
                      {t.status !== 'succeeded' && <StatusBadge status={t.status} />}
                      <span className={`tabular font-medium ${t.type === 'refund' ? 'text-amber-700 dark:text-amber-400' : t.status === 'failed' ? 'text-fg-subtle line-through' : ''}`}>{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</span>
                      {t.type === 'payment' && t.status === 'succeeded' && t.refundedCents < t.amountCents && can('billing.refund') && <Button size="sm" onClick={() => setRefund({ id: t.id, amountCents: t.amountCents, refundedCents: t.refundedCents, method: t.method })}>Refund</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>
      <PayModal invoice={pay} onClose={() => setPay(null)} onDone={changed} />
      <RefundModal transaction={refund} onClose={() => setRefund(null)} onDone={changed} />
      <ConfirmModal open={voiding} onClose={() => setVoiding(false)} onConfirm={doVoid} loading={busy} error={voidError} danger title="Void this invoice?" confirmLabel="Void invoice"><p>The invoice stays on record but nothing is owed on it. This can't be undone.</p></ConfirmModal>
    </>
  )
}

function CreateInvoiceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const { money } = useSession()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 150)
  const { data: matches } = useApi<{ id: string; name: string; email: string }[]>(open && debounced.length >= 2 ? `/api/checkin/lookup?q=${encodeURIComponent(debounced)}` : null)
  const [member, setMember] = useState<{ id: string; name: string } | null>(null)
  const [items, setItems] = useState([{ description: '', quantity: 1, unitPriceCents: 0, taxable: false }])
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setMember(null); setQuery(''); setItems([{ description: '', quantity: 1, unitPriceCents: 0, taxable: false }]); setNotes(''); setDueDate(''); setError(null) } }, [open])
  const total = items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
  const update = (index: number, patch: Partial<(typeof items)[number]>) => setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!member) return setError('Choose a member to bill.')
    setBusy(true)
    setError(null)
    try {
      const created = await api<{ id: string; number: string }>('/api/billing/invoices', { body: { memberId: member.id, items, notes: notes || null, ...(dueDate && { dueDate }) } })
      toast.success(`${created.number} created`)
      onClose()
      onCreated(created.id)
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title="New invoice" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-invoice" loading={busy}>Create invoice for {money(total)}</Button></>}>
      <form id="new-invoice" onSubmit={submit} className="space-y-4">
        <Field label="Bill to" required>
          {member ? (
            <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span className="font-medium text-fg-heading">{member.name}</span><Button size="sm" variant="ghost" onClick={() => setMember(null)}>Change</Button></div>
          ) : (
            <>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members by name or phone" />
              {matches && debounced.length >= 2 && (
                <ul className="mt-1 divide-y divide-line/60 rounded-lg border border-line">
                  {matches.length === 0 ? <li className="px-3 py-2 text-sm text-fg-subtle">No members match.</li> : matches.map((m) => <li key={m.id}><button type="button" onClick={() => setMember(m)} className="ui-focus flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-subtle"><span className="font-medium text-fg-heading">{m.name}</span><span className="text-fg-muted">{m.email}</span></button></li>)}
                </ul>
              )}
            </>
          )}
        </Field>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-fg-muted">Line items</legend>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Input className="col-span-12 sm:col-span-6" value={item.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Description" aria-label={`Item ${i + 1} description`} required />
                <Input className="col-span-3 sm:col-span-1" type="number" min={1} value={item.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value)) })} aria-label={`Item ${i + 1} quantity`} />
                <div className="col-span-5 sm:col-span-3"><MoneyInput cents={item.unitPriceCents} onChange={(c) => update(i, { unitPriceCents: c })} aria-label={`Item ${i + 1} price`} /></div>
                <div className="col-span-3 sm:col-span-1"><Checkbox checked={item.taxable} onChange={(e) => update(i, { taxable: e.target.checked })} label="Tax" /></div>
                <div className="col-span-1 text-right">{items.length > 1 && <IconButton label="Remove line" onClick={() => setItems((list) => list.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></IconButton>}</div>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setItems((list) => [...list, { description: '', quantity: 1, unitPriceCents: 0, taxable: false }])}>Add line</Button>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due date" hint="Leave blank for due today."><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Note on invoice"><Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        </div>
        <FormError message={error} />
      </form>
    </Modal>
  )
}

export default function InvoicesPage() {
  return <Suspense><Invoices /></Suspense>
}
