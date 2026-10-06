'use client'

import { useEffect, useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { PAYMENT_METHOD_LABELS } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Button, Checkbox, Field, FormError, Input, Modal, MoneyInput, Select, useToast } from '@/components/ui'

export interface PayTarget {
  id: string
  number: string
  balanceCents: number
  creditBalanceCents?: number
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

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balanceCents)
      setMethod('cash')
      setNote('')
      setFailed(false)
      setReason('')
      setError(null)
    }
  }, [invoice])

  if (!invoice) return null
  const credit = invoice.creditBalanceCents || 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
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
            {failed ? 'Record failed attempt' : `Record ${money(amount)}`}
          </Button>
        </>
      }
    >
      <form id="pay" onSubmit={submit} className="space-y-4">
        <Field label="Payment method" hint={method === 'card' ? 'ClubCheck does not process cards yet. Run the card on your terminal, then record it here.' : method === 'account_credit' ? `${money(credit)} credit available` : undefined}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(PAYMENT_METHOD_LABELS)
              .filter(([key]) => key !== 'account_credit' || credit > 0)
              .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </Field>
        {!failed && (
          <>
            <Field label="Amount" hint="Enter less than the balance to take a partial payment.">
              <MoneyInput cents={amount} onChange={setAmount} />
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Check number, reference…" maxLength={300} />
            </Field>
          </>
        )}
        <Checkbox checked={failed} onChange={(e) => setFailed(e.target.checked)} label="The payment was declined" />
        {failed && (
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

export function RefundModal({ transaction, onClose, onDone }: { transaction: RefundTarget | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { money } = useSession()
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refundable = transaction ? transaction.amountCents - transaction.refundedCents : 0

  useEffect(() => {
    if (transaction) {
      setAmount(transaction.amountCents - transaction.refundedCents)
      setReason('')
      setError(null)
    }
  }, [transaction])

  if (!transaction) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/api/billing/transactions/${transaction.id}/refund`, { body: { amountCents: amount, reason: reason || null } })
      toast.success(`${money(amount)} refunded`)
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
      title="Refund payment"
      description={`Up to ${money(refundable)} can be refunded`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" type="submit" form="refund" loading={busy} disabled={amount <= 0 || amount > refundable}>Refund {money(amount)}</Button>
        </>
      }
    >
      <form id="refund" onSubmit={submit} className="space-y-4">
        <Field label="Amount" error={amount > refundable ? `The most you can refund is ${money(refundable)}.` : null}>
          <MoneyInput cents={amount} onChange={setAmount} />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        <p className="text-xs text-fg-subtle">
          {transaction.method === 'account_credit'
            ? 'The amount goes back onto the member’s account credit.'
            : 'This records the refund. Return the money to the member the same way they paid (cash drawer or card terminal).'}
        </p>
        <FormError message={error} />
      </form>
    </Modal>
  )
}
