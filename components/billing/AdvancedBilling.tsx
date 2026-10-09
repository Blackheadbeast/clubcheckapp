'use client'

// Staff screens for the money-moving parts of billing: changing plan (with its preview), account
// credit, and household billing. Every figure shown here comes from the server; nothing is worked
// out in the browser.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, CreditCard, Home, Info, UserPlus } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { planPriceLabel, useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, MoneyInput, SearchInput, Select, SkeletonRows, StatusBadge, Table, Td, Th, cn, useToast } from '@/components/ui'

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-request`)

// ---------------------------------------------------------------------------
// Plan change
// ---------------------------------------------------------------------------

export interface Calc {
  mode: 'keep_billing_date' | 'restart_period' | 'trial' | 'next_period'
  effectiveAt: string
  totalDays: number
  usedDays: number
  remainingDays: number
  oldUnusedCents: number
  newChargeBaseCents: number
  newChargeTaxCents: number
  newChargeCents: number
  netCents: number
  dueBeforeCreditCents: number
  accountCreditAppliedCents: number
  amountDueNowCents: number
  creditCents: number
  creditCarriedCents: number
  nextBillingDate: string
  nextBillingCents: number
  nextBillingAfterCreditCents: number
}

interface PlanRef { id: string; name: string; priceCents: number; label: string }
export interface PlanPreview {
  from: PlanRef
  to: PlanRef
  effective: 'now' | 'next_period'
  allowed: boolean
  blocked: { code: string; message: string } | null
  basis?: { invoiceNumber: string | null; paidCents: number; assumed: boolean; note: string }
  calc: Calc
  payer?: { id: string; name: string; viaHousehold: boolean }
  billedTo?: string | null
  collection: { automatic: boolean; description: string }
  scheduled?: { planId: string; name: string } | null
}

/**
 * The financial effect of a plan change, line by line. Used by the staff dialog and by the member
 * app, so both read the same words for the same numbers.
 */
export function PlanChangeBreakdown({ preview, money, date }: { preview: PlanPreview; money: (c: number) => string; date: (v: string) => string }) {
  const c = preview.calc
  const Row = ({ label, value, hint, strong, tone }: { label: string; value: string; hint?: string; strong?: boolean; tone?: 'credit' | 'due' }) => (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', strong && 'border-t border-line pt-2.5')}>
      <dt className={cn('min-w-0 text-sm', strong ? 'font-semibold text-fg-heading' : 'text-fg-muted')}>{label}{hint && <span className="block text-xs font-normal text-fg-subtle">{hint}</span>}</dt>
      <dd className={cn('tabular shrink-0 text-sm', strong ? 'text-base font-semibold' : 'font-medium', tone === 'credit' ? 'text-emerald-700 dark:text-emerald-400' : 'text-fg-heading')}>{value}</dd>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg border border-line px-2.5 py-1.5"><span className="block text-xs text-fg-muted">Current plan</span><span className="font-medium text-fg-heading">{preview.from.name}</span> <span className="text-fg-muted">{money(preview.from.priceCents)} {preview.from.label}</span></span>
        <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
        <span className="rounded-lg border border-accent/60 px-2.5 py-1.5"><span className="block text-xs text-fg-muted">New plan</span><span className="font-medium text-fg-heading">{preview.to.name}</span> <span className="text-fg-muted">{money(preview.to.priceCents)} {preview.to.label}</span></span>
      </div>
      <dl className="rounded-lg border border-line px-3 py-1.5">
        <Row label="Effective date" value={c.mode === 'next_period' ? date(c.nextBillingDate) : `Today, ${date(c.effectiveAt)}`} />
        {c.mode === 'next_period' ? (
          <Row label="Until then" value={preview.from.name} hint="Nothing is charged or credited now." />
        ) : c.mode === 'trial' ? (
          <Row label="Free trial" value="Nothing to pay yet" hint="The trial carries on. The new plan is billed when it ends." />
        ) : (
          <>
            <Row label="Remaining days" value={`${c.remainingDays} of ${c.totalDays}`} hint={c.mode === 'restart_period' ? 'Left on the current period, which ends today. A new period starts on the new plan.' : 'Left in the current billing period, counting today.'} />
            <Row label={`Unused value of ${preview.from.name}`} value={`−${money(c.oldUnusedCents)}`} hint="Credit for the days they paid for and will not use." tone="credit" />
            <Row label={c.mode === 'restart_period' ? `${preview.to.name}, first full period` : `${preview.to.name} for the remaining days`} value={money(c.newChargeCents)} hint={c.newChargeTaxCents > 0 ? `${money(c.newChargeBaseCents)} plus ${money(c.newChargeTaxCents)} tax` : undefined} />
            {c.accountCreditAppliedCents > 0 && <Row label="Account credit used" value={`−${money(c.accountCreditAppliedCents)}`} tone="credit" />}
            {c.creditCents > 0 && <Row label="Credit added to the account" value={money(c.creditCents)} hint="Kept on account and taken off the next invoice. It is not paid out." tone="credit" />}
          </>
        )}
        <Row label="Amount due now" value={money(c.amountDueNowCents)} strong />
        <Row label="Next billing date" value={date(c.nextBillingDate)} />
        <Row label="Next billing amount" value={money(c.nextBillingCents)} hint={c.creditCarriedCents > 0 && c.nextBillingAfterCreditCents !== c.nextBillingCents ? `${money(c.nextBillingAfterCreditCents)} after ${money(Math.min(c.creditCarriedCents, c.nextBillingCents))} of account credit` : undefined} />
      </dl>
    </div>
  )
}

interface ChangeResult { status: 'applied' | 'scheduled'; amountDueNowCents: number; creditCents: number; toPlan: string; nextBillingDate: string; invoice: { number: string; status: string } | null; charge: { status: string; message: string | null } | null }

export function ChangePlanModal({ membership, onClose, onDone }: { membership: { id: string; planId?: string; planName: string } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { money, date } = useSession()
  const { plans } = useLookups()
  const [planId, setPlanId] = useState('')
  const [effective, setEffective] = useState<'now' | 'next_period'>('now')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<ChangeResult | null>(null)
  // One key per confirmation shown. A second click, or a retry after a dropped connection, is the same change.
  const key = useRef(newKey())
  const url = membership && planId ? `/api/memberships/${membership.id}/plan-change?planId=${planId}&effective=${effective}` : null
  const preview = useApi<PlanPreview>(done ? null : url)
  const history = useApi<{ history: { id: string; from: string; to: string; status: string; effective: string; at: string; byName: string | null; calc: Calc }[] }>(membership && !planId ? `/api/memberships/${membership.id}/plan-change` : null)

  useEffect(() => { setPlanId(''); setEffective('now'); setProblem(null); setDone(null) }, [membership?.id])
  useEffect(() => { key.current = newKey(); setProblem(null) }, [planId, effective])
  if (!membership) return null
  const p = preview.data
  const options = plans.filter((x) => x.type === 'recurring' && x.id !== (p?.from.id || membership.planId))

  const confirm = async () => {
    if (!p) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await api<ChangeResult>(`/api/memberships/${membership.id}/plan-change`, {
        body: { planId, effective, expected: { fromPlanId: p.from.id, amountDueNowCents: p.calc.amountDueNowCents, creditCents: p.calc.creditCents }, idempotencyKey: key.current },
      })
      setDone(result)
      onDone()
    } catch (err) {
      const e = err as ClientError
      setProblem(e.message)
      // The figures moved (a new day, a payment, someone else's change): show the new ones and ask again.
      if (e.code === 'preview_changed' || e.code === 'plan_already_changed') { key.current = newKey(); preview.reload() }
    } finally {
      setBusy(false)
    }
  }
  const withdraw = async () => {
    setBusy(true)
    try {
      await api(`/api/memberships/${membership.id}/plan-change`, { method: 'DELETE' })
      toast.success('Scheduled change withdrawn')
      onDone()
      preview.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={done ? (done.status === 'scheduled' ? 'Change scheduled' : 'Plan changed') : 'Change plan'}
      description={membership.planName}
      footer={done ? <Button variant="primary" onClick={onClose}>Done</Button> : (
        <>
          <Button onClick={onClose} disabled={busy}>Keep as is</Button>
          <Button variant="primary" loading={busy} disabled={!p || !p.allowed || preview.loading || preview.refreshing} onClick={confirm}>
            {!p ? 'Confirm change' : effective === 'next_period' ? `Schedule for ${date(p.calc.nextBillingDate)}` : p.calc.amountDueNowCents > 0 ? `Confirm and charge ${money(p.calc.amountDueNowCents)}` : p.calc.creditCents > 0 ? `Confirm and credit ${money(p.calc.creditCents)}` : 'Confirm change'}
          </Button>
        </>
      )}
    >
      {done ? (
        <div className="space-y-3 text-sm" role="status">
          <p className="flex items-start gap-2 text-fg"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />{done.status === 'scheduled' ? `They move to ${done.toPlan} on ${date(done.nextBillingDate)}. Nothing was charged or credited.` : `They are now on ${done.toPlan}.`}</p>
          {done.status === 'applied' && (
            <ul className="space-y-1 rounded-lg border border-line px-3 py-2 text-fg-muted">
              {done.amountDueNowCents > 0 && <li>Charge: <span className="font-medium text-fg-heading">{money(done.amountDueNowCents)}</span>{done.invoice ? ` on ${done.invoice.number}` : ''}{done.charge?.status === 'succeeded' ? ', paid by saved card' : done.charge?.status === 'processing' ? ', bank payment started' : done.invoice?.status === 'paid' ? ', paid' : ', to be paid'}</li>}
              {done.creditCents > 0 && <li>Credit: <span className="font-medium text-fg-heading">{money(done.creditCents)}</span> added to the account for the next invoice</li>}
              {done.amountDueNowCents === 0 && done.creditCents === 0 && <li>Nothing to pay and no credit.</li>}
              <li>Next billing date: <span className="font-medium text-fg-heading">{date(done.nextBillingDate)}</span></li>
            </ul>
          )}
          {done.charge?.status === 'failed' && <p className="flex items-start gap-2 text-red-700 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />The plan was changed but the card was declined{done.charge.message ? `: ${done.charge.message}` : '.'} The invoice is unpaid and will be retried like any failed payment.</p>}
          {done.charge && ['no_method', 'not_connected'].includes(done.charge.status) && <p className="text-fg-muted">{done.charge.message} Take payment for {done.invoice?.number} from the Billing tab.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New plan">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((x) => <option key={x.id} value={x.id}>{x.name} · {planPriceLabel(x, money)}</option>)}
              </Select>
            </Field>
            <Field label="When">
              <Select value={effective} onChange={(e) => setEffective(e.target.value as 'now' | 'next_period')}>
                <option value="now">Now, charging or crediting the difference</option>
                <option value="next_period">At the next billing date, no proration</option>
              </Select>
            </Field>
          </div>
          {!planId ? (
            history.data && history.data.history.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-fg-muted">Earlier changes</p>
                <ul className="divide-y divide-line/60 rounded-lg border border-line text-sm">
                  {history.data.history.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2"><span className="min-w-0 flex-1 text-fg">{h.from} to {h.to}</span><span className="text-xs text-fg-subtle">{date(h.at)}{h.byName ? ` · ${h.byName}` : ''}{h.status === 'applied' && h.calc.amountDueNowCents ? ` · ${money(h.calc.amountDueNowCents)} charged` : ''}{h.status === 'applied' && h.calc.creditCents ? ` · ${money(h.calc.creditCents)} credit` : ''}</span><StatusBadge status={h.status} /></li>)}
                </ul>
              </div>
            ) : <p className="text-sm text-fg-muted">Choose a plan to see exactly what will be charged or credited before anything changes.</p>
          ) : preview.loading ? <SkeletonRows rows={5} /> : preview.error || !p ? <ErrorState error={preview.error || 'Could not work out the change'} onRetry={preview.reload} /> : (
            <>
              <PlanChangeBreakdown preview={p} money={money} date={date} />
              {p.basis && <p className={cn('flex items-start gap-2 text-xs', p.basis.assumed ? 'text-amber-700 dark:text-amber-400' : 'text-fg-subtle')}><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{p.basis.note}</p>}
              {p.payer?.viaHousehold && <p className="flex items-start gap-2 text-xs text-fg-subtle"><Home className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Billed to {p.payer.name}, who pays for this household. Any credit goes to their account.</p>}
              {p.allowed && <p className="text-xs text-fg-subtle">{p.collection.description}</p>}
              {p.scheduled && <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">A change to {p.scheduled.name} is already scheduled for the next billing date. Confirming replaces it.<Button size="sm" loading={busy} onClick={withdraw}>Withdraw it</Button></p>}
              {!p.allowed && <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{p.blocked?.message}</p>}
            </>
          )}
          <FormError message={problem} />
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Account credit
// ---------------------------------------------------------------------------

interface CreditView {
  balanceCents: number
  unitemisedCents: number
  autoApplyCents: number
  credits: { id: string; originalCents: number; remainingCents: number; usedCents: number; source: string; sourceLabel: string; reason: string | null; autoApply: boolean; createdByName: string | null; createdAt: string; sourceInvoiceNumber: string | null; uses: { id: string; kind: string; amountCents: number; invoiceNumber: string | null; note: string | null; byName: string | null; at: string }[] }[]
}

/** Every credit on a member's account: what it was for, what is left, and where each part went. */
export function CreditsCard({ memberId, onChanged }: { memberId: string; onChanged?: () => void }) {
  const toast = useToast()
  const { can, money, date } = useSession()
  const { data, error, loading, reload } = useApi<CreditView>(`/api/members/${memberId}/credit`)
  const [open, setOpen] = useState<'add' | 'remove' | null>(null)
  const [cents, setCents] = useState(0)
  const [note, setNote] = useState('')
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const key = useRef(newKey())
  const manage = can('billing.refund')
  const start = (kind: 'add' | 'remove') => { setOpen(kind); setCents(0); setNote(''); setAuto(true); setProblem(null); key.current = newKey() }

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api(`/api/members/${memberId}/credit`, { body: { amountCents: open === 'remove' ? -cents : cents, note: note.trim() || null, ...(open === 'add' && { autoApply: auto }), idempotencyKey: key.current } })
      toast.success(open === 'remove' ? `${money(cents)} credit removed` : `${money(cents)} credit added`)
      setOpen(null)
      reload()
      onChanged?.()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const hold = async (creditId: string, autoApply: boolean) => {
    try {
      await api(`/api/members/${memberId}/credit`, { method: 'PATCH', body: { creditId, autoApply } })
      toast.success(autoApply ? 'Credit will be used on the next invoice' : 'Credit held back')
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  return (
    <Card padded={false}>
      <CardHeader
        className="px-4 pt-4 sm:px-5"
        title="Account credit"
        description="Money held on the account. It comes off the next membership invoice unless it is held back. It is never paid out as cash from here."
        action={manage && <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => start('add')}>Add credit</Button>{!!data?.balanceCents && <Button size="sm" onClick={() => start('remove')}>Remove</Button>}</div>}
      />
      {loading ? <SkeletonRows rows={2} /> : error || !data ? <ErrorState error={error || 'Failed to load'} onRetry={reload} /> : (
        <>
          <dl className="grid grid-cols-2 gap-3 px-4 pb-3 text-sm sm:grid-cols-3 sm:px-5">
            <div><dt className="text-fg-muted">Credit available</dt><dd className="tabular text-lg font-semibold text-fg-heading">{money(data.balanceCents)}</dd></div>
            <div><dt className="text-fg-muted">Used automatically</dt><dd className="tabular font-medium text-fg-heading">{money(data.autoApplyCents)}</dd></div>
            <div><dt className="text-fg-muted">Held back</dt><dd className="tabular font-medium text-fg-heading">{money(data.balanceCents - data.autoApplyCents)}</dd></div>
          </dl>
          {data.unitemisedCents > 0 && <p className="px-4 pb-3 text-xs text-fg-subtle sm:px-5">{money(data.unitemisedCents)} was on the account before credits were listed one by one. It is itemised the first time it is used.</p>}
          {data.credits.length === 0 ? (data.unitemisedCents === 0 && <EmptyState title="No credits" description="Credits from plan changes, refunds kept on account and goodwill appear here." />) : (
            <ul className="divide-y divide-line/60 border-t border-line">
              {data.credits.map((c) => (
                <li key={c.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-fg-heading">{c.sourceLabel}</span>
                    {c.remainingCents === 0 ? <Badge>Used up</Badge> : c.autoApply ? <Badge tone="green">Used on next invoice</Badge> : <Badge tone="amber">Held back</Badge>}
                    <span className="ml-auto tabular text-sm text-fg-muted">{money(c.remainingCents)} left of {money(c.originalCents)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">{c.reason ? `${c.reason} · ` : ''}{date(c.createdAt)}{c.createdByName ? ` · ${c.createdByName}` : ''}{c.sourceInvoiceNumber ? ` · ${c.sourceInvoiceNumber}` : ''}</p>
                  {c.uses.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-l-2 border-line pl-3 text-xs text-fg-muted">
                      {c.uses.map((u) => <li key={u.id}>{u.kind === 'removed' ? 'Removed' : 'Applied'} {money(u.amountCents)}{u.invoiceNumber ? ` to ${u.invoiceNumber}` : ''} · {date(u.at)}{u.byName ? ` · ${u.byName}` : ''}{u.note && u.kind === 'removed' ? ` · ${u.note}` : ''}</li>)}
                    </ul>
                  )}
                  {manage && c.remainingCents > 0 && <button type="button" onClick={() => hold(c.id, !c.autoApply)} className="ui-focus mt-1.5 rounded text-xs font-medium text-accent-text hover:underline">{c.autoApply ? 'Hold back from the next invoice' : 'Use on the next invoice'}</button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} size="sm" title={open === 'remove' ? 'Remove account credit' : 'Add account credit'} footer={<><Button onClick={() => setOpen(null)} disabled={busy}>Cancel</Button><Button variant={open === 'remove' ? 'danger' : 'primary'} onClick={save} loading={busy} disabled={cents <= 0 || (open === 'remove' && cents > (data?.balanceCents || 0)) || !note.trim()}>{open === 'remove' ? `Remove ${money(cents)}` : `Add ${money(cents)}`}</Button></>}>
        <div className="space-y-4">
          <Field label="Amount" error={open === 'remove' && cents > (data?.balanceCents || 0) ? `Only ${money(data?.balanceCents || 0)} is available.` : null}><MoneyInput cents={cents} onChange={setCents} /></Field>
          <Field label="Reason" required hint="Shown in the credit history and the audit log."><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={open === 'remove' ? 'Added by mistake…' : 'Goodwill, referral reward…'} maxLength={300} /></Field>
          {open === 'add' && <Checkbox checked={auto} onChange={(e) => setAuto(e.target.checked)} label="Take it off their next membership invoice automatically" />}
          <FormError message={problem} />
        </div>
      </Modal>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

interface HouseholdView {
  id: string
  name: string
  payerMemberId: string | null
  payer: { id: string; name: string | null; paymentMethods: { id: string; type: string; brand: string | null; bankName: string | null; last4: string; isDefault: boolean }[] } | null
  members: { id: string; name: string; photoUrl: string | null; status: string; isPayer: boolean; creditCents: number; amountDueCents: number; paymentProblem: boolean; memberships: { id: string; status: string; priceCents: number; nextBillingDate: string | null; plan: string; interval: string; intervalCount: number; recurring: boolean }[] }[]
  totals: { amountDueCents: number; overdueCents: number; openInvoices: number; creditCents: number; recurringCents: number }
  invoices: { id: string; number: string; status: string; totalCents: number; amountPaidCents: number; refundedCents: number; balanceCents: number; dueDate: string | null; failedAttempts: number; memberId: string | null; memberName: string | null; description: string | null }[]
  payments: { id: string; type: string; status: string; amountCents: number; method: string; cardLast4: string | null; failureReason: string | null; at: string; memberName: string | null; paidByName: string | null; invoiceNumber: string | null }[]
}
interface Found { id: string; name: string; email: string; homeLocation?: unknown }

function MemberPicker({ exclude, onPick, label }: { exclude: string[]; onPick: (m: Found) => void; label: string }) {
  const [q, setQ] = useState('')
  const debounced = useDebounced(q.trim(), 250)
  const { data, loading } = useApi<Found[]>(debounced.length >= 2 ? `/api/members?pageSize=6&search=${encodeURIComponent(debounced)}` : null)
  const hits = (data || []).filter((m) => !exclude.includes(m.id))
  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder={label} />
      {debounced.length >= 2 && (
        <ul className="mt-2 max-h-56 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
          {loading ? <li className="px-3 py-2 text-sm text-fg-muted">Searching…</li> : hits.length === 0 ? <li className="px-3 py-2 text-sm text-fg-muted">No members match.</li> : hits.map((m) => (
            <li key={m.id}><button type="button" onClick={() => { onPick(m); setQ('') }} className="ui-focus flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle/60"><Avatar name={m.name} size="sm" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-fg-heading">{m.name}</span><span className="block truncate text-xs text-fg-muted">{m.email}</span></span></button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Member → Household: who is billed together, who pays, what each is on, and what is owed. */
export function HouseholdTab({ member, onChanged }: { member: { id: string; name: string }; onChanged?: () => void }) {
  const toast = useToast()
  const { money, date, dateTime } = useSession()
  const { data, error, loading, reload } = useApi<{ household: HouseholdView | null; canManage: boolean }>(`/api/members/${member.id}/household`)
  const [creating, setCreating] = useState(false)
  const [payerIsOther, setPayerIsOther] = useState(false)
  const [picked, setPicked] = useState<Found | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<{ action: 'remove' | 'payer' | 'dissolve'; memberId?: string; name?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const h = data?.household || null
  const manage = !!data?.canManage
  const changed = () => { reload(); onChanged?.() }

  const run = async (url: string, body: unknown, done: string) => {
    setBusy(true)
    setProblem(null)
    try {
      await api(url, { body })
      toast.success(done)
      setCreating(false); setAdding(false); setConfirm(null); setPicked(null)
      changed()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const problems = useMemo(() => (h ? h.members.filter((m) => m.paymentProblem) : []), [h])

  if (loading) return <Card padded={false}><SkeletonRows rows={4} /></Card>
  if (error || !data) return <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card>

  if (!h) {
    return (
      <Card>
        <EmptyState
          icon={<Home className="h-5 w-5" />}
          title="Not billed with anyone"
          description={`${member.name}'s invoices are charged to ${member.name}. Put family members in a household to charge them all to one person's card. Each keeps their own membership, bookings and history.`}
          action={manage ? <Button variant="primary" onClick={() => { setCreating(true); setPayerIsOther(false); setPicked(null); setProblem(null) }}>Set up household billing</Button> : undefined}
        />
        <Modal open={creating} onClose={() => setCreating(false)} title="Set up household billing" footer={<><Button onClick={() => setCreating(false)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!picked} onClick={() => run('/api/households', payerIsOther ? { payerMemberId: picked!.id, memberIds: [member.id] } : { payerMemberId: member.id, memberIds: [picked!.id] }, 'Household created')}>Create household</Button></>}>
          <div className="space-y-4">
            <Field label="Who pays?">
              <Select value={payerIsOther ? 'other' : 'self'} onChange={(e) => { setPayerIsOther(e.target.value === 'other'); setPicked(null) }}>
                <option value="self">{member.name} pays for someone else</option>
                <option value="other">Someone else pays for {member.name}</option>
              </Select>
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium text-fg-heading">{payerIsOther ? 'The person who pays' : 'First person they pay for'}</p>
              {picked ? <p className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><Avatar name={picked.name} size="sm" /><span className="min-w-0 flex-1 truncate font-medium text-fg-heading">{picked.name}</span><Button size="sm" onClick={() => setPicked(null)}>Change</Button></p> : <MemberPicker exclude={[member.id]} onPick={setPicked} label="Search members by name" />}
            </div>
            <p className="text-xs text-fg-subtle">From now on, {payerIsOther ? `${member.name}'s` : 'their'} invoices are charged to {payerIsOther ? (picked?.name || 'the payer') : member.name}'s saved card or bank account. Past invoices do not change. You can add more people afterwards.</p>
            <FormError message={problem} />
          </div>
        </Modal>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>A payment from {h.payer?.name || 'the payer'} has failed. Affected: {problems.map((m) => m.name).join(', ')}. Each unpaid invoice is retried on the usual schedule; a working card on the payer fixes them all.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Amount due now', h.totals.amountDueCents, h.totals.openInvoices ? `${h.totals.openInvoices} unpaid invoice${h.totals.openInvoices === 1 ? '' : 's'}` : 'Nothing unpaid'], ['Overdue', h.totals.overdueCents, null], ['Credit on account', h.totals.creditCents, 'Across all members'], ['Recurring charges', h.totals.recurringCents, 'Memberships, per period']] as const).map(([label, cents, hint]) => (
          <div key={label} className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="text-xs text-fg-muted">{label}</p><p className={cn('tabular mt-1 text-lg font-semibold', label === 'Overdue' && cents > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-heading')}>{money(cents)}</p>{hint && <p className="text-xs text-fg-subtle">{hint}</p>}</div>
        ))}
      </div>

      <Card padded={false}>
        <CardHeader
          className="px-4 pt-4 sm:px-5"
          title={h.name}
          description={h.payer ? `${h.payer.name} pays for everyone here. Each person keeps their own membership, bookings, attendance and credits.` : 'No payer is set, so each member is billed directly.'}
          action={manage && <Button size="sm" variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => { setAdding(true); setProblem(null) }}>Add member</Button>}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm sm:px-5">
          <CreditCard className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
          {h.payer && h.payer.paymentMethods.length > 0
            ? <span className="text-fg">Charged to {h.payer.name}'s {h.payer.paymentMethods[0].type === 'us_bank_account' ? `${h.payer.paymentMethods[0].bankName || 'bank account'}` : (h.payer.paymentMethods[0].brand || 'card')} ending {h.payer.paymentMethods[0].last4}</span>
            : <span className="text-amber-700 dark:text-amber-400">{h.payer?.name || 'The payer'} has no card or bank account saved, so nothing can be charged automatically.</span>}
          {h.payer && <Link href={`/members/${h.payer.id}?tab=billing`} className="ui-focus rounded text-xs font-medium text-accent-text hover:underline">Manage payment methods</Link>}
        </div>
        <ul className="divide-y divide-line/60 border-t border-line">
          {h.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
              {/* On a phone the name and plan take the whole row; the amount and the buttons sit underneath. */}
              <div className="flex min-w-0 flex-1 basis-[15rem] items-center gap-3">
              <Avatar name={m.name} src={m.photoUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg-heading"><Link href={`/members/${m.id}`} className="ui-focus rounded hover:underline">{m.name}</Link>{m.isPayer && <Badge tone="blue">Payer</Badge>}{m.paymentProblem && <Badge tone="red">Payment problem</Badge>}</p>
                <p className="text-xs text-fg-muted">{m.memberships.length === 0 ? 'No active membership' : m.memberships.map((x) => `${x.plan} · ${money(x.priceCents)}${x.recurring && x.nextBillingDate ? ` · next bill ${date(x.nextBillingDate)}` : ''}${x.status !== 'active' ? ` · ${x.status.replace('_', ' ')}` : ''}`).join('  |  ')}</p>
              </div>
              </div>
              <div className="ml-auto text-right text-xs text-fg-muted"><p>Amount due <span className={cn('tabular font-medium', m.amountDueCents > 0 ? 'text-fg-heading' : '')}>{money(m.amountDueCents)}</span></p>{m.creditCents > 0 && <p>Credit <span className="tabular font-medium text-emerald-700 dark:text-emerald-400">{money(m.creditCents)}</span></p>}</div>
              {manage && (
                <div className="flex gap-2">
                  {!m.isPayer && <Button size="sm" onClick={() => { setConfirm({ action: 'payer', memberId: m.id, name: m.name }); setProblem(null) }}>Make payer</Button>}
                  <Button size="sm" onClick={() => { setConfirm({ action: 'remove', memberId: m.id, name: m.name }); setProblem(null) }}>Remove</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card padded={false}>
        <CardHeader title="Household invoices" description="Each invoice belongs to the member it is for. The payer is who is charged." className="px-4 pt-4 sm:px-5" />
        {h.invoices.length === 0 ? <EmptyState title="No invoices yet" description="Invoices for everyone in this household appear here." /> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>For</Th><Th>Status</Th><Th>Due</Th><Th align="right">Total</Th><Th align="right">Amount paid</Th><Th align="right">Amount remaining</Th></tr></thead>
            <tbody>
              {h.invoices.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium"><Link href={`/billing/invoices?invoice=${i.id}`} className="ui-focus rounded hover:underline">{i.number}</Link></Td>
                  <Td className="max-w-[14rem]"><span className="block truncate font-medium text-fg-heading">{i.memberName}</span><span className="block truncate text-xs text-fg-muted">{i.description}</span></Td>
                  <Td><StatusBadge status={i.status === 'open' && i.failedAttempts > 0 ? 'failed' : i.status} />{i.refundedCents > 0 && <span className="ml-2 text-xs text-fg-subtle">{money(i.refundedCents)} refunded</span>}</Td>
                  <Td className="text-fg-muted">{date(i.dueDate)}</Td>
                  <Td align="right">{money(i.totalCents)}</Td>
                  <Td align="right">{money(i.amountPaidCents)}</Td>
                  <Td align="right" className={i.balanceCents > 0 ? 'font-medium' : 'text-fg-subtle'}>{money(i.balanceCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader title="Household payment history" className="px-4 pt-4 sm:px-5" />
        {h.payments.length === 0 ? <EmptyState title="No payments yet" description="Payments made for this household appear here." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Type</Th><Th>For</Th><Th>Paid by</Th><Th>Invoice</Th><Th>Status</Th><Th align="right">Amount</Th></tr></thead>
            <tbody>
              {h.payments.map((t) => (
                <tr key={t.id}>
                  <Td className="text-fg-muted">{dateTime(t.at)}</Td>
                  <Td>{t.type === 'refund' ? 'Refund' : 'Charge'}</Td>
                  <Td>{t.memberName}</Td>
                  <Td className="text-fg-muted">{t.paidByName || t.memberName}{t.cardLast4 ? ` · ${t.cardLast4}` : ''}</Td>
                  <Td className="text-fg-muted">{t.invoiceNumber || '—'}</Td>
                  <Td><StatusBadge status={t.status} />{t.failureReason && <span className="ml-2 text-xs text-fg-subtle">{t.failureReason}</span>}</Td>
                  <Td align="right" className={t.type === 'refund' ? 'text-amber-700 dark:text-amber-400' : ''}>{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {manage && <div className="flex justify-end"><Button variant="ghost" className="text-red-600" onClick={() => { setConfirm({ action: 'dissolve' }); setProblem(null) }}>Stop billing these members together</Button></div>}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a member to this household" description={h.payer ? `Their future invoices will be charged to ${h.payer.name}.` : undefined}>
        <div className="space-y-3">
          <MemberPicker exclude={h.members.map((m) => m.id)} label="Search members by name" onPick={(m) => run(`/api/households/${h.id}`, { action: 'add', memberId: m.id }, `${m.name} added`)} />
          <p className="text-xs text-fg-subtle">They keep their own membership, bookings and history. Only who pays changes, and only for invoices from now on.</p>
          <FormError message={problem} />
        </div>
      </Modal>
      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        loading={busy}
        danger={confirm?.action !== 'payer'}
        title={confirm?.action === 'payer' ? `Make ${confirm.name} the payer?` : confirm?.action === 'remove' ? `Remove ${confirm.name} from this household?` : 'Stop billing these members together?'}
        confirmLabel={confirm?.action === 'payer' ? 'Make payer' : confirm?.action === 'remove' ? 'Remove' : 'Close household'}
        onConfirm={() => run(`/api/households/${h.id}`, confirm!.action === 'dissolve' ? { action: 'dissolve' } : { action: confirm!.action, memberId: confirm!.memberId }, confirm!.action === 'payer' ? 'Payer changed' : confirm!.action === 'remove' ? 'Removed from household' : 'Household closed')}
      >
        <p>{confirm?.action === 'payer' ? `From now on every invoice in this household is charged to ${confirm.name}'s saved card or bank account. Invoices already paid stay as they are.` : confirm?.action === 'remove' ? `Their membership, invoices and history are kept. From now on their invoices are charged to them directly.` : 'Each member is billed directly from now on. No invoice, payment or membership is deleted.'}</p>
        {problem && <p className="mt-2 font-medium text-red-600 dark:text-red-400" role="alert">{problem}</p>}
      </ConfirmModal>
    </div>
  )
}
