'use client'

// The compact member profile staff use at the desk, and the check-in
// confirmation that follows a tap. Billing and notes only arrive from the
// server for roles allowed to see them.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarPlus, CheckCircle2, ExternalLink, Flame, Mail, Phone, MessageSquare, ScanLine, StickyNote, UserRound, Wallet } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { timeAgo } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, ErrorState, FormError, Modal, SkeletonRows, StatusBadge, Textarea, cn, useToast } from '@/components/ui'
import { BookClassModal } from '@/components/schedule/BookClassModal'
import { BookAppointmentModal } from '@/components/appointments/AppointmentModals'
import { PayModal, type PayTarget } from '@/components/billing/PaymentModals'
import { TextModal } from '@/components/messaging/Thread'

export interface CheckinResult {
  name: string
  label: string | null
  at: string
  streak: number
  duplicate: boolean
}

interface CheckinResponse { duplicate: boolean; checkin: { timestamp: string }; streak: { current: number }; attended: { name: string } | null; member: { name: string } }

/** Check a member in. Throws a ClientError carrying `details.canOverride` when staff could force it. */
export async function checkIn(memberId: string, locationId: string | null, force = false): Promise<CheckinResult> {
  const r = await api<CheckinResponse>('/api/checkin', { body: { memberId, source: 'search', locationId, ...(force && { force: true }) } })
  return { name: r.member.name, label: r.attended?.name || null, at: r.checkin.timestamp, streak: r.streak.current, duplicate: r.duplicate }
}

/** A big, brief, unmissable "done". Dismisses itself so the next person can step up. */
export function CheckinConfirmation({ result, onDone }: { result: CheckinResult | null; onDone: () => void }) {
  const { time } = useSession()
  useEffect(() => {
    if (!result) return
    const id = setTimeout(onDone, 2600)
    return () => clearTimeout(id)
  }, [result, onDone])
  if (!result) return null
  return (
    <div role="status" aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
      <button type="button" onClick={onDone} className="pointer-events-auto flex w-full max-w-md items-center gap-4 rounded-2xl border border-emerald-500/50 bg-emerald-600 px-5 py-4 text-left text-white shadow-pop">
        <CheckCircle2 className="h-10 w-10 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-emerald-100">{result.duplicate ? 'Already checked in' : 'Checked in'}</span>
          <span className="block truncate text-lg font-semibold leading-tight">{result.name}</span>
          <span className="block truncate text-sm text-emerald-50">{result.label ? `${result.label} · ` : ''}{time(result.at)}</span>
        </span>
        {result.streak > 1 && <span className="flex shrink-0 flex-col items-center rounded-xl bg-white/15 px-3 py-1.5"><span className="tabular flex items-center gap-1 text-lg font-bold leading-none"><Flame className="h-4 w-4" aria-hidden />{result.streak}</span><span className="text-[10px] uppercase tracking-wide">day streak</span></span>}
      </button>
    </div>
  )
}

interface Quick {
  id: string; name: string; email: string; phone: string | null; photoUrl: string | null; status: string; location: string | null; memberSince: string
  currentStreak: number; longestStreak: number; visitsLast30Days: number; lastCheckInAt: string | null
  balanceCents: number | null; creditBalanceCents: number | null; hasMedicalNotes: boolean
  emergencyContact: { name: string; phone: string | null } | null
  alerts: { level: 'danger' | 'warning' | 'info'; message: string }[]
  membership: { name: string; status: string; creditsRemaining: number | null; renewsAt: string | null; endsAt: string | null } | null
  memberships: { id: string; name: string; status: string; creditsRemaining: number | null }[]
  today: { checkedInAt: string | null; classes: { id: string; status: string; sessionId: string; name: string; color: string; startsAt: string }[]; appointments: { id: string; status: string; startsAt: string; endsAt: string; name: string; color: string; coach: string }[] }
  attendance: { recent: { id: string; at: string; label: string }[]; noShows90: number; lateCancels90: number }
  billing: { nextPayment: { at: string; amountCents: number; name: string } | null; failedPayment: { amountCents: number; reason: string | null; at: string } | null; openInvoices: { id: string; number: string; balanceCents: number; dueDate: string | null; attempts: number }[] } | null
  notes: { id: string; text: string; author: string; at: string }[]
  can: { checkIn: boolean; overrideCheckIn: boolean; book: boolean; bookAppointment: boolean; takePayment: boolean; addNote: boolean }
}

