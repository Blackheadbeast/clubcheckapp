'use client'

// Appointments in the member app: book one, see what is coming up, move or
// cancel it. Every rule (availability, credits, cancellation window) is decided
// by the server; this screen explains the answer.

import { useEffect, useState } from 'react'
import { CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, MapPin, UserRound, X } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { formatDate, formatDateTime, formatTime } from '@/lib/format'
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, Modal, Skeleton, StatusBadge, cn, useToast } from '@/components/ui'
import { SlotPicker, type PickedSlot } from '@/components/appointments/SlotPicker'

export interface MemberAppointment {
  id: string; status: string; startsAt: string; endsAt: string; durationMin: number
  type: { id: string; name: string; color: string }
  coach: { id: string; name: string }
  location: string | null
  notes: string | null
  payment: { mode: string; label: string; returned?: boolean; invoice?: { id: string; number: string; status: string; balanceCents: number } | null }
  cancelWindowHours: number
  freeChangeUntil: string
  can: { cancel: boolean; cancelFree: boolean; reschedule: boolean }
  rescheduledFrom: string | null
  cancelledAt: string | null
}
interface Lists { upcoming: MemberAppointment[]; past: MemberAppointment[]; cancelled: MemberAppointment[] }
interface TypeChoice {
  id: string; name: string; description: string | null; color: string; durationMin: number; paymentMode: string; priceLabel: string; creditsRequired: number; creditsAvailable: number | null
  cancelWindowHours: number; maxAdvanceDays: number; canReschedule: boolean; locationIds: string[]
  coaches: { id: string; name: string; title: string | null; bio: string | null }[]
  blocked: 'needs_package' | 'needs_membership' | null
  packages: { id: string; name: string; description: string | null; priceLabel: string; sessions: number | null; expiresAfterDays: number | null }[]
}
interface Options { canBuyOnline: boolean; canPayOnline: boolean; locations: { id: string; name: string }[]; types: TypeChoice[]; packages: { id: string; name: string; sessionsRemaining: number; expiresAt: string | null }[] }

const STATUS_LABEL: Record<string, string> = { booked: 'Booked', completed: 'Attended', no_show: 'Missed', cancelled: 'Cancelled', late_cancelled: 'Late cancellation' }
const dayLine = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })

