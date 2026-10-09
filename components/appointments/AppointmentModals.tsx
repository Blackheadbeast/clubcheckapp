'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Checkbox, ErrorState, Field, FormError, Input, Modal, Select, SkeletonRows, StatusBadge, Textarea, useToast } from '@/components/ui'
import { AttachWorkout } from '@/components/coaching/shared'
import { SlotPicker, type PickedSlot } from './SlotPicker'

export interface TypeOption {
  id: string; name: string; description: string | null; color: string; durationMin: number; paymentMode: 'included' | 'credit' | 'paid'; priceCents: number
  creditsRequired: number; cancelWindowHours: number; minNoticeMinutes: number; maxAdvanceDays: number; isActive: boolean; memberBookable: boolean
  staff: { id: string; name: string }[]; appointmentCount: number
}

export function costLabel(t: Pick<TypeOption, 'paymentMode' | 'priceCents' | 'creditsRequired'>, money: (c: number) => string) {
  return t.paymentMode === 'paid' ? money(t.priceCents) : t.paymentMode === 'credit' ? `${t.creditsRequired} session credit${t.creditsRequired === 1 ? '' : 's'}` : 'Included'
}

interface Hit { type: string; id: string; title: string; subtitle: string }

/** Staff book a member in: who, what, with whom, when. */
export function BookAppointmentModal({ open, onClose, onDone, member, initialStaffId }: { open: boolean; onClose: () => void; onDone: () => void; member?: { id: string; name: string } | null; initialStaffId?: string }) {
  const toast = useToast()
  const { gym, money, user } = useSession()
  const types = useApi<TypeOption[]>(open ? '/api/appointments/types' : null)
  const [who, setWho] = useState<{ id: string; name: string } | null>(member || null)
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const hits = useApi<Hit[]>(open && !who && term.trim().length >= 2 ? `/api/search?q=${encodeURIComponent(term.trim())}` : null)
  const [typeId, setTypeId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [override, setOverride] = useState(false)
  const [slot, setSlot] = useState<PickedSlot | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ownDiary = user.role === 'coach' || user.role === 'trainer'

  useEffect(() => {
    if (open) { setWho(member || null); setSearch(''); setTypeId(''); setStaffId(initialStaffId || ''); setOverride(false); setSlot(null); setNotes(''); setProblem(null) }
  }, [open, member, initialStaffId])

  const type = types.data?.find((t) => t.id === typeId)
  const coaches = type ? type.staff.filter((s) => !ownDiary || s.id === user.id) : []

  const submit = async () => {
    if (!who || !type || !slot) return
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ staff: { name: string }; creditsRemaining: number | null; payment: { status: string } }>('/api/appointments', {
        body: { typeId: type.id, memberId: who.id, staffId: staffId || null, startsAt: slot.startsAt, notes: notes || null, ...(override && { override: true }) },
      })
      toast.success(`Booked with ${r.staff.name}${r.creditsRemaining !== null ? ` · ${r.creditsRemaining} session${r.creditsRemaining === 1 ? '' : 's'} remaining` : r.payment.status === 'due' ? ' · invoice open, take payment at the desk' : r.payment.status === 'succeeded' ? ' · card charged' : ''}`)
      onDone()
      onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Book an appointment" size="lg" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!who || !type || !slot} onClick={submit}>{slot ? `Book ${new Date(slot.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: gym.timezone })}` : 'Book'}</Button></>}>
      <div className="space-y-4">
        {who ? (
          <div className="flex items-center justify-between rounded-lg border border-line bg-subtle/50 px-3 py-2 text-sm"><span><span className="text-fg-muted">Member</span> <span className="font-medium text-fg-heading">{who.name}</span></span>{!member && <button type="button" className="ui-focus rounded text-xs font-medium text-accent-text hover:underline" onClick={() => setWho(null)}>Change</button>}</div>
        ) : (
          <Field label="Member">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden /><Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or phone" className="pl-9" /></div>
            {term.trim().length >= 2 && (
              <ul className="mt-1 overflow-hidden rounded-lg border border-line">
                {hits.loading ? <li className="px-3 py-2 text-sm text-fg-muted">Searching…</li> : (hits.data || []).filter((h) => h.type === 'member').length === 0 ? <li className="px-3 py-2 text-sm text-fg-muted">No members match.</li> : (hits.data || []).filter((h) => h.type === 'member').map((h) => (
                  <li key={h.id}><button type="button" onClick={() => setWho({ id: h.id, name: h.title })} className="ui-focus flex w-full flex-col px-3 py-2 text-left hover:bg-subtle"><span className="text-sm font-medium text-fg-heading">{h.title}</span><span className="text-xs text-fg-muted">{h.subtitle}</span></button></li>
                ))}
              </ul>
            )}
          </Field>
        )}
        {types.error ? <ErrorState error={types.error} onRetry={types.reload} /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Appointment">
              <Select value={typeId} onChange={(e) => { setTypeId(e.target.value); setStaffId(initialStaffId || '') }}>
                <option value="">{types.loading ? 'Loading…' : 'Choose…'}</option>
                {(types.data || []).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.durationMin} min · {costLabel(t, money)}</option>)}
              </Select>
            </Field>
            <Field label="With">
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!type}>
                {!ownDiary && <option value="">Any available</option>}
                {coaches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {types.data && types.data.length === 0 && <p className="text-sm text-fg-muted">No appointment types yet. <Link href="/appointments/types" className="font-medium text-accent-text hover:underline">Create one</Link> first.</p>}
        {type && coaches.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-400">No one offers {type.name} yet. Add staff to it under Appointment types.</p>}
        {type && who && coaches.length > 0 && (
          <>
            <SlotPicker tz={gym.timezone} value={slot} onChange={setSlot} days={Math.min(42, override ? 42 : type.maxAdvanceDays + 1)} slotsUrl={(date) => `/api/appointments/slots${qs({ typeId: type.id, date, staffId: staffId || (ownDiary ? user.id : ''), memberId: who.id, override: override ? 1 : null })}`} />
            <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} label="Ignore minimum notice and the advance limit (clashes are never allowed)" />
            <Field label="Note for the member (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
          </>
        )}
        <FormError message={problem} />
      </div>
    </Modal>
  )
}

