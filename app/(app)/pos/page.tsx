'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Minus, Plus, ShoppingBag, Trash2, UserRound, X } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, EmptyState, ErrorState, FormError, IconButton, Input, MoneyInput, Page, PageHeader, SearchInput, Select, Skeleton, cn, useToast } from '@/components/ui'

interface Product { id: string; name: string; sku: string | null; category: string; priceCents: number; taxRateBps: number; trackInventory: boolean; stock: number }
interface Receipt { number: string; totalCents: number; subtotalCents: number; discountCents: number; taxCents: number }

export default function RegisterPage() {
  const toast = useToast()
  const { money, can, locationId } = useSession()
  const { data, error, loading, reload } = useApi<{ products: Product[] }>('/api/pos/products')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [member, setMember] = useState<{ id: string; name: string } | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const debounced = useDebounced(memberQuery.trim(), 150)
  const { data: matches } = useApi<{ id: string; name: string; photoUrl: string | null }[]>(debounced.length >= 2 ? `/api/checkin/lookup?q=${encodeURIComponent(debounced)}` : null)
  const [method, setMethod] = useState('card')
  const [coupon, setCoupon] = useState('')
  const [discount, setDiscount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const products = data?.products || []
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))), [products])
  const visible = products.filter((p) => (!category || p.category === category) && (!search || `${p.name} ${p.sku || ''}`.toLowerCase().includes(search.toLowerCase())))
  const lines = Object.entries(cart).map(([id, quantity]) => ({ product: products.find((p) => p.id === id)!, quantity })).filter((l) => l.product)
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.product.priceCents, 0)
  const count = lines.reduce((s, l) => s + l.quantity, 0)

  const add = (p: Product, delta = 1) => {
    setReceipt(null)
    setProblem(null)
    setCart((c) => {
      const next = (c[p.id] || 0) + delta
      if (p.trackInventory && next > p.stock) {
        toast.error(p.stock === 0 ? `${p.name} is out of stock` : `Only ${p.stock} of ${p.name} in stock`)
        return c
      }
      const copy = { ...c }
      if (next <= 0) delete copy[p.id]
      else copy[p.id] = next
      return copy
    })
  }

  const charge = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await api<Receipt>('/api/pos/orders', {
        body: { items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })), memberId: member?.id || null, paymentMethod: method, locationId, ...(coupon.trim() && { couponCode: coupon.trim() }), ...(discount > 0 && { discountCents: discount }) },
      })
      setReceipt(result)
      setCart({})
      setCoupon('')
      setDiscount(0)
      setMember(null)
      setMemberQuery('')
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Checkout" description="Ring up drinks, apparel, supplements and gear." actions={<Link href="/pos/orders"><Button>Recent orders</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search products or scan SKU" className="min-w-[12rem] flex-1" />
            <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : error ? (
            <Card><ErrorState error={error} onRetry={reload} /></Card>
          ) : products.length === 0 ? (
            <Card><EmptyState icon={<ShoppingBag className="h-5 w-5" />} title="No products yet" description="Add what you sell at the desk, then ring it up here." action={can('pos.manage') ? <Link href="/pos/products"><Button variant="primary">Add products</Button></Link> : undefined} /></Card>
          ) : visible.length === 0 ? (
            <Card><EmptyState title="No products match" description="Try a different search or category." /></Card>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visible.map((p) => {
                const out = p.trackInventory && p.stock === 0
                const inCart = cart[p.id] || 0
                return (
                  <button key={p.id} type="button" disabled={out} onClick={() => add(p)} className={cn('ui-focus relative rounded-xl border bg-surface p-3 text-left shadow-card transition', out ? 'cursor-not-allowed border-line opacity-50' : 'border-line hover:border-accent active:scale-[0.99]', inCart > 0 && 'border-accent')}>
                    <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-fg-heading">{p.name}</p>
                    <p className="tabular mt-2 text-base font-semibold text-fg-heading">{money(p.priceCents)}</p>
                    <p className={cn('text-xs', out ? 'text-red-600' : p.trackInventory && p.stock <= 5 ? 'text-amber-700 dark:text-amber-400' : 'text-fg-subtle')}>{out ? 'Out of stock' : p.trackInventory ? `${p.stock} in stock` : titleCase(p.category)}</p>
                    {inCart > 0 && <span className="tabular absolute right-2 top-2 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">{inCart}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <Card className="h-fit lg:sticky lg:top-20 lg:col-span-2" padded={false}>
          <div className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold text-fg-heading">Current sale {count > 0 && <span className="font-normal text-fg-subtle">· {count} item{count === 1 ? '' : 's'}</span>}</h2></div>
          {receipt ? (
            <div className="px-4 py-8 text-center" role="status">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
              <p className="mt-2 text-lg font-semibold text-fg-heading">{money(receipt.totalCents)} paid</p>
              <p className="text-sm text-fg-muted">Order {receipt.number}</p>
              <Button className="mt-4" variant="primary" onClick={() => setReceipt(null)}>New sale</Button>
            </div>
          ) : lines.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-subtle">Tap a product to add it.</p>
          ) : (
            <>
              <ul className="divide-y divide-line/60">
                {lines.map(({ product: p, quantity }) => (
                  <li key={p.id} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg-heading">{p.name}</span><span className="tabular block text-xs text-fg-muted">{money(p.priceCents)} each</span></span>
                    <span className="flex items-center rounded-lg border border-line">
                      <IconButton label={`One fewer ${p.name}`} onClick={() => add(p, -1)}><Minus className="h-3.5 w-3.5" /></IconButton>
                      <span className="tabular w-6 text-center text-sm font-medium">{quantity}</span>
                      <IconButton label={`One more ${p.name}`} onClick={() => add(p, 1)}><Plus className="h-3.5 w-3.5" /></IconButton>
                    </span>
                    <span className="tabular w-16 text-right text-sm font-medium">{money(quantity * p.priceCents)}</span>
                    <IconButton label={`Remove ${p.name}`} onClick={() => add(p, -quantity)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                  </li>
                ))}
              </ul>
              <div className="space-y-3 border-t border-line px-4 py-3">
                {member ? (
                  <div className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-sm"><UserRound className="h-4 w-4 text-fg-subtle" /><span className="flex-1 truncate font-medium text-fg-heading">{member.name}</span><IconButton label="Remove member" onClick={() => setMember(null)}><X className="h-3.5 w-3.5" /></IconButton></div>
                ) : (
                  <div>
                    <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Attach a member (optional)" aria-label="Attach a member" />
                    {matches && debounced.length >= 2 && (
                      <ul className="mt-1 divide-y divide-line/60 rounded-lg border border-line">
                        {matches.length === 0 ? <li className="px-3 py-2 text-sm text-fg-subtle">No members match.</li> : matches.slice(0, 4).map((m) => (
                          <li key={m.id}><button type="button" onClick={() => { setMember(m); setMemberQuery('') }} className="ui-focus flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-subtle"><Avatar name={m.name} src={m.photoUrl} size="sm" />{m.name}</button></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code" />
                  {can('billing.refund') ? <MoneyInput cents={discount} onChange={setDiscount} aria-label="Discount" /> : <span />}
                </div>
                <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== 'ach' && (k !== 'account_credit' || member)).map(([k, label]) => <option key={k} value={k}>{k === 'card' ? 'Card (on your terminal)' : label}</option>)}
                </Select>
                <FormError message={problem} />
                <div className="tabular flex items-baseline justify-between text-sm"><span className="text-fg-muted">Subtotal{discount > 0 ? ` (−${money(discount)} discount)` : ''}</span><span className="text-lg font-semibold text-fg-heading">{money(Math.max(0, subtotal - discount))}</span></div>
                <p className="text-xs text-fg-subtle">Tax and coupon discounts are applied when you charge.</p>
                <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={charge}>Charge</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </Page>
  )
}