export function AppointmentCard({ a, tz, onOpen }: { a: MemberAppointment; tz: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="ui-focus flex w-full items-center gap-3 rounded-xl border border-dashed border-fg-subtle/50 bg-surface p-3 text-left shadow-card">
      <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: a.type.color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg-heading"><UserRound className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden /><span className="truncate">{a.type.name}</span></span>
        <span className="block truncate text-xs text-fg-muted">{dayLine(a.startsAt, tz)} · {formatTime(a.startsAt, tz)} · {a.coach.name}</span>
        {a.location && <span className="block truncate text-xs text-fg-subtle">{a.location}</span>}
      </span>
      {a.status !== 'booked' ? <StatusBadge status={a.status} /> : <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
    </button>
  )
}

export function AppointmentsTab({ base, tz, openId, onOpened, onChange }: { base: string; tz: string; openId?: string | null; onOpened?: () => void; onChange: () => void }) {
  const lists = useApi<Lists>(`${base}/appointments`)
  const options = useApi<Options>(`${base}/appointments/options`)
  const [view, setView] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming')
  const [booking, setBooking] = useState(false)
  const [detail, setDetail] = useState<string | null>(openId || null)
  useEffect(() => { if (openId) { setDetail(openId); onOpened?.() } }, [openId]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { lists.reload(); options.reload(); onChange() }
  const rows = lists.data ? lists.data[view] : []
  const bookable = (options.data?.types || []).length > 0

  return (
    <>
      {options.data && options.data.packages.length > 0 && (
        <div className="grid gap-2">
          {options.data.packages.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-card">
              <span className="tabular flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-lg font-semibold text-accent-text">{p.sessionsRemaining}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">{p.sessionsRemaining} session{p.sessionsRemaining === 1 ? '' : 's'} remaining</span><span className="block truncate text-xs text-fg-muted">{p.name}{p.expiresAt ? ` · use by ${formatDate(p.expiresAt, tz)}` : ''}</span></span>
            </div>
          ))}
        </div>
      )}

      {options.loading ? <Skeleton className="h-12 rounded-xl" /> : bookable ? (
        <Button variant="primary" size="lg" className="h-12 w-full" onClick={() => setBooking(true)}><CalendarPlus className="h-4 w-4" />Book an appointment</Button>
      ) : null}

      <div className="flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Appointments">
        {(['upcoming', 'past', 'cancelled'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn('ui-focus h-9 flex-1 rounded-lg text-sm font-medium capitalize transition', view === k ? 'bg-subtle text-fg-heading' : 'text-fg-muted')}>
            {k}{lists.data && lists.data[k].length > 0 && k === 'upcoming' ? ` (${lists.data[k].length})` : ''}
          </button>
        ))}
      </div>

      {lists.loading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[4.5rem] rounded-xl" />)}</div> : lists.error ? <Card><ErrorState error={lists.error} onRetry={lists.reload} /></Card> : rows.length === 0 ? (
        <Card><EmptyState icon={<CalendarClock className="h-5 w-5" />}
          title={view === 'upcoming' ? 'No appointments booked' : view === 'past' ? 'No past appointments' : 'Nothing cancelled'}
          description={view === 'upcoming' ? (bookable ? 'Book personal training or a consultation at a time that suits you.' : 'Appointments are arranged with the team here. Ask at the front desk.') : undefined}
          action={view === 'upcoming' && bookable ? <Button variant="primary" onClick={() => setBooking(true)}>Book an appointment</Button> : undefined} /></Card>
      ) : (
        <div className="space-y-2">{rows.map((a) => <AppointmentCard key={a.id} a={a} tz={tz} onOpen={() => setDetail(a.id)} />)}</div>
      )}

      {booking && options.data && <BookFlow base={base} tz={tz} options={options.data} onClose={() => setBooking(false)} onBooked={(id) => { setBooking(false); setView('upcoming'); changed(); setDetail(id) }} onPackagesChanged={() => options.reload()} />}
      <AppointmentDetail base={base} tz={tz} id={detail} onClose={() => setDetail(null)} onChanged={changed} />
    </>
  )
}

