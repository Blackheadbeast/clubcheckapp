'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, MoneyInput, Page, PageHeader, SearchInput, Select, SkeletonRows, Stat, Table, Td, Th, useToast } from '@/components/ui'

interface Product { id: string; name: string; sku: string | null; category: string; priceCents: number; costCents: number; taxRateBps: number; trackInventory: boolean; stock: number; lowStockThreshold: number; isActive: boolean }
interface Summary { products: number; lowStock: number; outOfStock: number; costValueCents: number; retailValueCents: number }
const CATEGORIES = ['apparel', 'supplements', 'drinks', 'equipment', 'merchandise', 'other']
const EMPTY = { name: '', sku: '', category: 'other', priceCents: 0, costCents: 0, taxRateBps: 0, trackInventory: true, stock: 0, lowStockThreshold: 5, isActive: true }

function Products() {
  const params = useSearchParams()
  const toast = useToast()
  const { money, dateTime } = useSession()
  const [search, setSearch] = useState(params.get('q') || '')
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState(params.get('stock') || '')
  const [showRetired, setShowRetired] = useState(false)
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useApi<{ products: Product[]; summary: Summary | null }>(`/api/pos/products${qs({ q: debounced, category, stock, all: showRetired ? 1 : null })}`)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [f, setF] = useState(EMPTY)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [adjust, setAdjust] = useState({ mode: 'restock', quantity: '', note: '' })
  const history = useApi<{ adjustments: { id: string; delta: number; reason: string; note: string | null; staffName: string | null; createdAt: string }[] }>(adjusting ? `/api/pos/products/${adjusting.id}` : null)
  const [removing, setRemoving] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) return
    setProblem(null)
    setF(editing === 'new' ? EMPTY : { ...editing, sku: editing.sku || '' })
  }, [editing])
  useEffect(() => { if (adjusting) { setAdjust({ mode: 'restock', quantity: '', note: '' }); setProblem(null) } }, [adjusting])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const { stock: opening, ...rest } = f
      const body = { ...rest, sku: f.sku || null }
      if (editing === 'new') await api('/api/pos/products', { body: { ...body, stock: opening } })
      else await api(`/api/pos/products/${(editing as Product).id}`, { method: 'PATCH', body })
      toast.success('Product saved')
      setEditing(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const applyAdjust = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adjusting) return
    const quantity = parseInt(adjust.quantity, 10) || 0
    setBusy(true)
    setProblem(null)
    try {
      const delta = adjust.mode === 'restock' ? quantity : adjust.mode === 'shrinkage' ? -quantity : quantity - adjusting.stock
      const result = await api<{ stock: number }>(`/api/pos/products/${adjusting.id}`, { body: { delta, reason: adjust.mode === 'count' ? 'adjustment' : adjust.mode, note: adjust.note || null } })
      toast.success(`${adjusting.name}: ${result.stock} in stock`)
      setAdjusting(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const result = await api<{ archived: boolean }>(`/api/pos/products/${removing.id}`, { method: 'DELETE' })
      toast.success(result.archived ? `${removing.name} retired. Past sales are kept.` : `${removing.name} deleted`)
      setRemoving(null)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const s = data?.summary

  return (
    <Page>
      <PageHeader title="Products & inventory" actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add product</Button>} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Products" value={s.products} />
          <Stat label="Low stock" value={s.lowStock} hint={`${s.outOfStock} out of stock`} />
          <Stat label="Stock value at cost" value={money(s.costValueCents)} />
          <Stat label="Stock value at retail" value={money(s.retailValueCents)} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or SKU" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
        <Select aria-label="Stock" value={stock} onChange={(e) => setStock(e.target.value)} className="w-auto"><option value="">Any stock level</option><option value="low">Low or out of stock</option></Select>
        <Checkbox checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} label="Show retired" />
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.products.length === 0 ? (
          <EmptyState icon={<Package className="h-5 w-5" />} title={debounced || category || stock ? 'No products match' : 'No products yet'} description="Add apparel, supplements, drinks and gear to sell at the desk." action={!debounced && !category && !stock ? <Button variant="primary" onClick={() => setEditing('new')}>Add product</Button> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Product</Th><Th>Category</Th><Th align="right">Price</Th><Th align="right">Cost</Th><Th align="right">Margin</Th><Th align="right">In stock</Th><Th /></tr></thead>
            <tbody>
              {data.products.map((p) => {
                const low = p.trackInventory && p.stock <= p.lowStockThreshold
                return (
                  <tr key={p.id} className={p.isActive ? '' : 'opacity-60'}>
                    <Td><span className="font-medium text-fg-heading">{p.name}</span> {!p.isActive && <Badge>Retired</Badge>}{p.sku && <span className="block font-mono text-xs text-fg-subtle">{p.sku}</span>}</Td>
                    <Td className="text-fg-muted">{titleCase(p.category)}</Td>
                    <Td align="right">{money(p.priceCents)}</Td>
                    <Td align="right" className="text-fg-muted">{p.costCents ? money(p.costCents) : '—'}</Td>
                    <Td align="right" className="text-fg-muted">{p.costCents && p.priceCents ? `${Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100)}%` : '—'}</Td>
                    <Td align="right">{p.trackInventory ? <span className="inline-flex items-center gap-2">{low && <Badge tone={p.stock === 0 ? 'red' : 'amber'}>{p.stock === 0 ? 'Out' : 'Low'}</Badge>}<span className="font-medium">{p.stock}</span></span> : <span className="text-fg-subtle">Not tracked</span>}</Td>
                    <Td align="right"><span className="inline-flex items-center gap-1">{p.trackInventory && p.isActive && <Button size="sm" onClick={() => setAdjusting(p)}>Adjust stock</Button>}<IconButton label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></IconButton>{p.isActive && <IconButton label={`Remove ${p.name}`} onClick={() => setRemoving(p)}><Trash2 className="h-4 w-4" /></IconButton>}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add product' : 'Edit product'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="product" loading={busy}>Save</Button></>}>
        <form id="product" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></Field>
          <Field label="SKU / barcode"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} maxLength={40} className="font-mono" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
          <Field label="Price"><MoneyInput cents={f.priceCents} onChange={(c) => setF({ ...f, priceCents: c })} /></Field>
          <Field label="Cost" hint="What you pay for it."><MoneyInput cents={f.costCents} onChange={(c) => setF({ ...f, costCents: c })} /></Field>
          <Field label="Tax rate (%)" hint="0 uses your default rate."><Input type="number" min={0} max={30} step={0.01} value={f.taxRateBps / 100 || ''} onChange={(e) => setF({ ...f, taxRateBps: Math.round((parseFloat(e.target.value) || 0) * 100) })} placeholder="0" /></Field>
          <Field label="Low-stock alert at"><Input type="number" min={0} value={f.lowStockThreshold} onChange={(e) => setF({ ...f, lowStockThreshold: Number(e.target.value) })} disabled={!f.trackInventory} /></Field>
          {editing === 'new' && f.trackInventory && <Field label="Opening stock"><Input type="number" min={0} value={f.stock} onChange={(e) => setF({ ...f, stock: Number(e.target.value) })} /></Field>}
          <div className="space-y-2 sm:col-span-2">
            <Checkbox checked={f.trackInventory} onChange={(e) => setF({ ...f, trackInventory: e.target.checked })} label="Track stock for this product" />
            {editing !== 'new' && <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Available for sale" />}
          </div>
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>

      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title={`Adjust stock · ${adjusting?.name || ''}`} description={`${adjusting?.stock ?? 0} on hand`} footer={<><Button onClick={() => setAdjusting(null)}>Cancel</Button><Button variant="primary" type="submit" form="adjust" loading={busy} disabled={adjust.quantity === ''}>Save</Button></>}>
        <form id="adjust" onSubmit={applyAdjust} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What happened"><Select value={adjust.mode} onChange={(e) => setAdjust({ ...adjust, mode: e.target.value })}><option value="restock">Received stock</option><option value="shrinkage">Lost, damaged or given away</option><option value="count">Counted the shelf</option></Select></Field>
            <Field label={adjust.mode === 'count' ? 'Actual count' : 'Quantity'}><Input type="number" min={adjust.mode === 'count' ? 0 : 1} value={adjust.quantity} onChange={(e) => setAdjust({ ...adjust, quantity: e.target.value })} required autoFocus /></Field>
          </div>
          <Field label="Note"><Input value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} maxLength={200} placeholder="Supplier, PO number…" /></Field>
          <FormError message={problem} />
          {history.data && history.data.adjustments.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-fg-muted">Recent movements</p>
              <ul className="max-h-40 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line text-sm">
                {history.data.adjustments.map((a) => <li key={a.id} className="flex items-center gap-3 px-3 py-1.5"><span className={`tabular w-10 font-medium ${a.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg'}`}>{a.delta > 0 ? '+' : ''}{a.delta}</span><span className="flex-1 truncate text-fg-muted">{titleCase(a.reason)}{a.note ? ` · ${a.note}` : ''}</span><span className="text-xs text-fg-subtle">{dateTime(a.createdAt)}</span></li>)}
              </ul>
            </div>
          )}
        </form>
      </Modal>
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} loading={busy} danger title={`Remove ${removing?.name}?`} confirmLabel="Remove"><p>Products that have been sold are retired rather than deleted, so past orders and reports stay accurate.</p></ConfirmModal>
    </Page>
  )
}

export default function ProductsPage() {
  return <Suspense><Products /></Suspense>
}