export function QuickProfile({ memberId, onClose, onChanged, onCheckedIn, onOpenAppointment }: { memberId: string | null; onClose: () => void; onChanged?: () => void; onCheckedIn: (result: CheckinResult) => void; onOpenAppointment?: (id: string) => void }) {
  const toast = useToast()
  const { money, time, date, locationId } = useSession()
  const { data, error, loading, reload } = useApi<Quick>(memberId ? `/api/members/${memberId}/quick` : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ message: string; canOverride: boolean } | null>(null)
  const [note, setNote] = useState('')
  const [noting, setNoting] = useState(false)
  const [bookingClass, setBookingClass] = useState(false)
  const [bookingAppointment, setBookingAppointment] = useState(false)
  const [pay, setPay] = useState<PayTarget | null>(null)
  const [texting, setTexting] = useState(false)
  const session = useSession()
  useEffect(() => { setProblem(null); setNote(''); setNoting(false) }, [memberId])
  if (!memberId) return null
  const m = data
  const canText = session.can('communication.text') || session.can('communication.send')
  const changed = () => { reload(); onChanged?.() }

  const doCheckIn = async (force = false) => {
    setBusy('checkin')
    setProblem(null)
    try {
      onCheckedIn(await checkIn(memberId, locationId, force))
      changed()
    } catch (err) {
      const e = err as ClientError
      setProblem({ message: e.message, canOverride: !!(e.details as { canOverride?: boolean } | undefined)?.canOverride && !!m?.can.overrideCheckIn })
    } finally {
      setBusy(null)
    }
  }
  const saveNote = async () => {
    if (!note.trim()) return
    setBusy('note')
    try {
      await api(`/api/members/${memberId}/notes`, { body: { note: note.trim() } })
      toast.success('Note added')
      setNote('')
      setNoting(false)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Modal open onClose={onClose} title={m ? m.name : 'Member'} size="lg">
        {loading ? <SkeletonRows rows={5} /> : error || !m ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <Avatar name={m.name} src={m.photoUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={m.status} />{m.membership && <span className="truncate text-sm font-medium text-fg-heading">{m.membership.name}</span>}{m.membership?.creditsRemaining !== null && m.membership?.creditsRemaining !== undefined && <Badge>{m.membership.creditsRemaining} left</Badge>}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-fg-muted">
                  {m.phone && <a href={`tel:${m.phone}`} className="ui-focus inline-flex items-center gap-1.5 rounded hover:text-fg"><Phone className="h-3.5 w-3.5" aria-hidden />{m.phone}</a>}
                  <a href={`mailto:${m.email}`} className="ui-focus inline-flex min-w-0 items-center gap-1.5 rounded hover:text-fg"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{m.email}</span></a>
                  {m.location && <span>{m.location}</span>}
                </div>
              </div>
            </div>

            {m.alerts.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {m.alerts.map((a) => <li key={a.message} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', a.level === 'danger' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : a.level === 'warning' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-400' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400')}>{a.level !== 'info' && <AlertTriangle className="h-3 w-3" aria-hidden />}{a.message}</li>)}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {m.can.checkIn || m.can.overrideCheckIn ? <Button variant="primary" className="col-span-2 h-12 sm:col-span-1" loading={busy === 'checkin'} disabled={!m.can.checkIn && !problem?.canOverride} onClick={() => doCheckIn()}><ScanLine className="h-4 w-4" />{m.today.checkedInAt ? 'Check in again' : 'Check in'}</Button> : null}
              {m.can.book && <Button className="h-12" onClick={() => setBookingClass(true)}><CalendarPlus className="h-4 w-4" />Book class</Button>}
              {m.can.bookAppointment && <Button className="h-12" onClick={() => setBookingAppointment(true)}><UserRound className="h-4 w-4" />Appointment</Button>}
              {m.can.takePayment && m.billing && m.billing.openInvoices.length > 0 && <Button className="h-12" onClick={() => { const inv = m.billing!.openInvoices[0]; setPay({ id: inv.id, number: inv.number, balanceCents: inv.balanceCents, creditBalanceCents: m.creditBalanceCents || 0, memberId: m.id }) }}><Wallet className="h-4 w-4" />Take payment</Button>}
              {m.can.addNote && <Button className="h-12" onClick={() => setNoting(true)}><StickyNote className="h-4 w-4" />Add note</Button>}
              {canText && m.phone && <Button className="h-12" onClick={() => setTexting(true)}><MessageSquare className="h-4 w-4" />Text</Button>}
            </div>
            {m.today.checkedInAt && !problem && <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden />Checked in today at {time(m.today.checkedInAt)}</p>}
            {problem && (
              <div className="space-y-2">
                <FormError message={problem.message} />
                {problem.canOverride && <Button loading={busy === 'checkin'} onClick={() => doCheckIn(true)}>Check in anyway</Button>}
              </div>
            )}

            {noting && (
              <div className="space-y-2 rounded-xl border border-line p-3">
                <Textarea rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder="Visible to staff only" aria-label="Note" />
                <div className="flex justify-end gap-2"><Button onClick={() => setNoting(false)} disabled={busy === 'note'}>Cancel</Button><Button variant="primary" loading={busy === 'note'} disabled={!note.trim()} onClick={saveNote}>Save note</Button></div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Today</h3>
                {m.today.classes.length === 0 && m.today.appointments.length === 0 ? <p className="text-sm text-fg-muted">Nothing booked today.</p> : (
                  <ul className="space-y-1.5">
                    {[...m.today.classes.map((c) => ({ kind: 'class' as const, at: c.startsAt, c })), ...m.today.appointments.map((a) => ({ kind: 'appointment' as const, at: a.startsAt, a }))].sort((x, y) => x.at.localeCompare(y.at)).map((row) => row.kind === 'class'
                      ? <li key={row.c.id} className="flex items-center gap-2 text-sm"><span className="h-6 w-1 shrink-0 rounded-full" style={{ background: row.c.color }} /><span className="tabular w-[4.5rem] shrink-0 text-fg-muted">{time(row.c.startsAt)}</span><span className="min-w-0 flex-1 truncate text-fg-heading">{row.c.name}</span><StatusBadge status={row.c.status} /></li>
                      : <li key={row.a.id}><button type="button" onClick={() => onOpenAppointment?.(row.a.id)} className="ui-focus flex w-full items-center gap-2 rounded text-left text-sm"><span className="h-6 w-1 shrink-0 rounded-full" style={{ background: row.a.color }} /><span className="tabular w-[4.5rem] shrink-0 text-fg-muted">{time(row.a.startsAt)}</span><span className="min-w-0 flex-1 truncate text-fg-heading">{row.a.name} · {row.a.coach}</span><StatusBadge status={row.a.status} /></button></li>)}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Attendance</h3>
                <dl className="grid grid-cols-4 gap-2 text-center">
                  {[['Streak', m.currentStreak], ['30 days', m.visitsLast30Days], ['No-shows', m.attendance.noShows90], ['Late cancels', m.attendance.lateCancels90]].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-line px-1 py-2"><dd className={cn('tabular text-lg font-semibold', (label === 'No-shows' || label === 'Late cancels') && Number(value) > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-fg-heading')}>{value}</dd><dt className="text-[11px] leading-tight text-fg-muted">{label}</dt></div>
                  ))}
                </dl>
                <p className="mt-1.5 text-xs text-fg-subtle">{m.attendance.recent.length ? `Last visit ${timeAgo(m.attendance.recent[0].at)} · ${m.attendance.recent[0].label}` : 'No visits yet'} · no-shows over 90 days</p>
              </section>
              {m.billing && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Billing</h3>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-fg-muted">Balance due</dt><dd className={cn('tabular font-medium', (m.balanceCents || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-heading')}>{money(m.balanceCents)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-fg-muted">Next payment</dt><dd className="tabular text-right text-fg-heading">{m.billing.nextPayment ? `${money(m.billing.nextPayment.amountCents)} on ${date(m.billing.nextPayment.at)}` : '—'}</dd></div>
                    {m.billing.failedPayment && <div className="flex justify-between gap-3"><dt className="text-red-600 dark:text-red-400">Failed payment</dt><dd className="text-right text-red-600 dark:text-red-400">{money(m.billing.failedPayment.amountCents)} · {timeAgo(m.billing.failedPayment.at)}</dd></div>}
                  </dl>
                </section>
              )}
              <section className={m.billing ? '' : 'md:col-span-1'}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Notes</h3>
                {m.notes.length === 0 ? <p className="text-sm text-fg-muted">No notes yet.</p> : (
                  <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
                    {m.notes.map((n) => <li key={n.id} className="rounded-lg bg-subtle/60 px-3 py-2"><p className="whitespace-pre-wrap text-sm text-fg">{n.text}</p><p className="mt-0.5 text-xs text-fg-subtle">{n.author} · {timeAgo(n.at)}</p></li>)}
                  </ul>
                )}
              </section>
            </div>
            <div className="flex justify-end border-t border-line pt-3"><Link href={`/members/${m.id}`} className="ui-focus inline-flex items-center gap-1.5 rounded text-sm font-medium text-accent-text hover:underline">View full profile<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link></div>
          </div>
        )}
      </Modal>
      {m && <BookClassModal memberId={m.id} memberName={m.name} open={bookingClass} onClose={() => setBookingClass(false)} onDone={changed} />}
      {m && <BookAppointmentModal open={bookingAppointment} onClose={() => setBookingAppointment(false)} onDone={changed} member={{ id: m.id, name: m.name }} />}
      <PayModal invoice={pay} onClose={() => setPay(null)} onDone={changed} />
      {m && <TextModal open={texting} onClose={() => setTexting(false)} source={{ memberId: m.id }} name={m.name} />}
    </>
  )
}
