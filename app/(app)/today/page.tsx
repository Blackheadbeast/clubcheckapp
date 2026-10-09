'use client'

// The gym's day on one screen. Built for the people on the floor: what is
// happening now, what is next, and the fastest route to checking someone in.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, CalendarClock, CalendarDays, Check, CheckCircle2, ClipboardList, CreditCard, MapPin, ScanLine, Search, UserPlus, UserRound, Users } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { timeAgo } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, EmptyState, ErrorState, Input, Page, Skeleton, StatusBadge, cn, useToast } from '@/components/ui'
import { AppointmentDetailModal, BookAppointmentModal } from '@/components/appointments/AppointmentModals'
import { RosterModal } from '@/components/today/RosterModal'
import { CheckinConfirmation, QuickProfile, checkIn, type CheckinResult } from '@/components/today/QuickProfile'

interface ClassItem { id: string; name: string; color: string; startsAt: string; endsAt: string; coach: { id: string; name: string } | null; location: string | null; room: string | null; capacity: number; booked: number; checkedIn: number; noShows: number; waitlisted: number; spotsLeft: number }
interface ApptItem { id: string; status: string; startsAt: string; endsAt: string; type: { name: string; color: string; durationMin: number }; staff: { id: string; name: string }; member: { id: string; name: string; photoUrl: string | null }; location: string | null }
interface Today {
  date: string; serverTime: string; timezone: string; location: { id: string; name: string } | null; locationLocked: boolean; mine: boolean; canSeeAllAppointments: boolean
  classes: ClassItem[]; appointments: ApptItem[]
  recentCheckins: { id: string; at: string; source: string; label: string; member: { id: string; name: string; photoUrl: string | null; currentStreak: number } }[]
  summary: { checkins: number; classes: number; classesRemaining: number; appointments: number; appointmentsRemaining: number; booked: number; toRecord: number; inNow: number }
}
interface Found { id: string; name: string; email: string; phone: string | null; photoUrl: string | null; status: string; exact: boolean; membership: string | null; today: { kind: 'class' | 'appointment'; name: string; startsAt: string; status: string } | null; checkedInAt: string | null; balanceCents: number | null }
interface Note { id: string; type: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string }
type Entry = ({ kind: 'class' } & ClassItem) | ({ kind: 'appointment' } & ApptItem)

