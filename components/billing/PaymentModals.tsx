'use client'

import { useEffect, useRef, useState } from 'react'
import { api, ClientError, useApi } from '@/lib/client'
import { PAYMENT_METHOD_LABELS } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Badge, Button, Checkbox, ErrorState, Field, FormError, Input, Modal, MoneyInput, Select, SkeletonRows, StatusBadge, cn, useToast } from '@/components/ui'
import { methodLabel, type SavedMethod } from '@/components/billing/PaymentMethods'

export interface PayTarget {
  id: string
  number: string
  balanceCents: number
  creditBalanceCents?: number
  /** With a member, their saved cards and bank accounts can be charged directly. */
  memberId?: string | null
}

/** Take a payment against an invoice, or log a declined attempt. */
export function PayModal({ invoice, onClose, onDone }: { invoice: PayTarget | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { money, locationId } = useSession()
  const [method, setMethod] = useState('cash')
  const [amount, setAmount] = useState(0)
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saved = useApi<{ methods: SavedMethod[]; canCharge: boolean }>(invoice?.memberId ? `/api/members/${invoice.memberId}/payment-methods` : null)
  const chargeable = saved.data?.canCharge ? saved.data.methods : []
  const savedId = method.startsWith('saved:') ? method.slice(6) : null
  const firstSaved = chargeable[0]?.id

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balanceCents)
      // Default to the card on file when there is one: it is the only option that moves money by itself.
      setMethod(firstSaved ? `saved:${firstSaved}` : 'cash')
      setNote('')
      setFailed(false)
      setReason('')
      setError(null)
    }
  }, [invoice, firstSaved])

  if (!invoice) return null
  const credit = invoice.creditBalanceCents || 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (savedId) {
        const result = await api<{ status: string; message?: string }>(`/api/billing/invoices/${invoice.id}/charge`, { body: { paymentMethodId: savedId } })
        onDone()
        if (result.status === 'failed') {
          setError(result.message || 'The payment was declined.')
          return
        }
        toast.success(result.status === 'processing' ? 'Bank payment started. It will show as paid when it clears.' : `${money(invoice.balanceCents)} charged`)
        onClose()
        return
      }
      await api(`/api/billing/invoices/${invoice.id}/pay`, {
        body: failed ? { method, failed: true, failureReason: reason || 'Payment declined' } : { method, amountCents: amount, note: note || null, locationId },
      })
      toast.success(failed ? 'Failed attempt recorded' : `${money(amount)} payment recorded`)
      onDone()
      onClose()
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Take payment · ${invoice.number}`}
      description={`${money(invoice.balanceCents)} due`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={failed ? 'danger' : 'primary'} type="submit" form="pay" loading={busy}>
            {savedId ? `Charge ${money(invoice.balanceCents)}` : failed ? 'Record failed attempt' : `Record ${money(amount)}`}
          </Button>
        </>
      }
    >
      <form id="pay" onSubmit={submit} className="space-y-4">
        <Field label="Payment method" hint={savedId ? 'Charges the full balance now through Stripe.' : method === 'card' ? 'This only records a card payment you took on your own terminal. To charge through ClubCheck, save a card on the member first.' : method === 'account_credit' ? `${money(credit)} credit available` : undefined}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {chargeable.map((m) => <option key={m.id} value={`saved:${m.id}`}>Charge {methodLabel(m)}{m.isDefault ? ' (default)' : ''}</option>)}
            {Object.entries(PAYMENT_METHOD_LABELS)
              .filter(([key]) => key !== 'account_credit' || credit > 0)
              .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </Field>
        {!failed && !savedId && (
          <>
            <Field label="Amount" hint="Enter less than the balance to take a partial payment.">
              <MoneyInput cents={amount} onChange={setAmount} />
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Check number, reference…" maxLength={300} />
            </Field>
          </>
        )}
        {!savedId && <Checkbox checked={failed} onChange={(e) => setFailed(e.target.checked)} label="The payment was declined" />}
        {failed && !savedId && (
          <Field label="Reason" hint="The membership moves to past due and the member can be notified by automation.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Card declined, insufficient funds…" maxLength={200} />
          </Field>
        )}
        <FormError message={error} />
      </form>
    </Modal>
  )
}

export interface RefundTarget {
  id: string
  amountCents: number
  refundedCents: number
  method: string
}

interface RefundInfo {
  originalCents: number
  refundedCents: number
  refundableCents: number
  status: string
  method: string
  cardLast4: string | null
  at: string
  member: { id: string; name: string } | null
  invoice: { id: string; number: string } | null
  throughProcessor: boolean
  canRefund: boolean
  canKeepAsCredit: boolean
  reasons: { key: string; label: string }[]
  refunds: { id: string; status: string; amountCents: number; toCredit: boolean; reasonLabel: string | null; note: string | null; failureReason: string | null; by: string | null; at: string }[]
}
interface RefundResult { amountCents: number; status: string; destination: string; totalRefundedCents: number; remainingRefundableCents: number }

/**
 * Refund all or part of a payment. Shows what was taken, what has already gone back and what is
 * left, asks for the amount and a reason, and then asks once more before any money moves.
 */
export function RefundModal({ transaction, onClose, onDone }: { transaction: RefundTarget | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { money, dateTime } = useSession()
  const info = useApi<RefundInfo>(transaction ? `/api/billing/transactions/${transaction.id}/refund` : null)
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [destination, setDestination] = useState<'original' | 'credit'>('original')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per refund being confirmed, so a double click or a retry cannot refund twice.
  const key = useRef('')
  // The screen behind is refreshed when this closes, not after each refund: refreshing it straight away
  // would close the dialog before the result and the history could be read.
  const changed = useRef(false)
  const close = () => { if (changed.current) onDone(); changed.current = false; onClose() }
  const d = info.data
  const refundable = d ? d.refundableCents : transaction ? transaction.amountCents - transaction.refundedCents : 0

  useEffect(() => {
    if (transaction) {
      setAmount(transaction.amountCents - transaction.refundedCents)
      setReason(''); setNote(''); setDestination('original'); setConfirming(false); setError(null)
      key.current = `${Date.now()}-${Math.random().toString(36).slice(2)}-refund`
    }
  }, [transaction])
  // Start from what is really left, which may be less than the list this was opened from showed.
  useEffect(() => { if (d) setAmount((a) => Math.min(a || d.refundableCents, d.refundableCents)) }, [d])

  if (!transaction) return null
  const valid = amount > 0 && amount <= refundable && !!reason
  const byCredit = d?.method === 'account_credit'

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<RefundResult>(`/api/billing/transactions/${transaction.id}/refund`, { body: { amountCents: amount, refundReason: reason, note: note.trim() || null, destination, idempotencyKey: key.current } })
      toast.success(result.status === 'pending' ? `${money(result.amountCents)} refund started` : result.destination === 'credit' ? `${money(result.amountCents)} added to account credit` : `${money(result.amountCents)} refunded`)
      changed.current = true
      // Stay open on the history, with a fresh key in case they refund more.
      key.current = `${Date.now()}-${Math.random().toString(36).slice(2)}-refund`
      setConfirming(false); setReason(''); setNote(''); setDestination('original'); setAmount(result.remainingRefundableCents)
      info.reload()
    } catch (err) {
      setError((err as ClientError).message)
      setConfirming(false)
      info.reload()
    } finally {
      setBusy(false)
    }
  }
  const canRefund = !!d?.canRefund && refundable > 0

  return (
    <Modal
      open
      onClose={close}
      title={confirming ? 'Confirm refund' : canRefund ? 'Refund payment' : 'Refunds on this payment'}
      description={d ? `${d.member?.name || 'Walk-in'}${d.invoice ? ` · ${d.invoice.number}` : ''} · paid ${dateTime(d.at)}` : undefined}
      footer={
        !canRefund ? <Button variant="primary" onClick={close}>Close</Button>
        : confirming ? <><Button onClick={() => setConfirming(false)} disabled={busy}>Back</Button><Button variant="danger" loading={busy} onClick={submit}>{destination === 'credit' ? `Move ${money(amount)} to credit` : `Refund ${money(amount)}`}</Button></>
        : <><Button onClick={close}>Close</Button><Button variant="danger" disabled={!valid} onClick={() => { setError(null); setConfirming(true) }}>Review refund</Button></>
      }
    >
      {info.loading ? <SkeletonRows rows={4} /> : info.error || !d ? <ErrorState error={info.error || 'Could not load this payment'} onRetry={info.reload} /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-line p-2"><dd className="tabular text-base font-semibold text-fg-heading">{money(d.originalCents)}</dd><dt className="text-xs text-fg-muted">Original amount</dt></div>
            <div className="rounded-lg border border-line p-2"><dd className="tabular text-base font-semibold text-fg-heading">{money(d.refundedCents)}</dd><dt className="text-xs text-fg-muted">Previously refunded</dt></div>
            <div className="rounded-lg border border-line p-2"><dd className="tabular text-base font-semibold text-fg-heading">{money(refundable)}</dd><dt className="text-xs text-fg-muted">Remaining refundable</dt></div>
          </dl>

          {confirming ? (
            <div className="space-y-2 text-sm" role="status">
              <dl className="rounded-lg border border-line px-3 py-2">
                <div className="flex justify-between py-1"><dt className="text-fg-muted">New refund amount</dt><dd className="tabular font-semibold text-fg-heading">{money(amount)}</dd></div>
                <div className="flex justify-between py-1"><dt className="text-fg-muted">Total refunded after this</dt><dd className="tabular font-medium text-fg-heading">{money(d.refundedCents + amount)} of {money(d.originalCents)}</dd></div>
                <div className="flex justify-between py-1"><dt className="text-fg-muted">Remaining refundable after this</dt><dd className="tabular font-medium text-fg-heading">{money(refundable - amount)}</dd></div>
                <div className="flex justify-between gap-4 py-1"><dt className="text-fg-muted">Reason</dt><dd className="text-right font-medium text-fg-heading">{d.reasons.find((r) => r.key === reason)?.label}{note.trim() ? `: ${note.trim()}` : ''}</dd></div>
              </dl>
              <p className="text-fg-muted">
                {destination === 'credit' ? `${money(amount)} stays with the gym and goes onto ${d.member?.name || 'the member'}'s account credit. No money is sent back.`
                  : byCredit ? 'This was paid with account credit, so it goes back onto account credit.'
                  : d.throughProcessor ? `${money(amount)} is sent back to the ${d.method === 'ach' ? 'bank account' : `card${d.cardLast4 ? ` ending ${d.cardLast4}` : ''}`} through Stripe. This cannot be undone.`
                  : `This only records the refund. Hand ${money(amount)} back the way it was paid (${d.method}).`}
              </p>
            </div>
          ) : canRefund ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Refund amount" error={amount > refundable ? `The most you can refund is ${money(refundable)}.` : null}><MoneyInput cents={amount} onChange={setAmount} /></Field>
                <Field label="Reason" required>
                  <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">Choose…</option>
                    {d.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Note" hint="Optional. Kept with the refund and in the audit log."><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
              {!byCredit && d.canKeepAsCredit && (
                <Field label="Where the money goes">
                  <Select value={destination} onChange={(e) => setDestination(e.target.value as 'original' | 'credit')}>
                    <option value="original">{d.throughProcessor ? `Back to the ${d.method === 'ach' ? 'bank account' : 'card'} it was paid with` : 'Back to the member (recorded only)'}</option>
                    <option value="credit">Keep it on their account as credit</option>
                  </Select>
                </Field>
              )}
              <p className="text-xs text-fg-subtle">Total refunded after this: {money(d.refundedCents + Math.max(0, Math.min(amount, refundable)))} of {money(d.originalCents)}.</p>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{refundable === 0 ? (d.status === 'succeeded' ? 'This payment has been refunded in full.' : 'This payment did not go through, so there is nothing to refund.') : 'You do not have permission to issue refunds.'}</p>
          )}
          <FormError message={error} />

          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Refund history</p>
            {d.refunds.length === 0 ? <p className="text-sm text-fg-subtle">No refunds on this payment yet.</p> : (
              <ul className="divide-y divide-line/60 rounded-lg border border-line text-sm">
                {d.refunds.map((r) => (
                  <li key={r.id} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('tabular font-medium', r.status === 'failed' ? 'text-fg-subtle line-through' : 'text-fg-heading')}>{money(r.amountCents)}</span>
                      <StatusBadge status={r.status} />
                      {r.toCredit && <Badge>To account credit</Badge>}
                      <span className="ml-auto text-xs text-fg-subtle">{dateTime(r.at)}{r.by ? ` · ${r.by}` : ''}</span>
                    </div>
                    {(r.reasonLabel || r.note || r.failureReason) && <p className="mt-0.5 text-xs text-fg-muted">{[r.reasonLabel, r.note, r.failureReason].filter(Boolean).join(' · ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
