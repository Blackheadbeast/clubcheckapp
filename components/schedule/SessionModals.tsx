'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Copy, Pencil, UserPlus, X as XIcon } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, Select, SkeletonRows, StatusBadge, Textarea, cn, useToast } from '@/components/ui'
import { AttachWorkout } from '@/components/coaching/shared'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface SessionDraft {
  id?: string
  classTypeId: string
  locationId: string
  coachId: string
  room: string
  title: string
  notes: string
  date: string
  startTime: string
  durationMin: number
  capacity: number
  waitlistCapacity: number
  allowedPlanIds: string[]
}

/** Create or edit a class. New classes can repeat weekly. */
export function SessionFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: Partial<SessionDraft> | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { classTypes, coaches, locations, plans } = useLookups()
  const session = useSession()
  const editing = !!initial?.id
  const [v, setV] = useState<SessionDraft>({ classTypeId: '', locationId: '', coachId: '', room: '', title: '', notes: '', date: '', startTime: '09:00', durationMin: 60, capacity: 20, waitlistCapacity: 10, allowedPlanIds: [] })
  const [repeat, setRepeat] = useState(false)
  const [days, setDays] = useState<number[]>([])
  const [endDate, setEndDate] = useState('')
  const [restrict, setRestrict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const today = new Date().toLocaleDateString('en-CA', { timeZone: session.gym.timezone })
    const date = initial?.date || today
    setV({
      classTypeId: initial?.classTypeId || '', locationId: initial?.locationId || session.locationId || (locations.length === 1 ? locations[0].id : ''), coachId: initial?.coachId || '',
      room: initial?.room || '', title: initial?.title || '', notes: initial?.notes || '', date, startTime: initial?.startTime || '09:00',
      durationMin: initial?.durationMin || 60, capacity: initial?.capacity || 20, waitlistCapacity: initial?.waitlistCapacity ?? 10, allowedPlanIds: initial?.allowedPlanIds || [],
      id: initial?.id,
    })
    setRestrict((initial?.allowedPlanIds || []).length > 0)
    setRepeat(false)
    const [y, m, d] = date.split('-').map(Number)
    setDays([new Date(Date.UTC(y, m - 1, d)).getUTCDay()])
    setEndDate('')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const set = <K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) => setV((prev) => ({ ...prev, [key]: value }))
  const pickType = (id: string) => {
    const type = classTypes.find((t) => t.id === id)
    setV((prev) => ({ ...prev, classTypeId: id, ...(type && !editing ? { durationMin: type.defaultDurationMin, capacity: type.defaultCapacity } : {}) }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const shared = { classTypeId: v.classTypeId, locationId: v.locationId || null, coachId: v.coachId || null, room: v.room || null, capacity: v.capacity, waitlistCapacity: v.waitlistCapacity, startTime: v.startTime, durationMin: v.durationMin }
    try {
      if (editing) {
        const result = await api<{ moved: boolean; notified: number }>(`/api/schedule/sessions/${v.id}`, { method: 'PATCH', body: { ...shared, title: v.title || null, notes: v.notes || null, date: v.date, allowedPlanIds: restrict ? v.allowedPlanIds : [] } })
        toast.success(result.moved ? `Class moved${result.notified ? ` · ${result.notified} member${result.notified === 1 ? '' : 's'} notified` : ''}` : 'Class updated')
      } else if (repeat) {
        const result = await api<{ sessionsCreated: number }>('/api/schedule/schedules', { body: { ...shared, daysOfWeek: days, startDate: v.date, endDate: endDate || null } })
        toast.success(`Recurring class created · ${result.sessionsCreated} sessions added to the calendar`)
      } else {
        await api('/api/schedule/sessions', { body: { ...shared, title: v.title || null, notes: v.notes || null, date: v.date, allowedPlanIds: restrict ? v.allowedPlanIds : [] } })
        toast.success('Class scheduled')
      }
      onSaved()
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
      title={editing ? 'Edit class' : 'Schedule a class'}
      size="lg"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="session-form" loading={busy}>{editing ? 'Save changes' : repeat ? 'Create recurring class' : 'Schedule class'}</Button></>}
    >
      {classTypes.length === 0 ? (
        <EmptyState title="Create a class first" description="Classes like CrossFit or Yoga are set up once, then scheduled as often as you like." action={<Link href="/schedule/classes"><Button variant="primary">Set up classes</Button></Link>} />
      ) : (
        <form id="session-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Class" required>
            <Select value={v.classTypeId} onChange={(e) => pickType(e.target.value)} required>
              <option value="">Choose…</option>
              {classTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Coach">
            <Select value={v.coachId} onChange={(e) => set('coachId', e.target.value)}>
              <option value="">Unassigned</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={repeat ? 'First date' : 'Date'} required><Input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start time" required><Input type="time" step={300} value={v.startTime} onChange={(e) => set('startTime', e.target.value)} required /></Field>
            <Field label="Length (min)" required><Input type="number" min={5} max={720} step={5} value={v.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} required /></Field>
          </div>
          {locations.length > 0 && (
            <Field label="Location">
              <Select value={v.locationId} onChange={(e) => set('locationId', e.target.value)}>
                <option value="">Not set</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Room"><Input value={v.room} onChange={(e) => set('room', e.target.value)} placeholder="Main floor, Studio A…" maxLength={60} /></Field>
          <Field label="Capacity" required><Input type="number" min={1} max={1000} value={v.capacity} onChange={(e) => set('capacity', Number(e.target.value))} required /></Field>
          <Field label="Waitlist spots" hint="0 turns the waitlist off."><Input type="number" min={0} max={200} value={v.waitlistCapacity} onChange={(e) => set('waitlistCapacity', Number(e.target.value))} /></Field>

          {!editing && (
            <div className="space-y-3 rounded-lg border border-line p-3 sm:col-span-2">
              <Checkbox checked={repeat} onChange={(e) => setRepeat(e.target.checked)} label="Repeat every week" />
              {repeat && (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
                    {DAYS.map((d, i) => (
                      <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))} className={cn('ui-focus h-9 w-12 rounded-lg border text-sm font-medium transition', days.includes(i) ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg-muted hover:bg-subtle')}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <Field label="Ends on" hint="Leave blank to keep it running."><Input type="date" value={endDate} min={v.date} onChange={(e) => setEndDate(e.target.value)} className="sm:max-w-[12rem]" /></Field>
                </>
              )}
            </div>
          )}

          {!repeat && (
            <>
              <Field label="Custom title" hint="Shown instead of the class name." className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Hero WOD: Murph" maxLength={100} /></Field>
              <Field label="Notes for staff" className="sm:col-span-2"><Textarea rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} /></Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox checked={restrict} onChange={(e) => setRestrict(e.target.checked)} label="Only certain memberships can book this class" />
                {restrict && (
                  <div className="grid gap-1.5 rounded-lg border border-line p-3 sm:grid-cols-2">
                    {plans.map((p) => (
                      <Checkbox key={p.id} label={p.name} checked={v.allowedPlanIds.includes(p.id)} onChange={(e) => set('allowedPlanIds', e.target.checked ? [...v.allowedPlanIds, p.id] : v.allowedPlanIds.filter((x) => x !== p.id))} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="sm:col-span-2"><FormError message={error} /></div>
        </form>
      )}
    </Modal>
  )
}

interface RosterEntry {
  id: string
  status: string
  creditUsed: boolean
  source: string
  offerExpiresAt: string | null
  position?: number
  member: { id: string; name: string; photoUrl: string | null; status: string; hasMedicalNotes?: boolean }
  membership: { plan: { name: string } } | null
}

interface SessionDetail {
  id: string
  title: string
  workout?: { id: string; name: string } | null
  customTitle: string | null
  status: string
  cancelReason: string | null
  notes: string | null
  room: string | null
  startsAt: string
  endsAt: string
  date: string
  startTime: string
  durationMin: number
  capacity: number
  waitlistCapacity: number
  booked: number
  lateCancels: number
  scheduleId: string | null
  allowedPlanIds: string[]
  classType: { id: string; name: string; color: string }
  coach: { id: string; name: string } | null
  location: { id: string; name: string } | null
  roster: RosterEntry[]
  waitlist: RosterEntry[]
}

/** One class: roster, attendance, waitlist and class-level actions. */
export function SessionDrawer({ sessionId, onClose, onChanged }: { sessionId: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { can, time, date, dateTime } = useSession()
  const { data, error, loading, reload } = useApi<SessionDetail>(sessionId ? `/api/schedule/sessions/${sessionId}` : null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [reason, setReason] = useState('')
  const [copyDate, setCopyDate] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setAdding(false)
    setProblem(null)
  }, [sessionId])

  if (!sessionId) return null
  const changed = () => { reload(); onChanged() }
  const past = data ? new Date(data.endsAt) < new Date() : false
  const started = data ? new Date(data.startsAt) <= new Date(Date.now() + 60 * 60_000) : false

  const act = async (bookingId: string, body: Record<string, unknown>, message: string | ((r: any) => string)) => {
    setBusy(bookingId)
    setProblem(null)
    try {
      const result = await api<any>(`/api/bookings/${bookingId}`, { body })
      toast.success(typeof message === 'function' ? message(result) : message)
      changed()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  const cancelClass = async () => {
    setBusy('class')
    try {
      const result = await api<{ affected: number }>(`/api/schedule/sessions/${sessionId}`, { body: { action: 'cancel', reason: reason || null } })
      toast.success(`Class cancelled${result.affected ? ` · ${result.affected} member${result.affected === 1 ? '' : 's'} notified` : ''}`)
      setCancelling(false)
      setReason('')
      changed()
    } catch (err) {
      setProblem((err as ClientError).message)
      setCancelling(false)
    } finally {
      setBusy(null)
    }
  }

  const duplicate = async () => {
    setBusy('class')
    try {
      await api(`/api/schedule/sessions/${sessionId}`, { body: { action: 'duplicate', date: copyDate } })
      toast.success(`Copied to ${new Date(`${copyDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`)
      setDuplicating(false)
      onChanged()
    } catch (err) {
      setProblem((err as ClientError).message)
      setDuplicating(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Modal
        open={!editing && !cancelling && !duplicating}
        onClose={onClose}
        size="lg"
        title={data ? data.title : 'Class'}
        description={data ? `${date(data.startsAt)} · ${time(data.startsAt)} – ${time(data.endsAt)}${data.coach ? ` · ${data.coach.name}` : ''}${data.location ? ` · ${data.location.name}` : ''}${data.room ? ` · ${data.room}` : ''}` : undefined}
        footer={
          data && data.status !== 'cancelled' && can('classes.manage') ? (
            <>
              {!past && <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setCancelling(true)}>Cancel class</Button>}
              <Button icon={<Copy className="h-4 w-4" />} onClick={() => { setCopyDate(''); setDuplicating(true) }}>Duplicate</Button>
              {!past && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
            </>
          ) : undefined
        }
      >
        {loading ? <SkeletonRows rows={5} /> : error || !data ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
          <div className="space-y-5">
            {data.status === 'cancelled' && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" /> This class was cancelled{data.cancelReason ? `: ${data.cancelReason}` : '.'}
              </div>
            )}
            {data.notes && <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-fg-muted">{data.notes}</p>}
            <FormError message={problem} />
            {data.status !== 'cancelled' && <AttachWorkout what="class" url={`/api/schedule/sessions/${data.id}/workout`} current={data.workout} onChanged={reload} />}

            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-fg-heading">{data.booked} of {data.capacity} booked</span>
                <span className="text-fg-muted">{data.capacity - data.booked > 0 ? `${data.capacity - data.booked} spot${data.capacity - data.booked === 1 ? '' : 's'} left` : 'Full'}{data.waitlist.length ? ` · ${data.waitlist.length} waiting` : ''}{data.lateCancels ? ` · ${data.lateCancels} late cancel${data.lateCancels === 1 ? '' : 's'}` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-subtle"><div className="h-2 rounded-full" style={{ width: `${Math.min(100, (data.booked / data.capacity) * 100)}%`, background: data.classType.color }} /></div>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg-heading">Roster</h3>
                {data.status !== 'cancelled' && !past && can('bookings.manage') && <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setAdding((a) => !a)}>{adding ? 'Done' : 'Add member'}</Button>}
              </div>
              {adding && <AddToClass sessionId={data.id} full={data.booked >= data.capacity} onBooked={changed} />}
              {data.roster.length === 0 ? <p className="py-4 text-center text-sm text-fg-subtle">Nobody has booked yet.</p> : (
                <ul className="divide-y divide-line/60 rounded-lg border border-line">
                  {data.roster.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <Avatar name={b.member.name} src={b.member.photoUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/members/${b.member.id}`} className="ui-focus block truncate rounded text-sm font-medium text-fg-heading hover:underline">{b.member.name}</Link>
                        <p className="truncate text-xs text-fg-muted">{b.membership?.plan.name || 'No membership'}{b.creditUsed ? ' · 1 credit' : ''}{b.member.hasMedicalNotes ? ' · medical note on file' : ''}</p>
                      </div>
                      {['past_due', 'frozen'].includes(b.member.status) && <StatusBadge status={b.member.status} />}
                      {b.status === 'no_show' && <StatusBadge status="no_show" />}
                      {can('attendance.manage') && data.status !== 'cancelled' && started ? (
                        <div className="flex gap-1" role="group" aria-label={`Attendance for ${b.member.name}`}>
                          <button type="button" disabled={busy === b.id} aria-pressed={b.status === 'attended'} onClick={() => act(b.id, { action: 'attendance', status: b.status === 'attended' ? 'booked' : 'attended' }, b.status === 'attended' ? 'Attendance cleared' : `${b.member.name} marked present`)} className={cn('ui-focus flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition', b.status === 'attended' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-fg-muted hover:bg-subtle')}>
                            <Check className="h-3.5 w-3.5" /> Present
                          </button>
                          <button type="button" disabled={busy === b.id} aria-pressed={b.status === 'no_show'} onClick={() => act(b.id, { action: 'attendance', status: b.status === 'no_show' ? 'booked' : 'no_show' }, b.status === 'no_show' ? 'No-show cleared' : `${b.member.name} marked as a no-show`)} className={cn('ui-focus flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition', b.status === 'no_show' ? 'border-red-500 bg-red-500 text-white' : 'border-line text-fg-muted hover:bg-subtle')}>
                            No-show
                          </button>
                        </div>
                      ) : b.status === 'attended' ? <StatusBadge status="attended" /> : null}
                      {b.status === 'booked' && !past && can('bookings.manage') && (
                        <IconButton label={`Cancel ${b.member.name}'s booking`} disabled={busy === b.id} onClick={() => act(b.id, { action: 'cancel', waive: true }, (r) => `Booking cancelled${r.promoted ? ' · next person on the waitlist was offered the spot' : ''}`)}><XIcon className="h-4 w-4" /></IconButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.waitlist.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-fg-heading">Waitlist</h3>
                <ol className="divide-y divide-line/60 rounded-lg border border-line">
                  {data.waitlist.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="tabular w-5 text-center text-xs font-semibold text-fg-subtle">{b.position}</span>
                      <Avatar name={b.member.name} src={b.member.photoUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/members/${b.member.id}`} className="ui-focus block truncate rounded text-sm font-medium text-fg-heading hover:underline">{b.member.name}</Link>
                        {b.status === 'offered' && <p className="text-xs text-sky-700 dark:text-sky-400">Spot offered · held until {dateTime(b.offerExpiresAt)}</p>}
                      </div>
                      {b.status === 'offered' ? <Badge tone="blue">Offered</Badge> : <Badge tone="amber">Waiting</Badge>}
                      {b.status === 'offered' && can('bookings.manage') && <Button size="sm" disabled={busy === b.id} onClick={() => act(b.id, { action: 'claim' }, `${b.member.name} booked in`)}>Confirm</Button>}
                      {can('bookings.manage') && <IconButton label={`Remove ${b.member.name} from the waitlist`} disabled={busy === b.id} onClick={() => act(b.id, { action: 'cancel' }, 'Removed from the waitlist')}><XIcon className="h-4 w-4" /></IconButton>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </Modal>

      <SessionFormModal
        open={editing}
        initial={data ? { id: data.id, classTypeId: data.classType.id, locationId: data.location?.id || '', coachId: data.coach?.id || '', room: data.room || '', title: data.customTitle || '', notes: data.notes || '', date: data.date, startTime: data.startTime, durationMin: data.durationMin, capacity: data.capacity, waitlistCapacity: data.waitlistCapacity, allowedPlanIds: data.allowedPlanIds } : null}
        onClose={() => setEditing(false)}
        onSaved={changed}
      />
      <ConfirmModal open={cancelling} onClose={() => setCancelling(false)} onConfirm={cancelClass} loading={busy === 'class'} danger title="Cancel this class?" confirmLabel="Cancel class">
        <p>{data && data.booked + data.waitlist.length > 0 ? `${data.booked + data.waitlist.length} member${data.booked + data.waitlist.length === 1 ? '' : 's'} will be emailed and any session credits returned.` : 'Nobody is booked, so nobody needs to be told.'}{data?.scheduleId ? ' Only this date is cancelled; the weekly class continues.' : ''}</p>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (included in the email)" aria-label="Reason" maxLength={300} />
      </ConfirmModal>
      <Modal open={duplicating} onClose={() => setDuplicating(false)} title="Duplicate class" size="sm" footer={<><Button onClick={() => setDuplicating(false)}>Cancel</Button><Button variant="primary" onClick={duplicate} loading={busy === 'class'} disabled={!copyDate}>Duplicate</Button></>}>
        <Field label="Copy to" hint="Same time, coach, room and capacity. Bookings are not copied."><Input type="date" value={copyDate} onChange={(e) => setCopyDate(e.target.value)} /></Field>
      </Modal>
    </>
  )
}

function AddToClass({ sessionId, full, onBooked }: { sessionId: string; full: boolean; onBooked: () => void }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 150)
  const { data } = useApi<{ id: string; name: string; photoUrl: string | null; status: string }[]>(debounced.length >= 2 ? `/api/checkin/lookup?q=${encodeURIComponent(debounced)}` : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const book = async (memberId: string, name: string) => {
    setBusy(memberId)
    setError(null)
    try {
      const result = await api<{ status: string; waitlistPosition: number | null }>('/api/bookings', { body: { memberId, sessionId } })
      toast.success(result.status === 'waitlisted' ? `${name} added to the waitlist (#${result.waitlistPosition})` : `${name} booked in`)
      setQuery('')
      onBooked()
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members by name or phone" aria-label="Search members to add" />
      {full && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">The class is full, so anyone you add joins the waitlist.</p>}
      <div className="mt-2"><FormError message={error} /></div>
      {debounced.length >= 2 && data && (
        data.length === 0 ? <p className="mt-2 text-sm text-fg-subtle">No members match.</p> : (
          <ul className="mt-2 divide-y divide-line/60">
            {data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-1.5">
                <Avatar name={m.name} src={m.photoUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{m.name}</span>
                <StatusBadge status={m.status} />
                <Button size="sm" variant="primary" loading={busy === m.id} disabled={!!busy} onClick={() => book(m.id, m.name)}>{full ? 'Waitlist' : 'Book'}</Button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