export default function TodayPage() {
  const toast = useToast()
  const { gym, user, can, time, money, locationId, locations } = useSession()
  const floorCoach = user.role === 'coach' || user.role === 'trainer'
  const [mine, setMine] = useState(floorCoach)
  const { data, error, loading, reload } = useApi<Today>(`/api/today${qs({ locationId, mine: mine && user.type === 'staff' ? 1 : null })}`)
  const notes = useApi<Note[]>('/api/notifications')
  const [now, setNow] = useState(() => Date.now())
  const [rosterId, setRosterId] = useState<{ id: string; tab: 'roster' | 'waitlist' } | null>(null)
  const [appointmentId, setAppointmentId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)
  const [confirmed, setConfirmed] = useState<CheckinResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showEarlier, setShowEarlier] = useState(false)
  const [query, setQuery] = useState('')
  const term = useDebounced(query, 180)
  const found = useApi<Found[]>(can('members.view') && term.trim().length >= 2 ? `/api/today/members?q=${encodeURIComponent(term.trim())}` : null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Keep the clock and the figures fresh without anyone touching the screen.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    const refresh = setInterval(() => { if (document.visibilityState === 'visible') reload() }, 60_000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [reload])
  const refreshAll = useCallback(() => { reload(); found.reload() }, [reload, found])
  const done = useCallback(() => setConfirmed(null), [])

  const entries = useMemo<Entry[]>(() => {
    if (!data) return []
    return [...data.classes.map((c) => ({ kind: 'class' as const, ...c })), ...data.appointments.map((a) => ({ kind: 'appointment' as const, ...a }))].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  }, [data])
  const live = entries.filter((e) => new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now)
  const upcoming = entries.filter((e) => new Date(e.startsAt).getTime() > now)
  const earlier = entries.filter((e) => new Date(e.endsAt).getTime() <= now)

  const quickCheckIn = async (m: { id: string; name: string }, force = false) => {
    setBusy(m.id)
    try {
      setConfirmed(await checkIn(m.id, locationId, force))
      setQuery('')
      refreshAll()
      searchRef.current?.focus()
    } catch (err) {
      const e = err as ClientError
      // A blocked member needs a person to look, not a silent failure: open their profile with the reason.
      toast.error(e.message)
      setMemberId(m.id)
    } finally {
      setBusy(null)
    }
  }
  const markAppointment = async (a: ApptItem) => {
    setBusy(a.id)
    try {
      await api(`/api/appointments/${a.id}`, { body: { action: 'complete' } })
      setConfirmed({ name: a.member.name, label: a.type.name, at: new Date().toISOString(), streak: 0, duplicate: false })
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  // A scanner types the code and presses Enter: one exact match checks straight in.
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !found.data || found.loading) return
    const exact = found.data.find((m) => m.exact) || (found.data.length === 1 ? found.data[0] : null)
    if (exact && can('attendance.manage')) quickCheckIn(exact)
    else if (exact) setMemberId(exact.id)
  }

  const dateLabel = new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: gym.timezone })
  const where = data?.location?.name || (locations.length > 1 ? 'All locations' : locations[0]?.name || gym.name)
  const actions = [
    can('attendance.manage') && { label: 'Check in', icon: ScanLine, onClick: () => searchRef.current?.focus(), primary: true },
    can('members.view') && { label: 'Find member', icon: Search, onClick: () => searchRef.current?.focus() },
    can('appointments.manage') && { label: 'Book appointment', icon: UserRound, onClick: () => setBooking(true) },
    can('classes.view') && { label: 'Classes', icon: CalendarDays, href: '/schedule' },
    can('appointments.view') && { label: 'Appointments', icon: CalendarClock, href: '/appointments' },
    can('billing.manage') && { label: 'Take payment', icon: CreditCard, href: '/billing/invoices?status=open' },
    can('members.manage') && { label: 'Add member', icon: UserPlus, href: '/members?new=1' },
    can('leads.view') && user.role === 'sales' && { label: 'Leads', icon: ClipboardList, href: '/leads' },
  ].filter(Boolean) as { label: string; icon: typeof Search; onClick?: () => void; href?: string; primary?: boolean }[]

  return (
    <Page>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg-heading sm:text-2xl">Today</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-fg-muted"><span>{dateLabel}</span><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{where}</span><span className="tabular">{time(new Date(now))}</span></p>
        </div>
        {user.type === 'staff' && can('classes.view') && (
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Whose day">
            {[{ k: true, label: floorCoach ? 'My day' : 'Mine' }, { k: false, label: 'Everyone' }].map((o) => <button key={o.label} role="tab" type="button" aria-selected={mine === o.k} onClick={() => setMine(o.k)} className={cn('ui-focus h-9 rounded-md px-3 text-sm font-medium', mine === o.k ? 'bg-subtle text-fg-heading' : 'text-fg-muted')}>{o.label}</button>)}
          </div>
        )}
      </div>

      <nav aria-label="Quick actions" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {actions.map((a) => {
          const cls = cn('ui-focus inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-medium shadow-card', a.primary ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-fg hover:bg-subtle')
          return a.href ? <Link key={a.label} href={a.href} className={cls}><a.icon className="h-4 w-4" aria-hidden />{a.label}</Link> : <button key={a.label} type="button" onClick={a.onClick} className={cls}><a.icon className="h-4 w-4" aria-hidden />{a.label}</button>
        })}
      </nav>

      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
          {/* First in the markup so it leads on phones and portrait tablets; top right on wide screens. */}
          {can('members.view') && (
            <Card className="min-w-0 xl:col-start-3 xl:row-start-1">
                <label htmlFor="today-search" className="mb-2 block text-sm font-semibold text-fg-heading">{can('attendance.manage') ? 'Check in or find a member' : 'Find a member'}</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-subtle" aria-hidden />
                  <Input id="today-search" ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder="Name, phone, email or scan a code" className="h-12 pl-10 text-base" autoComplete="off" />
                </div>
                {term.trim().length >= 2 && (
                  <ul className="mt-2 divide-y divide-line" aria-live="polite">
                    {found.loading && !found.data ? <li className="py-3"><Skeleton className="h-10 w-full" /></li> : found.error ? <li className="py-3 text-sm text-red-600 dark:text-red-400">{found.error.message}</li> : (found.data || []).length === 0 ? <li className="py-3 text-sm text-fg-muted">No members match "{term.trim()}".</li> : (found.data || []).map((m) => (
                      <li key={m.id} className="flex items-center gap-2 py-2">
                        <button type="button" onClick={() => setMemberId(m.id)} className="ui-focus flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left">
                          <Avatar name={m.name} src={m.photoUrl} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium text-fg-heading">{m.name}</span>{m.status !== 'active' && <StatusBadge status={m.status} />}</span>
                            <span className="block truncate text-xs text-fg-muted">{m.today ? `${m.today.name} ${time(m.today.startsAt)}` : m.membership || 'No membership'}{m.balanceCents ? <span className="text-red-600 dark:text-red-400"> · owes {money(m.balanceCents)}</span> : null}</span>
                          </span>
                        </button>
                        {m.checkedInAt ? <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" aria-hidden />{time(m.checkedInAt)}</span>
                          : can('attendance.manage') ? <Button variant="primary" className="h-10 shrink-0" loading={busy === m.id} onClick={() => quickCheckIn(m)}>Check in</Button> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          <div className="min-w-0 space-y-4 xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Checked in today', value: data?.summary.checkins },
                { label: 'In class now', value: data?.summary.inNow },
                { label: 'Still expected', value: data?.summary.booked, hint: 'Booked, not yet in' },
                { label: 'To record', value: data?.summary.toRecord, hint: 'Finished appointments', warn: (data?.summary.toRecord || 0) > 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-line bg-surface p-3 shadow-card">
                  <p className="text-xs text-fg-muted">{s.label}</p>
                  {loading || !data ? <Skeleton className="mt-1 h-7 w-10" /> : <p className={cn('tabular mt-0.5 text-2xl font-semibold', s.warn ? 'text-amber-700 dark:text-amber-400' : 'text-fg-heading')}>{s.value}</p>}
                  {s.hint && <p className="text-[11px] text-fg-subtle">{s.hint}</p>}
                </div>
              ))}
            </div>

            <section aria-labelledby="now-heading">
              <h2 id="now-heading" className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle"><span className="relative flex h-2 w-2"><span className={cn('absolute inline-flex h-full w-full rounded-full bg-emerald-500', live.length > 0 && 'animate-ping opacity-60')} /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>Now</h2>
              {loading || !data ? <Skeleton className="h-28 rounded-xl" /> : live.length === 0 ? (
                <Card className="py-5 text-center text-sm text-fg-muted">Nothing is running right now.{upcoming[0] ? ` Next: ${upcoming[0].kind === 'class' ? upcoming[0].name : `${upcoming[0].type.name} with ${upcoming[0].member.name}`} at ${time(upcoming[0].startsAt)}.` : ''}</Card>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{live.map((e) => <EntryCard key={e.id} e={e} live time={time} can={can} busy={busy} onRoster={(tab) => setRosterId({ id: e.id, tab })} onAppointment={() => setAppointmentId(e.id)} onMember={setMemberId} onAttended={markAppointment} />)}</div>
              )}
            </section>

            <section aria-labelledby="next-heading">
              <h2 id="next-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Coming up{data ? ` · ${upcoming.length}` : ''}</h2>
              {loading || !data ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div> : upcoming.length === 0 ? (
                <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title={entries.length === 0 ? (mine ? 'Nothing in your diary today' : 'Nothing scheduled today') : 'That is everything for today'} description={entries.length === 0 && mine ? 'Switch to Everyone to see the whole gym.' : undefined} action={entries.length === 0 && mine ? <Button onClick={() => setMine(false)}>Show everyone</Button> : undefined} /></Card>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{upcoming.map((e) => <EntryCard key={e.id} e={e} time={time} can={can} busy={busy} onRoster={(tab) => setRosterId({ id: e.id, tab })} onAppointment={() => setAppointmentId(e.id)} onMember={setMemberId} onAttended={markAppointment} />)}</div>
              )}
            </section>

            {earlier.length > 0 && (
              <section>
                <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="ui-focus mb-2 rounded text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg">Earlier today · {earlier.length} {showEarlier ? '▾' : '▸'}</button>
                {showEarlier && <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{earlier.map((e) => <EntryCard key={e.id} e={e} past time={time} can={can} busy={busy} onRoster={(tab) => setRosterId({ id: e.id, tab })} onAppointment={() => setAppointmentId(e.id)} onMember={setMemberId} onAttended={markAppointment} />)}</div>}
              </section>
            )}
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 md:items-start xl:col-start-3 xl:grid-cols-1">
            <Card padded={false}>
              <h2 className="flex items-center gap-2 px-4 pt-4 text-sm font-semibold text-fg-heading"><CheckCircle2 className="h-4 w-4 text-fg-muted" aria-hidden />Recent check-ins</h2>
              {loading || !data ? <div className="space-y-2 p-4"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div> : data.recentCheckins.length === 0 ? <p className="px-4 pb-4 pt-2 text-sm text-fg-muted">Nobody has checked in yet today.</p> : (
                <ul className="mt-1 divide-y divide-line/60">
                  {data.recentCheckins.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => setMemberId(c.member.id)} className="ui-focus flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/50"><Avatar name={c.member.name} src={c.member.photoUrl} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-fg-heading">{c.member.name}</span><span className="block truncate text-xs text-fg-muted">{c.label}</span></span><span className="tabular shrink-0 text-xs text-fg-subtle">{time(c.at)}</span></button></li>
                  ))}
                </ul>
              )}
            </Card>

            <Card padded={false}>
              <h2 className="flex items-center gap-2 px-4 pt-4 text-sm font-semibold text-fg-heading"><Bell className="h-4 w-4 text-fg-muted" aria-hidden />Needs attention</h2>
              {notes.loading ? <div className="p-4"><Skeleton className="h-9 w-full" /></div> : (notes.data || []).filter((n) => !n.readAt).length === 0 ? <p className="px-4 pb-4 pt-2 text-sm text-fg-muted">Nothing waiting for you.</p> : (
                <ul className="mt-1 divide-y divide-line/60">
                  {(notes.data || []).filter((n) => !n.readAt).slice(0, 6).map((n) => {
                    const body = <><span className="block truncate text-sm text-fg-heading">{n.title}</span>{n.body && <span className="block truncate text-xs text-fg-muted">{n.body}</span>}<span className="block text-[11px] text-fg-subtle">{timeAgo(n.createdAt)}</span></>
                    return <li key={n.id}>{n.href ? <Link href={n.href} className="ui-focus block px-4 py-2.5 hover:bg-subtle/50">{body}</Link> : <div className="px-4 py-2.5">{body}</div>}</li>
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <RosterModal sessionId={rosterId?.id || null} initialTab={rosterId?.tab} onClose={() => setRosterId(null)} onChanged={reload} onOpenMember={setMemberId} />
      <AppointmentDetailModal id={appointmentId} onClose={() => setAppointmentId(null)} onChanged={reload} />
      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} onDone={reload} />
      <QuickProfile memberId={memberId} onClose={() => setMemberId(null)} onChanged={refreshAll} onCheckedIn={setConfirmed} onOpenAppointment={(id) => { setMemberId(null); setAppointmentId(id) }} />
      <CheckinConfirmation result={confirmed} onDone={done} />
    </Page>
  )
}

function EntryCard({ e, live, past, time, can, busy, onRoster, onAppointment, onMember, onAttended }: {
  e: Entry; live?: boolean; past?: boolean; time: (v: string | Date) => string; can: (p: any) => boolean; busy: string | null
  onRoster: (tab: 'roster' | 'waitlist') => void; onAppointment: () => void; onMember: (id: string) => void; onAttended: (a: ApptItem) => void
}) {
  const frame = cn('flex flex-col rounded-xl border bg-surface shadow-card', live ? 'border-emerald-500/50' : 'border-line', past && 'opacity-75')
  if (e.kind === 'class') {
    const full = e.spotsLeft === 0
    const pct = e.capacity ? Math.min(100, Math.round((e.booked / e.capacity) * 100)) : 0
    return (
      <article className={frame}>
        <button type="button" onClick={() => onRoster('roster')} className="ui-focus flex-1 rounded-t-xl p-3.5 text-left" aria-label={`${e.name} at ${time(e.startsAt)}: open roster`}>
          <div className="flex items-start gap-2.5">
            <span className="mt-1 h-9 w-1 shrink-0 rounded-full" style={{ background: e.color }} />
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2"><span className="truncate text-base font-semibold text-fg-heading">{e.name}</span><span className="tabular shrink-0 text-sm text-fg-muted">{time(e.startsAt)}</span></p>
              <p className="truncate text-xs text-fg-muted">{[e.coach ? `Coach ${e.coach.name}` : 'No coach', e.location, e.room].filter(Boolean).join(' · ')}</p>
            </div>
            {live && <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Live</span>}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden><div className={cn('h-full rounded-full', full ? 'bg-amber-500' : 'bg-accent')} style={{ width: `${pct}%` }} /></div>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <div className="flex gap-1"><dd className={cn('tabular font-semibold', full ? 'text-amber-700 dark:text-amber-400' : 'text-fg-heading')}>{e.booked} / {e.capacity}</dd><dt className="text-fg-muted">booked</dt></div>
            <div className="flex gap-1"><dd className="tabular font-semibold text-fg-heading">{e.checkedIn}</dd><dt className="text-fg-muted">checked in</dt></div>
            {e.noShows > 0 && <div className="flex gap-1"><dd className="tabular font-semibold text-fg-heading">{e.noShows}</dd><dt className="text-fg-muted">no-show{e.noShows === 1 ? '' : 's'}</dt></div>}
            {e.waitlisted > 0 && <div className="flex gap-1"><dd className="tabular font-semibold text-amber-700 dark:text-amber-400">{e.waitlisted}</dd><dt className="text-fg-muted">waitlisted</dt></div>}
          </dl>
        </button>
        <div className="flex gap-2 border-t border-line p-2">
          <Button className="h-10 flex-1" variant={live ? 'primary' : undefined} onClick={() => onRoster('roster')}><Users className="h-4 w-4" />Roster</Button>
          {e.waitlisted > 0 && <Button className="h-10" onClick={() => onRoster('waitlist')}>Waitlist · {e.waitlisted}</Button>}
        </div>
      </article>
    )
  }
  const overdue = e.status === 'booked' && past
  const recordable = e.status === 'booked' && new Date(e.startsAt).getTime() - Date.now() <= 30 * 60_000
  return (
    <article className={cn(frame, 'border-dashed')}>
      <button type="button" onClick={onAppointment} className="ui-focus flex-1 rounded-t-xl p-3.5 text-left" aria-label={`${e.type.name} with ${e.member.name} at ${time(e.startsAt)}: open`}>
        <div className="flex items-start gap-2.5">
          <span className="mt-1 h-9 w-1 shrink-0 rounded-full" style={{ background: e.type.color }} />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-fg-heading"><UserRound className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden /><span className="truncate">{e.member.name}</span></p>
            <p className="truncate text-xs text-fg-muted"><span className="tabular font-medium text-fg">{time(e.startsAt)}</span> · {[e.type.name, e.staff.name, e.location].filter(Boolean).join(' · ')}</p>
          </div>
          {e.status !== 'booked' ? <StatusBadge status={e.status} /> : overdue ? <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">To record</span> : live ? <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Live</span> : null}
        </div>
      </button>
      <div className="flex gap-2 border-t border-line p-2">
        {e.status === 'booked' && can('appointments.manage') && <Button className="h-10 flex-1" variant={live || overdue ? 'primary' : undefined} disabled={!recordable} loading={busy === e.id} onClick={() => onAttended(e)}><Check className="h-4 w-4" />Check in</Button>}
        <Button className="h-10 flex-1" onClick={onAppointment}>Open</Button>
        {can('members.view') && <Button className="h-10" aria-label={`Open ${e.member.name}`} onClick={() => onMember(e.member.id)}><UserRound className="h-4 w-4" /></Button>}
      </div>
    </article>
  )
}
