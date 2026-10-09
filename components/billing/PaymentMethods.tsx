'use client'

// Saved cards and bank accounts for one member. Used by staff on the member
// profile and by members in their portal: `base` is the API prefix for whoever
// is looking (/api/members/:id or /api/portal/:token).
//
// Card and bank details are typed into Stripe's own fields and go straight to
// Stripe from the browser. ClubCheck only ever receives a reference.

import { useEffect, useMemo, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { CreditCard, Landmark, Plus } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { Badge, Button, ConfirmModal, EmptyState, ErrorState, FormError, Modal, Skeleton, useToast } from '@/components/ui'

export interface SavedMethod {
  id: string
  type: string
  brand: string | null
  bankName: string | null
  last4: string
  expMonth: number | null
  expYear: number | null
  isDefault: boolean
}

interface SetupSession {
  clientSecret: string
  stripeAccountId: string
  publishableKey: string
}

export function methodLabel(m: Pick<SavedMethod, 'type' | 'brand' | 'bankName' | 'last4'>) {
  const name = m.type === 'card' ? (m.brand ? m.brand.charAt(0).toUpperCase() + m.brand.slice(1) : 'Card') : m.bankName || 'Bank account'
  return `${name} ending ${m.last4}`
}

function expired(m: SavedMethod) {
  if (!m.expMonth || !m.expYear) return false
  const now = new Date()
  return m.expYear < now.getFullYear() || (m.expYear === now.getFullYear() && m.expMonth < now.getMonth() + 1)
}

const stripeCache = new Map<string, Promise<Stripe | null>>()
function stripeFor(session: SetupSession) {
  const key = `${session.publishableKey}:${session.stripeAccountId}`
  if (!stripeCache.has(key)) stripeCache.set(key, loadStripe(session.publishableKey, { stripeAccount: session.stripeAccountId }))
  return stripeCache.get(key)!
}

function SetupForm({ base, onSaved, onClose }: { base: string; onSaved: (pending: boolean) => void; onClose: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    const result = await stripe.confirmSetup({ elements, redirect: 'if_required', confirmParams: { return_url: window.location.href } })
    if (result.error) {
      setError(result.error.message || 'That could not be saved. Check the details and try again.')
      setBusy(false)
      return
    }
    try {
      const saved = await api<{ status: 'saved' | 'pending' }>(`${base}/payment-methods/sync`, { body: { setupIntentId: result.setupIntent.id } })
      onSaved(saved.status === 'pending')
    } catch (err) {
      setError((err as ClientError).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!stripe}>Save</Button>
      </div>
    </form>
  )
}

export function AddPaymentMethodModal({ base, open, onClose, onSaved }: { base: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [session, setSession] = useState<SetupSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSession(null)
    setError(null)
    api<SetupSession>(`${base}/payment-methods`, { method: 'POST' })
      .then((s) => { if (!cancelled) setSession(s) })
      .catch((err) => { if (!cancelled) setError((err as ClientError).message) })
    return () => { cancelled = true }
  }, [open, base])

  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const options = useMemo(
    () => session && { clientSecret: session.clientSecret, appearance: { theme: dark ? ('night' as const) : ('stripe' as const), variables: { colorPrimary: '#f59e0b', borderRadius: '8px' } } },
    [session, dark]
  )
  if (!open) return null

  return (
    <Modal open onClose={onClose} title="Add a card or bank account" description="Details are sent securely to Stripe. They are never stored by ClubCheck.">
      {error ? (
        <div className="space-y-4">
          <FormError message={error} />
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : !session || !options ? (
        <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-2/3" /></div>
      ) : (
        <Elements stripe={stripeFor(session)} options={options}>
          <SetupForm
            base={base}
            onClose={onClose}
            onSaved={(pending) => {
              toast.success(pending ? 'Bank account added. It can be used once it has been verified.' : 'Payment method saved')
              onSaved()
              onClose()
            }}
          />
        </Elements>
      )}
    </Modal>
  )
}

export function PaymentMethods({ base, canManage, onChange, unavailableHint }: { base: string; canManage: boolean; onChange?: () => void; unavailableHint?: React.ReactNode }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<{ methods: SavedMethod[]; canCharge?: boolean; canPay?: boolean }>(`${base}/payment-methods`)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<SavedMethod | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const changed = () => { reload(); onChange?.() }

  const makeDefault = async (m: SavedMethod) => {
    setBusy(m.id)
    try {
      await api(`${base}/payment-methods/${m.id}`, { method: 'PATCH' })
      toast.success(`${methodLabel(m)} is now the default`)
      changed()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy('remove')
    setRemoveError(null)
    try {
      await api(`${base}/payment-methods/${removing.id}`, { method: 'DELETE' })
      toast.success('Payment method removed')
      setRemoving(null)
      changed()
    } catch (err) {
      setRemoveError((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
  if (error || !data) return <ErrorState error={error || 'Failed to load'} onRetry={reload} />
  const enabled = data.canCharge ?? data.canPay ?? false

  return (
    <div>
      {data.methods.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-5 w-5" />}
          title="No card or bank account on file"
          description={enabled ? 'Add one so renewals are paid automatically.' : unavailableHint || 'Online payments are not set up for this gym yet.'}
          action={enabled && canManage ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add payment method</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-line">
          {data.methods.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-fg-muted">
                {m.type === 'card' ? <CreditCard className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg-heading">{methodLabel(m)}</p>
                <p className="text-xs text-fg-muted">
                  {m.type === 'card' && m.expMonth && m.expYear ? `Expires ${String(m.expMonth).padStart(2, '0')}/${String(m.expYear).slice(-2)}` : 'Bank debit (ACH)'}
                </p>
              </div>
              {m.isDefault && <Badge tone="green">Default</Badge>}
              {expired(m) && <Badge tone="red">Expired</Badge>}
              {canManage && (
                <div className="flex gap-2">
                  {!m.isDefault && <Button size="sm" loading={busy === m.id} onClick={() => makeDefault(m)}>Make default</Button>}
                  <Button size="sm" onClick={() => setRemoving(m)}>Remove</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.methods.length > 0 && enabled && canManage && (
        <div className="mt-3"><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add another</Button></div>
      )}
      <AddPaymentMethodModal base={base} open={adding} onClose={() => setAdding(false)} onSaved={changed} />
      <ConfirmModal open={!!removing} onClose={() => { setRemoving(null); setRemoveError(null) }} onConfirm={remove} title="Remove this payment method?" confirmLabel="Remove" danger loading={busy === 'remove'} error={removeError}>
        {removing && <p>{methodLabel(removing)} will no longer be charged.{removing.isDefault ? ' Renewals will use another saved method if there is one.' : ''}</p>}
      </ConfirmModal>
    </div>
  )
}