interface Detail {
  id: string; status: string; startsAt: string; endsAt: string; late: boolean; paymentMode: string; priceCents: number; creditsUsed: number; creditsReturned: boolean
  cancelWindowHours: number; notes: string | null; staffNotes: string | null; source: string; bookedByName: string | null; rescheduleCount: number; previousStartsAt: string | null; cancelReason: string | null
  type: { id: string; name: string; color: string; durationMin: number }
  staff: { id: string; name: string }
  member: { id: string; name: string; email: string; phone: string | null }
  location: { id: string; name: string } | null
  membership: { id: string; creditsRemaining: number | null; plan: { name: string } } | null
  invoice: { id: string; number: string; status: string; totalCents: number; amountPaidCents: number } | null
  workout?: { id: string; name: string } | null
}

/** Everything staff do to one appointment: move it, cancel it, record what happened, keep notes. */
export function AppointmentDetailModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { gym, can, dateTime, time, money } = useSession()
  const { data, error, loading, reload } = useApi<Detail>(id ? `/api/appointments/${id}` : null)
  const [mode, setMode] = useState<'view' | 'move' | 'cancel'>('view')
  const [slot, setSlot] = useState<PickedSlot | null>(null)
  const [override, setOverride] = useState(false)
  const [reason, setReason] = useState('')
  const [waive, setWaive] = useState(false)
  const [staffNotes, setStaffNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const manage = can('appointments.manage')

  useEffect(() => { setMode('view'); setSlot(null); setOverride(false); setReason(''); setWaive(false); setProblem(null) }, [id])
  useEffect(() => { setStaffNotes(data?.staffNotes || '') }, [data?.staffNotes])
  if (!id) return null

  const act = async (label: string, body: unknown, success: (r: any) => string) => {
    setBusy(label)
    setProblem(null)
    try {
      const r = await api<any>(`/api/appointments/${id}`, { body })
      toast.success(success(r))
      setMode('view')
      setSlot(null)
      reload()
      onChanged()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const saveNotes = async () => {
    setBusy('notes')
    try {
      await api(`/api/appointments/${id}`, { method: 'PATCH', body: { staffNotes: staffNotes || null } })
      toast.success('Notes saved')
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  const a = data
  const booked = a?.status === 'booked'
  const canRecord = booked && a && new Date(a.startsAt).getTime() - Date.now() <= 30 * 60_000
  return (
    <Modal open onClose={onClose} title={a ? a.type.name : 'Appointment'} description={a ? `${dateTime(a.startsAt)} – ${time(a.endsAt)}` : undefined} size="lg">
      {loading ? <SkeletonRows rows={4} /> : error || !a ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            {booked && a.late && <Badge tone="amber">Inside {a.cancelWindowHours}h cancellation window</Badge>}
            {a.rescheduleCount > 0 && <Badge>Moved{a.previousStartsAt ? ` from ${dateTime(a.previousStartsAt)}` : ''}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-fg-muted">Member</dt><dd><Link href={`/members/${a.member.id}`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{a.member.name}</Link></dd><dd className="truncate text-xs text-fg-muted">{a.member.phone || a.member.email}</dd></div>
            <div><dt className="text-xs text-fg-muted">With</dt><dd className="font-medium text-fg-heading">{a.staff.name}</dd><dd className="text-xs text-fg-muted">{a.type.durationMin} min</dd></div>
            <div><dt className="text-xs text-fg-muted">Location</dt><dd className="font-medium text-fg-heading">{a.location?.name || 'Not set'}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-fg-muted">Payment</dt>
              <dd className="text-fg-heading">
                {a.paymentMode === 'credit' ? `${a.creditsUsed} session credit${a.creditsUsed === 1 ? '' : 's'}${a.membership ? ` from ${a.membership.plan.name} · ${a.membership.creditsRemaining ?? 0} remaining` : ''}${a.creditsReturned ? ' · returned' : ''}`
                  : a.paymentMode === 'paid' ? <>{money(a.priceCents)}{a.invoice && <> · <Link href={`/billing/invoices?invoice=${a.invoice.id}`} className="ui-focus rounded text-accent-text hover:underline">{a.invoice.number}</Link> <StatusBadge status={a.invoice.status} /></>}</>
                  : 'Included in membership'}
              </dd>
            </div>
            {a.notes && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-fg-muted">Note for the member</dt><dd className="text-fg">{a.notes}</dd></div>}
            {a.cancelReason && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-fg-muted">Cancellation reason</dt><dd className="text-fg">{a.cancelReason}</dd></div>}
          </dl>
          {!['cancelled', 'late_cancelled'].includes(a.status) && <AttachWorkout what="appointment" url={`/api/appointments/${a.id}/workout`} current={a.workout} onChanged={reload} />}

          {mode === 'move' && (
            <div className="space-y-3 rounded-xl border border-line p-3">
              <p className="text-sm font-medium text-fg-heading">Choose a new time</p>
              <SlotPicker tz={gym.timezone} value={slot} onChange={setSlot} days={42} slotsUrl={(date) => `/api/appointments/slots${qs({ typeId: a.type.id, date, staffId: a.staff.id, memberId: a.member.id, ignore: a.id, override: override ? 1 : null })}`} />
              <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} label="Ignore minimum notice and the advance limit" />
              <p className="text-xs text-fg-muted">The member keeps the same {a.paymentMode === 'credit' ? 'session credit' : a.paymentMode === 'paid' ? 'payment' : 'booking'}; nothing is charged again. They are notified.</p>
              <div className="flex justify-end gap-2"><Button onClick={() => setMode('view')} disabled={!!busy}>Back</Button><Button variant="primary" disabled={!slot} loading={busy === 'move'} onClick={() => slot && act('move', { action: 'reschedule', startsAt: slot.startsAt, ...(override && { override: true }) }, () => 'Appointment moved')}>Move appointment</Button></div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className="space-y-3 rounded-xl border border-line p-3">
              <p className="text-sm font-medium text-fg-heading">Cancel this appointment?</p>
              <p className="text-sm text-fg-muted">{a.late
                ? `This is inside the ${a.cancelWindowHours}-hour window, so ${a.paymentMode === 'credit' ? 'the session credit is kept' : a.paymentMode === 'paid' ? 'the payment is kept' : 'it counts as a late cancellation'} unless you waive it.`
                : a.paymentMode === 'credit' ? 'The session credit goes back to the member.' : a.paymentMode === 'paid' ? 'Any payment is refunded to the original method.' : 'The member is notified.'}</p>
              {a.late && a.paymentMode !== 'included' && <Checkbox checked={waive} onChange={(e) => setWaive(e.target.checked)} label={a.paymentMode === 'credit' ? 'Waive: return the session credit anyway' : 'Waive: refund the payment anyway'} />}
              <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
              <div className="flex justify-end gap-2"><Button onClick={() => setMode('view')} disabled={!!busy}>Back</Button><Button variant="danger" loading={busy === 'cancel'} onClick={() => act('cancel', { action: 'cancel', reason: reason || null, ...(waive && { waive: true }) }, (r) => `Cancelled${r.creditsReturned ? ' · session returned' : r.refunded ? ' · payment refunded' : r.late ? ' · late cancellation' : ''}`)}>Cancel appointment</Button></div>
            </div>
          )}

          <FormError message={problem} />
          {manage && (
            <Field label="Staff notes (not shown to the member)">
              <Textarea rows={2} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} maxLength={2000} />
            </Field>
          )}
          {manage && mode === 'view' && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {staffNotes !== (a.staffNotes || '') && <Button loading={busy === 'notes'} onClick={saveNotes}>Save notes</Button>}
              {booked && <Button variant="primary" disabled={!canRecord} loading={busy === 'complete'} onClick={() => act('complete', { action: 'complete' }, () => 'Marked attended')}>Mark attended</Button>}
              {booked && <Button disabled={!canRecord} loading={busy === 'no_show'} onClick={() => act('no_show', { action: 'no_show' }, () => 'Marked as a no-show')}>No-show</Button>}
              {booked && <Button onClick={() => { setMode('move'); setProblem(null) }}>Reschedule</Button>}
              {booked && <Button onClick={() => { setMode('cancel'); setProblem(null) }}>Cancel</Button>}
              {booked && !canRecord && <p className="w-full text-xs text-fg-subtle">Attendance can be recorded from 30 minutes before the start.</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
