'use client'

import { useEffect, useState } from 'react'
import { Plus, Tag, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, MoneyInput, Page, PageHeader, Select, SkeletonRows, Table, Td, Th, useToast } from '@/components/ui'

interface Coupon { id: string; code: string; description: string | null; percentOff: number | null; amountOffCents: number | null; appliesTo: string; maxRedemptions: number | null; timesRedeemed: number; expiresAt: string | null; isActive: boolean }

export default function CouponsPage() {
  const toast = useToast()
  const { money, date, can } = useSession()
  const { data, error, loading, reload } = useApi<Coupon[]>('/api/billing/coupons')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Coupon | null>(null)
  const [f, setF] = useState({ code: '', description: '', kind: 'percent', percentOff: 10, amountOffCents: 0, appliesTo: 'all', maxRedemptions: '', expiresAt: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const manage = can('billing.manage')
  useEffect(() => { if (adding) { setF({ code: '', description: '', kind: 'percent', percentOff: 10, amountOffCents: 0, appliesTo: 'all', maxRedemptions: '', expiresAt: '' }); setProblem(null) } }, [adding])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await api('/api/billing/coupons', { body: { code: f.code, description: f.description || null, percentOff: f.kind === 'percent' ? f.percentOff : null, amountOffCents: f.kind === 'amount' ? f.amountOffCents : null, appliesTo: f.appliesTo, maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null, expiresAt: f.expiresAt ? `${f.expiresAt}T23:59:59` : null } })
      toast.success('Offer created')
      setAdding(false)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (c: Coupon) => {
    try {
      await api(`/api/billing/coupons/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } })
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await api(`/api/billing/coupons/${removing.id}`, { method: 'DELETE' })
      toast.success('Offer deleted')
      setRemoving(null)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Offers" description="Coupon codes for memberships and product sales." actions={manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New offer</Button>} />
      <Card padded={false}>
        {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<Tag className="h-5 w-5" />} title="No offers yet" description="Create a code like NEWYEAR20 and apply it when you sell a membership or ring up a sale." action={manage && <Button variant="primary" onClick={() => setAdding(true)}>New offer</Button>} />
        ) : (
          <Table>
            <thead><tr><Th>Code</Th><Th>Discount</Th><Th>Applies to</Th><Th align="right">Redeemed</Th><Th>Expires</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {data.map((c) => {
                const expired = c.expiresAt && new Date(c.expiresAt) < new Date()
                const spent = c.maxRedemptions !== null && c.timesRedeemed >= c.maxRedemptions
                return (
                  <tr key={c.id} className={c.isActive && !expired && !spent ? '' : 'opacity-60'}>
                    <Td><span className="font-mono text-sm font-semibold text-fg-heading">{c.code}</span>{c.description && <span className="block text-xs text-fg-muted">{c.description}</span>}</Td>
                    <Td>{c.percentOff ? `${c.percentOff}% off` : `${money(c.amountOffCents)} off`}</Td>
                    <Td className="capitalize text-fg-muted">{c.appliesTo === 'all' ? 'Everything' : c.appliesTo}</Td>
                    <Td align="right">{c.timesRedeemed}{c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ''}</Td>
                    <Td className="text-fg-muted">{c.expiresAt ? date(c.expiresAt) : 'Never'}</Td>
                    <Td>{expired ? <Badge>Expired</Badge> : spent ? <Badge>Used up</Badge> : c.isActive ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>}</Td>
                    <Td align="right">{manage && <span className="inline-flex items-center gap-1"><Button size="sm" onClick={() => toggle(c)}>{c.isActive ? 'Turn off' : 'Turn on'}</Button><IconButton label={`Delete ${c.code}`} onClick={() => setRemoving(c)}><Trash2 className="h-4 w-4" /></IconButton></span>}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="New offer" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" type="submit" form="coupon" loading={busy}>Create offer</Button></>}>
        <form id="coupon" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} required minLength={3} maxLength={30} placeholder="NEWYEAR20" className="font-mono" /></Field>
          <Field label="Applies to"><Select value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}><option value="all">Everything</option><option value="memberships">Memberships only</option><option value="products">Products only</option></Select></Field>
          <Field label="Discount type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="percent">Percentage off</option><option value="amount">Fixed amount off</option></Select></Field>
          {f.kind === 'percent'
            ? <Field label="Percent off"><Input type="number" min={1} max={100} value={f.percentOff} onChange={(e) => setF({ ...f, percentOff: Number(e.target.value) })} required /></Field>
            : <Field label="Amount off"><MoneyInput cents={f.amountOffCents} onChange={(c) => setF({ ...f, amountOffCents: c })} /></Field>}
          <Field label="Redemption limit" hint="Blank = unlimited."><Input type="number" min={1} value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} /></Field>
          <Field label="Expires" hint="Blank = never."><Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={200} placeholder="20% off the first month" /></Field>
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} loading={busy} danger title={`Delete ${removing?.code}?`} confirmLabel="Delete"><p>Invoices that already used this code keep their discount.</p></ConfirmModal>
    </Page>
  )
}
