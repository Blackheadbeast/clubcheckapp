'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api, ClientError, useApi } from '@/lib/client'
import { PAYMENT_METHOD_LABELS, planPriceLabel, useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Button, Checkbox, Field, FormError, Input, Modal, Select, useToast } from '@/components/ui'

const TYPE_LABELS: Record<string, string> = {
  recurring: 'Memberships', class_pack: 'Class packs', drop_in: 'Drop-ins', trial: 'Trials', free: 'Free', pt_package: 'Personal training',
}

export function SellMembershipModal({ memberId, memberName, open, onClose, onDone }: { memberId: string; memberName: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { money, locationId } = useSession()
  const { plans, ready } = useLookups()
  const [planId, setPlanId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [startDate, setStartDate] = useState('')
  const [discount, setDiscount] = useState('')
  const [coupon, setCoupon] = useState('')
  const [collectNow, setCollectNow] = useState(true)
  const [skipTrial, setSkipTrial] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPlanId('')
      setDiscount('')
      setCoupon('')
      setStartDate('')
      setSkipTrial(false)
      setCollectNow(true)
      setError(null)
    }
  }, [open])

  const plan = plans.find((p) => p.id === planId)
  const grouped = useMemo(() => {
    const out: Record<string, typeof plans> = {}
    for (const p of plans) (out[p.type] ||= []).push(p)
    return out
  }, [plans])

  const pct = Math.min(100, Math.max(0, parseInt(discount || '0', 10) || 0))
  const inTrial = !!plan && plan.type === 'recurring' && plan.trialDays > 0 && !skipTrial
  const dueToday = plan ? (inTrial ? 0 : Math.round((plan.priceCents * (100 - pct)) / 100)) + (plan.type === 'recurring' ? plan.enrollmentFeeCents : 0) : 0
  const onFile = paymentMethod === 'card' || paymentMethod === 'ach'
  const saved = useApi<{ methods: { id: string; type: string }[]; canCharge: boolean }>(open ? `/api/members/${memberId}/payment-methods` : null)
  const canChargeSaved = !!saved.data?.canCharge && saved.data.methods.some((m) => (paymentMethod === 'ach' ? m.type === 'us_bank_account' : true))
  const canCollect = dueToday > 0 && (!onFile || canChargeSaved)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ invoice: { number: string; status: string; totalCents: number } | null; charge: { status: string; message: string | null } | null }>(`/api/members/${memberId}/memberships`, {
        body: {
          planId, paymentMethod, locationId,
          ...(startDate && { startDate }),
          ...(pct > 0 && { discountPercent: pct }),
          ...(coupon.trim() && { couponCode: coupon.trim() }),
          collectNow: canCollect && collectNow,
          skipTrial,
        },
      })
      if (result.charge?.status === 'failed') toast.error(`${plan.name} sold, but the charge failed: ${result.charge.message || 'declined'}. ${result.invoice?.number} is open.`)
      else toast.success(result.invoice ? `${plan.name} sold · ${result.invoice.number} ${result.invoice.status === 'paid' ? 'paid' : result.charge?.status === 'processing' ? 'bank payment started' : 'is open'}` : `${plan.name} started`)
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
      open={open}
      onClose={onClose}
      title="Sell membership"
      description={`For ${memberName}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="sell" loading={busy} disabled={!plan}>
            {plan ? (dueToday > 0 ? (canCollect && collectNow ? `Sell & collect ${money(dueToday)}` : `Sell & invoice ${money(dueToday)}`) : 'Start membership') : 'Choose a plan'}
          </Button>
        </>
      }
    >
      {ready && plans.length === 0 ? (
        <p className="text-sm text-fg-muted">
          You haven't set up any membership plans yet. <Link href="/memberships" className="font-medium text-accent-text underline">Create your first plan</Link>.
        </p>
      ) : (
        <form id="sell" onSubmit={submit} className="space-y-4">
          <Field label="Plan" required>
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
              <option value="">Choose…</option>
              {Object.entries(grouped).map(([type, list]) => (
                <optgroup key={type} label={TYPE_LABELS[type] || type}>
                  {list.map((p) => <option key={p.id} value={p.id}>{p.name} — {planPriceLabel(p, money)}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          {plan && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start date" hint="Leave blank to start today.">
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label={plan.type === 'recurring' ? 'Renewals paid by' : 'Paid by'}>
                  <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== 'account_credit').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </Select>
                </Field>
                {plan.priceCents > 0 && (
                  <>
                    <Field label="Ongoing discount %" hint={plan.type === 'recurring' ? 'Applies to every renewal.' : undefined}>
                      <Input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="0" />
                    </Field>
                    <Field label="Coupon code" hint="One-time, on the first invoice.">
                      <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
                    </Field>
                  </>
                )}
              </div>
              {plan.type === 'recurring' && plan.trialDays > 0 && (
                <Checkbox checked={skipTrial} onChange={(e) => setSkipTrial(e.target.checked)} label={`Skip the ${plan.trialDays}-day free trial and bill today`} />
              )}
              <div className="rounded-lg border border-line bg-subtle/50 p-3 text-sm">
                <div className="flex justify-between"><span className="text-fg-muted">Due today</span><span className="tabular font-semibold text-fg-heading">{money(dueToday)}</span></div>
                {inTrial && <p className="mt-1 text-xs text-fg-subtle">Free for {plan.trialDays} days, then {planPriceLabel(plan, money)}.</p>}
                {plan.type === 'recurring' && plan.enrollmentFeeCents > 0 && <p className="mt-1 text-xs text-fg-subtle">Includes a {money(plan.enrollmentFeeCents)} enrollment fee.</p>}
                {plan.contractMonths > 0 && <p className="mt-1 text-xs text-fg-subtle">{plan.contractMonths}-month contract.</p>}
              </div>
              {dueToday > 0 && (
                onFile && !canChargeSaved
                  ? <p className="text-xs text-fg-subtle">There is no saved {paymentMethod === 'ach' ? 'bank account' : 'card'} to charge yet, so the invoice will be left open. Add one under Billing on the member's profile and it will be charged automatically.</p>
                  : <Checkbox checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} label={onFile ? `Charge ${money(dueToday)} to the saved ${paymentMethod === 'ach' ? 'bank account' : 'card'} now` : `Payment of ${money(dueToday)} received now`} />
              )}
            </>
          )}
          <FormError message={error} />
        </form>
      )}
    </Modal>
  )
}

export interface MembershipRef {
  id: string
  planName: string
  status: string
  currentPeriodEnd: string | null
  contractEndsAt: string | null
}

export function MembershipActionModal({
  action,
  membership,
  onClose,
  onDone,
}: {
  action: 'freeze' | 'cancel' | 'change_plan' | null
  membership: MembershipRef | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const { date, money } = useSession()
  const { plans } = useLookups()
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [when, setWhen] = useState<'period_end' | 'now'>('period_end')
  const [override, setOverride] = useState(false)
  const [needsOverride, setNeedsOverride] = useState(false)
  const [planId, setPlanId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setUntil('')
    setReason('')
    setWhen('period_end')
    setOverride(false)
    setNeedsOverride(false)
    setPlanId('')
    setError(null)
  }, [action, membership?.id])

  if (!action || !membership) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body =
        action === 'freeze' ? { action, until: until || null, reason: reason || null }
        : action === 'cancel' ? { action, when, reason: reason || null, override }
        : { action, planId }
      const result = await api<{ immediate: boolean | null; effective: string | null }>(`/api/memberships/${membership.id}`, { body })
      toast.success(
        action === 'freeze' ? 'Membership frozen'
        : action === 'change_plan' ? 'Plan changed'
        : result.immediate ? 'Membership cancelled' : `Cancellation scheduled for ${date(result.effective)}`
      )
      onDone()
      onClose()
    } catch (err) {
      const e = err as ClientError
      if (e.code === 'under_contract') setNeedsOverride(true)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const title = action === 'freeze' ? 'Freeze membership' : action === 'cancel' ? 'Cancel membership' : 'Change plan'
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={membership.planName}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Keep as is</Button>
          <Button variant={action === 'cancel' ? 'danger' : 'primary'} type="submit" form="membership-action" loading={busy} disabled={action === 'change_plan' && !planId}>{title}</Button>
        </>
      }
    >
      <form id="membership-action" onSubmit={submit} className="space-y-4">
        {action === 'freeze' && (
          <>
            <Field label="Freeze until" hint="Billing pauses while frozen. Leave blank to freeze for the longest the plan allows.">
              <Input type="date" value={until} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
            </Field>
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Injury, travel…" maxLength={300} /></Field>
          </>
        )}
        {action === 'cancel' && (
          <>
            <Field label="When">
              <Select value={when} onChange={(e) => setWhen(e.target.value as 'period_end' | 'now')}>
                <option value="period_end">At the end of the current period{membership.currentPeriodEnd ? ` (${date(membership.currentPeriodEnd)})` : ''}</option>
                <option value="now">Immediately</option>
              </Select>
            </Field>
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Moving, cost, not using it…" maxLength={300} /></Field>
            {needsOverride && <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} label="Override the contract and notice period" />}
            <p className="text-xs text-fg-subtle">Unpaid invoices stay open, and any upcoming class bookings on this membership are released when it ends.</p>
          </>
        )}
        {action === 'change_plan' && (
          <Field label="New plan" hint="The new price starts at the next billing date. Nothing is prorated.">
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
              <option value="">Choose…</option>
              {plans.filter((p) => p.type === 'recurring').map((p) => <option key={p.id} value={p.id}>{p.name} — {planPriceLabel(p, money)}</option>)}
            </Select>
          </Field>
        )}
        <FormError message={error} />
      </form>
    </Modal>
  )
}