/** Type, then who and where, then when, then confirm. Full screen so nothing competes with the choice at hand. */
function BookFlow({ base, tz, options, onClose, onBooked, onPackagesChanged }: { base: string; tz: string; options: Options; onClose: () => void; onBooked: (id: string) => void; onPackagesChanged: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [typeId, setTypeId] = useState('')
  const [coachId, setCoachId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [slot, setSlot] = useState<PickedSlot | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const type = options.types.find((t) => t.id === typeId)
  const locations = type ? options.locations.filter((l) => type.locationIds.length === 0 || type.locationIds.includes(l.id)) : []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const choose = (t: TypeChoice) => {
    if (t.blocked) return
    setTypeId(t.id); setCoachId(''); setLocationId(''); setSlot(null); setProblem(null); setStep(2)
  }
  const buy = async (planId: string, name: string) => {
    setBusy(planId)
    setProblem(null)
    try {
      const r = await api<{ sessionsRemaining: number }>(`${base}/packages`, { body: { planId } })
      toast.success(`${name} added · ${r.sessionsRemaining} sessions ready to book`)
      onPackagesChanged()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const confirm = async () => {
    if (!type || !slot) return
    setBusy('book')
    setProblem(null)
    try {
      const r = await api<{ appointment: MemberAppointment; creditsRemaining: number | null }>(`${base}/appointments`, { body: { typeId: type.id, staffId: coachId || null, startsAt: slot.startsAt, locationId: locationId || null, notes: notes || null } })
      toast.success(`Booked with ${r.appointment.coach.name}${r.creditsRemaining !== null ? ` · ${r.creditsRemaining} session${r.creditsRemaining === 1 ? '' : 's'} remaining` : ''}`)
      onBooked(r.appointment.id)
    } catch (err) {
      const e = err as ClientError
      setProblem(e.message)
      // The time went while they were confirming: send them back to pick another.
      if (e.status === 409 || e.code === 'slot_unavailable') { setSlot(null); setStep(2) }
    } finally {
      setBusy(null)
    }
  }
  const back = () => { setProblem(null); if (step === 1) onClose(); else setStep((step - 1) as 1 | 2) }

  return (
    <div role="dialog" aria-modal="true" aria-label="Book an appointment" className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-1 px-2">
          <button type="button" onClick={back} aria-label={step === 1 ? 'Close' : 'Back'} className="ui-focus flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:bg-subtle hover:text-fg">{step === 1 ? <X className="h-5 w-5" aria-hidden /> : <ChevronLeft className="h-5 w-5" aria-hidden />}</button>
          <h2 className="flex-1 truncate text-base font-semibold text-fg-heading">{step === 1 ? 'Book an appointment' : type?.name}</h2>
          <span className="tabular pr-3 text-xs text-fg-subtle">Step {step} of 3</span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-28">
          {step === 1 && (
            <>
              <p className="text-sm text-fg-muted">What would you like to book?</p>
              {options.types.map((t) => (
                <div key={t.id} className={cn('rounded-xl border bg-surface shadow-card', t.blocked ? 'border-line' : 'border-line')}>
                  <button type="button" disabled={!!t.blocked} onClick={() => choose(t)} className={cn('ui-focus flex w-full items-center gap-3 rounded-xl p-4 text-left', t.blocked && 'cursor-default')}>
                    <span className="h-11 w-1 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg-heading">{t.name}</span>
                      <span className="block text-xs text-fg-muted">{t.durationMin} min · {t.priceLabel}{t.creditsAvailable !== null && !t.blocked ? ` · you have ${t.creditsAvailable}` : ''}</span>
                      {t.description && <span className="mt-1 block text-sm text-fg-muted">{t.description}</span>}
                    </span>
                    {!t.blocked && <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
                  </button>
                  {t.blocked && (
                    <div className="space-y-2 border-t border-line px-4 py-3">
                      <p className="text-sm text-fg-muted">{t.blocked === 'needs_package' ? 'You need a session package to book this.' : 'This is not included in your membership. Ask the team about upgrading.'}</p>
                      {t.blocked === 'needs_package' && t.packages.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg-heading">{p.name}</span><span className="block text-xs text-fg-muted">{p.sessions ? `${p.sessions} sessions` : 'Package'}{p.expiresAfterDays ? ` · valid ${p.expiresAfterDays} days` : ''}</span></span>
                          <span className="tabular shrink-0 text-sm font-semibold text-fg-heading">{p.priceLabel}</span>
                          {options.canBuyOnline && <Button size="sm" variant="primary" loading={busy === p.id} disabled={!!busy} onClick={() => buy(p.id, p.name)}>Buy</Button>}
                        </div>
                      ))}
                      {t.blocked === 'needs_package' && !options.canBuyOnline && <p className="text-xs text-fg-subtle">{options.canPayOnline ? 'Add a card under Membership to buy a package here, or buy one at the front desk.' : 'Packages are sold at the front desk.'}</p>}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {step === 2 && type && (
            <>
              {locations.length > 1 && (
                <Field label="Where">
                  <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="ui-input h-11"><option value="">Any location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                </Field>
              )}
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg-muted">With</p>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Coach">
                  {[{ id: '', name: 'Any available', title: null as string | null }, ...type.coaches].map((c) => (
                    <button key={c.id || 'any'} type="button" role="radio" aria-checked={coachId === c.id} onClick={() => setCoachId(c.id)} className={cn('ui-focus flex h-12 shrink-0 flex-col justify-center rounded-xl border px-4 text-left', coachId === c.id ? 'border-accent bg-accent/10' : 'border-line bg-surface')}>
                      <span className="whitespace-nowrap text-sm font-medium text-fg-heading">{c.name}</span>
                      {c.title && <span className="whitespace-nowrap text-[11px] text-fg-muted">{c.title}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg-muted">When</p>
                <SlotPicker touch tz={tz} value={slot} onChange={setSlot} days={Math.min(30, type.maxAdvanceDays + 1)} slotsUrl={(date) => `${base}/appointments/slots?typeId=${type.id}&date=${date}${coachId ? `&staffId=${coachId}` : ''}${locationId ? `&locationId=${locationId}` : ''}`} />
              </div>
              <FormError message={problem} />
            </>
          )}

          {step === 3 && type && slot && (
            <>
              <Card className="space-y-3">
                <p className="text-lg font-semibold leading-tight text-fg-heading">{type.name}</p>
                <dl className="space-y-2 text-sm">
                  <div className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden /><dd className="text-fg">{formatDateTime(slot.startsAt, tz)} · {type.durationMin} min</dd></div>
                  <div className="flex items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden /><dd className="text-fg">{coachId ? type.coaches.find((c) => c.id === coachId)?.name : slot.people.length === 1 ? slot.people[0].name : 'First available coach'}</dd></div>
                  {locationId && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden /><dd className="text-fg">{locations.find((l) => l.id === locationId)?.name}</dd></div>}
                </dl>
                <div className="rounded-lg bg-subtle/60 px-3 py-2 text-sm">
                  <p className="flex justify-between"><span className="text-fg-muted">Cost</span><span className="font-medium text-fg-heading">{type.priceLabel}</span></p>
                  {type.creditsAvailable !== null && <p className="mt-0.5 text-xs text-fg-muted">You have {type.creditsAvailable} session{type.creditsAvailable === 1 ? '' : 's'}; {type.creditsAvailable - type.creditsRequired} will remain.</p>}
                  {type.paymentMode === 'paid' && <p className="mt-0.5 text-xs text-fg-muted">{options.canPayOnline ? 'Charged to your saved payment method when you confirm.' : 'Pay at the front desk.'}</p>}
                </div>
                <p className="text-xs text-fg-muted">{type.cancelWindowHours > 0 ? `Free to cancel${type.canReschedule ? ' or move' : ''} up to ${type.cancelWindowHours} hours before. After that the ${type.paymentMode === 'credit' ? 'session is used' : type.paymentMode === 'paid' ? 'payment is kept' : 'appointment counts as a late cancellation'}.` : 'You can cancel any time before it starts.'}</p>
              </Card>
              <Field label="Anything your coach should know? (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Goals, injuries, what you'd like to work on" /></Field>
              <FormError message={problem} />
            </>
          )}
          {step === 1 && <FormError message={problem} />}
        </div>
      </div>
      {step > 1 && (
        <div className="border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-2xl px-4 py-3">
            {step === 2 ? <Button variant="primary" size="lg" className="h-12 w-full" disabled={!slot} onClick={() => { setProblem(null); setStep(3) }}>{slot ? `Continue · ${formatTime(slot.startsAt, tz)}` : 'Choose a time'}</Button>
              : <Button variant="primary" size="lg" className="h-12 w-full" loading={busy === 'book'} onClick={confirm}><Check className="h-4 w-4" />Confirm booking</Button>}
          </div>
        </div>
      )}
    </div>
  )
}

function AppointmentDetail({ base, tz, id, onClose, onChanged }: { base: string; tz: string; id: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<MemberAppointment>(id ? `${base}/appointments/${id}` : null)
  const [mode, setMode] = useState<'view' | 'move' | 'cancel'>('view')
  const [slot, setSlot] = useState<PickedSlot | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { setMode('view'); setSlot(null); setProblem(null) }, [id])
  if (!id) return null
  const a = data

  const act = async (body: unknown, done: (r: { late?: boolean; creditsReturned?: boolean; refunded?: boolean }) => string) => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ late?: boolean; creditsReturned?: boolean; refunded?: boolean }>(`${base}/appointments/${id}`, { body })
      toast.success(done(r))
      setMode('view')
      setSlot(null)
      reload()
      onChanged()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={a ? a.type.name : 'Appointment'} description={a ? `with ${a.coach.name}` : undefined}>
      {loading ? <div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-10 w-full" /></div> : error || !a ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={a.status === 'booked' || a.status === 'completed' ? 'green' : a.status === 'cancelled' ? 'neutral' : 'amber'}>{STATUS_LABEL[a.status] || a.status}</Badge>{a.rescheduledFrom && a.status === 'booked' && <span className="text-xs text-fg-muted">Moved from {formatDateTime(a.rescheduledFrom, tz)}</span>}</div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Date</dt><dd className="text-right font-medium text-fg-heading">{new Date(a.startsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Time</dt><dd className="tabular text-right font-medium text-fg-heading">{formatTime(a.startsAt, tz)} – {formatTime(a.endsAt, tz)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Duration</dt><dd className="text-right text-fg-heading">{a.durationMin} minutes</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Coach</dt><dd className="text-right text-fg-heading">{a.coach.name}</dd></div>
            {a.location && <div className="flex justify-between gap-3"><dt className="text-fg-muted">Location</dt><dd className="text-right text-fg-heading">{a.location}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Cost</dt><dd className="text-right text-fg-heading">{a.payment.label}{a.payment.returned ? ' (returned)' : ''}</dd></div>
            {a.notes && <div><dt className="text-fg-muted">Your note</dt><dd className="mt-0.5 text-fg">{a.notes}</dd></div>}
          </dl>

          {a.status === 'booked' && mode === 'view' && (
            <p className={cn('rounded-lg px-3 py-2 text-sm', a.can.cancelFree ? 'bg-subtle/60 text-fg-muted' : 'bg-amber-500/10 text-amber-800 dark:text-amber-400')}>
              {a.can.cancelFree
                ? `Free to cancel${a.can.reschedule ? ' or move' : ''} until ${formatDateTime(a.freeChangeUntil, tz)}.`
                : a.can.cancel ? `It is now less than ${a.cancelWindowHours} hours before this appointment. It can no longer be moved online, and cancelling ${a.payment.mode === 'credit' ? 'will still use your session' : a.payment.mode === 'paid' ? 'will not be refunded' : 'counts as a late cancellation'}.` : 'This appointment has started.'}
            </p>
          )}

          {mode === 'move' && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-fg-heading">Choose a new time with {a.coach.name}</p>
              <SlotPicker touch tz={tz} value={slot} onChange={setSlot} days={30} slotsUrl={(date) => `${base}/appointments/slots?typeId=${a.type.id}&date=${date}&staffId=${a.coach.id}&reschedule=${a.id}`} />
              <p className="text-xs text-fg-muted">Nothing is charged again: the same {a.payment.mode === 'credit' ? 'session' : a.payment.mode === 'paid' ? 'payment' : 'booking'} moves with it.</p>
              <FormError message={problem} />
              <div className="flex gap-2"><Button className="h-11 flex-1" onClick={() => setMode('view')} disabled={busy}>Back</Button><Button variant="primary" className="h-11 flex-1" disabled={!slot} loading={busy} onClick={() => slot && act({ action: 'reschedule', startsAt: slot.startsAt, staffId: a.coach.id }, () => 'Appointment moved')}>{slot ? `Move to ${formatTime(slot.startsAt, tz)}` : 'Choose a time'}</Button></div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className="space-y-3">
              <p className="text-sm text-fg">{a.can.cancelFree
                ? (a.payment.mode === 'credit' ? 'Your session will be returned to your package.' : a.payment.mode === 'paid' ? 'Any payment will be refunded to your original payment method.' : 'Your coach will be told.')
                : (a.payment.mode === 'credit' ? 'Because this is a late cancellation, your session will not be returned.' : a.payment.mode === 'paid' ? 'Because this is a late cancellation, the payment will not be refunded.' : 'This will be recorded as a late cancellation.')}</p>
              <FormError message={problem} />
              <div className="flex gap-2"><Button className="h-11 flex-1" onClick={() => setMode('view')} disabled={busy}>Keep it</Button><Button variant="danger" className="h-11 flex-1" loading={busy} onClick={() => act({ action: 'cancel' }, (r) => (r.late ? 'Cancelled (late cancellation)' : r.creditsReturned ? 'Cancelled · session returned' : r.refunded ? 'Cancelled · payment refunded' : 'Cancelled'))}>Cancel appointment</Button></div>
            </div>
          )}

          {a.status === 'booked' && mode === 'view' && (
            <div className="space-y-2">
              <FormError message={problem} />
              <div className="flex gap-2">
                {a.can.reschedule && <Button className="h-11 flex-1" onClick={() => setMode('move')}>Reschedule</Button>}
                {a.can.cancel && <Button className="h-11 flex-1" onClick={() => setMode('cancel')}>Cancel</Button>}
              </div>
              <a href={`${base}/appointments/${a.id}/calendar`} className="block"><Button className="h-11 w-full"><CalendarPlus className="h-4 w-4" />Add to calendar</Button></a>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
