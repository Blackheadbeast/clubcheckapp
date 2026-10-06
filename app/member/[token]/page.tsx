'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode'
import { AlertTriangle, CalendarDays, CalendarPlus, Check, CreditCard, Flame, Home, Trophy, UserRound } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { addDaysToDate } from '@/lib/dates'
import { formatDate, formatDateShort, formatMoney, formatTime, titleCase } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/hooks'
import { Avatar, Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, Skeleton, Spinner, StatusBadge, ToastProvider, cn, useToast } from '@/components/ui'

interface Upcoming { id: string; status: string; offerExpiresAt: string | null; waitlistPosition: number | null; sessionId: string; name: string; color: string; startsAt: string; endsAt: string; coach: string | null; location: string | null }
interface Portal {
  gym: { name: string; logoUrl: string | null; address: string | null; timezone: string; currency: string; cancelWindowHours: number; bookingWindowDays: number }
  member: { name: string; email: string; phone: string | null; photoUrl: string | null; status: string; qrCode: string; joinedAt: string; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; emailOptIn: boolean; smsOptIn: boolean; waiverRequired: boolean; waiverUrl: string; creditBalanceCents: number }
  memberships: { id: string; name: string; description: string | null; status: string; type: string; priceCents: number; interval: string; creditsRemaining: number | null; classLimit: number | null; classLimitPeriod: string; renewsAt: string | null; endsAt: string | null; trialEndsAt: string | null; frozenUntil: string | null; paymentMethod: string; startedAt: string }[]
  upcoming: Upcoming[]
  attendance: { totalVisits: number; visitsLast30Days: number; currentStreak: number; longestStreak: number; lastVisitAt: string | null; recent: { id: string; at: string; label: string }[]; milestones: { visits: number; reached: boolean }[]; nextMilestone: number | null }
  billing: { balanceCents: number; overdueCents: number; invoices: { id: string; number: string; status: string; totalCents: number; balanceCents: number; date: string; dueDate: string | null; paidAt: string | null; description: string }[] }
  notifications: { id: string; title: string; body: string; at: string }[]
}
interface ScheduleSession { id: string; name: string; color: string; classTypeId: string; startsAt: string; endsAt: string; coach: string | null; location: string | null; capacity: number; spotsLeft: number; waitlisted: number; waitlistOpen: boolean; myBooking: { id: string; status: string } | null; bookable: boolean; opensAt: string | null }
interface Schedule { today: string; classTypes: { id: string; name: string; color: string }[]; sessions: ScheduleSession[] }

type Tab = 'home' | 'schedule' | 'membership' | 'profile'
const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'home', label: 'Home', icon: Home }, { key: 'schedule', label: 'Schedule', icon: CalendarDays }, { key: 'membership', label: 'Membership', icon: CreditCard }, { key: 'profile', label: 'Profile', icon: UserRound },
]

function PortalApp() {
  const { token } = useParams<{ token: string }>()
  const base = `/api/portal/${token}`
  const { data, error, loading, reload } = useApi<Portal>(base)
  const [tab, setTab] = useState<Tab>('home')

  useEffect(() => {
    // Lets members add the portal to their home screen like an app.
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link')
      link.rel = 'manifest'
      link.href = `/api/member-portal/manifest?token=${token}`
      document.head.appendChild(link)
    }
  }, [token])

  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-canvas"><Spinner className="h-6 w-6" /></div>
  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
        <Card className="max-w-sm"><ErrorState error={error?.status === 404 ? error.message : error || 'Could not load your account.'} onRetry={error?.status === 404 ? undefined : reload} /></Card>
      </div>
    )
  }
  const tz = data.gym.timezone
  const money = (c: number) => formatMoney(c, data.gym.currency)

  return (
    <div className="min-h-dvh bg-canvas pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.gym.logoUrl ? <img src={data.gym.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">{data.gym.name[0]}</span>}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-heading">{data.gym.name}</span>
          <Avatar name={data.member.name} src={data.member.photoUrl} size="sm" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {tab === 'home' && <HomeTab data={data} base={base} tz={tz} money={money} onChange={reload} onBook={() => setTab('schedule')} />}
        {tab === 'schedule' && <ScheduleTab base={base} tz={tz} gym={data.gym} onChange={reload} />}
        {tab === 'membership' && <MembershipTab data={data} tz={tz} money={money} />}
        {tab === 'profile' && <ProfileTab data={data} base={base} onSaved={reload} />}
      </main>

      <nav aria-label="Member portal" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); window.scrollTo(0, 0) }} className={cn('ui-focus flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', tab === key ? 'text-accent-text' : 'text-fg-muted')}>
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

function ClassRow({ item, tz, children }: { item: { name: string; color: string; startsAt: string; coach: string | null; location: string | null }; tz: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: item.color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg-heading">{item.name}</p>
        <p className="truncate text-xs text-fg-muted">{new Date(item.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })} · {formatTime(item.startsAt, tz)}{item.coach ? ` · ${item.coach}` : ''}</p>
        {item.location && <p className="truncate text-xs text-fg-subtle">{item.location}</p>}
      </div>
      {children}
    </div>
  )
}

function HomeTab({ data, base, tz, money, onChange, onBook }: { data: Portal; base: string; tz: string; money: (c: number) => string; onChange: () => void; onBook: () => void }) {
  const toast = useToast()
  const [qr, setQr] = useState('')
  const [showQr, setShowQr] = useState(false)
  const [cancelling, setCancelling] = useState<Upcoming | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [opened, setOpened] = useState<Portal['notifications'][number] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const booked = data.upcoming.filter((b) => b.status !== 'offered')
  useEffect(() => { QRCode.toDataURL(data.member.qrCode, { width: 480, margin: 2 }).then(setQr).catch(() => {}) }, [data.member.qrCode])

  const act = async (booking: Upcoming, action: 'cancel' | 'claim') => {
    setBusy(booking.id)
    try {
      const result = await api<{ late: boolean; creditReturned: boolean }>(`${base}/bookings/${booking.id}`, { body: { action } })
      toast.success(action === 'claim' ? `You're booked into ${booking.name}` : result.late ? 'Cancelled. This counted as a late cancellation.' : booking.status === 'waitlisted' ? 'You left the waitlist' : 'Booking cancelled')
      onChange()
    } catch (err) {
      toast.error((err as ClientError).message)
      onChange()
    } finally {
      setBusy(null)
      setCancelling(null)
    }
  }
  const lateIf = (b: Upcoming) => b.status === 'booked' && new Date(b.startsAt).getTime() - Date.now() < data.gym.cancelWindowHours * 3_600_000
  const a = data.attendance
  const blocked = ['frozen', 'cancelled', 'inactive'].includes(data.member.status)

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Hi, {data.member.name.split(' ')[0]}</h1>
        <p className="text-sm text-fg-muted">{data.memberships[0] ? data.memberships[0].name : 'No active membership'}{a.lastVisitAt ? ` · last visit ${formatDateShort(a.lastVisitAt, tz)}` : ''}</p>
      </div>

      {data.upcoming.filter((b) => b.status === 'offered').map((b) => (
        <Card key={b.id} className="border-sky-500/50">
          <p className="text-sm font-semibold text-fg-heading">A spot opened up in {b.name}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{formatDate(b.startsAt, tz)} at {formatTime(b.startsAt, tz)}. It's held for you until {formatTime(b.offerExpiresAt, tz)}.</p>
          <div className="mt-3 flex gap-2"><Button variant="primary" loading={busy === b.id} onClick={() => act(b, 'claim')}>Claim my spot</Button><Button disabled={busy === b.id} onClick={() => act(b, 'cancel')}>No thanks</Button></div>
        </Card>
      ))}
      {data.member.status === 'past_due' || data.billing.overdueCents > 0 ? (
        <Notice tone="danger">You have an overdue balance of {money(data.billing.overdueCents || data.billing.balanceCents)}. Please settle it at the front desk to keep booking classes.</Notice>
      ) : blocked ? (
        <Notice tone="warning">Your membership is {data.member.status === 'frozen' ? 'frozen' : 'not active'}, so check-in and booking are paused. Talk to the front desk to get going again.</Notice>
      ) : null}
      {data.member.waiverRequired && <Notice tone="warning">Please sign the liability waiver before your next visit. <a href={data.member.waiverUrl} className="font-semibold underline">Sign now</a></Notice>}

      <Card className="text-center">
        <button type="button" onClick={() => setShowQr(true)} className="ui-focus mx-auto block rounded-xl" aria-label="Show my check-in code full screen">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Your check-in QR code" className="mx-auto h-44 w-44 rounded-xl bg-white p-1" />
          ) : <Skeleton className="mx-auto h-44 w-44 rounded-xl" />}
        </button>
        <p className="mt-2 text-sm font-medium text-fg-heading">Your check-in code</p>
        <p className="text-xs text-fg-muted">Scan it at the front desk or kiosk. Tap to enlarge.</p>
      </Card>

      <section>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-fg-heading">Upcoming classes</h2><button type="button" onClick={onBook} className="ui-focus rounded text-sm font-medium text-accent-text">Book a class</button></div>
        {booked.length === 0 ? (
          <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nothing booked" description="Find your next class on the schedule." action={<Button variant="primary" onClick={onBook}>See the schedule</Button>} /></Card>
        ) : (
          <div className="space-y-2">
            {(showAll ? booked : booked.slice(0, 3)).map((b) => (
              <Card key={b.id} className="p-3 sm:p-3">
                <ClassRow item={b} tz={tz}>{b.status === 'waitlisted' ? <Badge tone="amber">Waitlist #{b.waitlistPosition}</Badge> : <Badge tone="green">Booked</Badge>}</ClassRow>
                <div className="mt-2.5 flex gap-2 border-t border-line pt-2.5">
                  {b.status === 'booked' && <a href={`${base}/bookings/${b.id}/calendar`} className="flex-1"><Button size="sm" className="w-full" icon={<CalendarPlus className="h-3.5 w-3.5" />}>Add to calendar</Button></a>}
                  <Button size="sm" className="flex-1" disabled={busy === b.id} onClick={() => setCancelling(b)}>{b.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel'}</Button>
                </div>
              </Card>
            ))}
            {booked.length > 3 && <Button variant="ghost" className="w-full" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${booked.length} bookings`}</Button>}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-heading">Your progress</h2>
        <div className="grid grid-cols-3 gap-2">
          <Tile icon={<Flame className="h-4 w-4 text-orange-500" />} value={a.currentStreak} label={`day streak${a.longestStreak > a.currentStreak ? ` · best ${a.longestStreak}` : ''}`} />
          <Tile value={a.visitsLast30Days} label="visits in 30 days" />
          <Tile icon={<Trophy className="h-4 w-4 text-amber-500" />} value={a.totalVisits} label="total visits" />
        </div>
        <Card className="mt-2">
          <p className="text-sm font-medium text-fg-heading">Milestones</p>
          {a.nextMilestone && <p className="text-xs text-fg-muted">{a.nextMilestone - a.totalVisits} more visit{a.nextMilestone - a.totalVisits === 1 ? '' : 's'} to reach {a.nextMilestone}.</p>}
          <ol className="mt-3 flex flex-wrap gap-2">
            {a.milestones.map((m) => (
              <li key={m.visits} className={cn('tabular flex h-12 w-12 flex-col items-center justify-center rounded-full border text-xs font-semibold', m.reached ? 'border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-400' : 'border-line text-fg-subtle')} aria-label={`${m.visits} visits: ${m.reached ? 'reached' : 'not yet'}`}>
                {m.reached && <Check className="h-3 w-3" aria-hidden />}
                {m.visits}
              </li>
            ))}
          </ol>
        </Card>
      </section>

      {data.notifications.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg-heading">Messages from {data.gym.name}</h2>
          <Card padded={false}>
            <ul className="divide-y divide-line/60">
              {data.notifications.map((n) => (
                <li key={n.id}><button type="button" onClick={() => setOpened(n)} className="ui-focus flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-subtle/50"><span className="min-w-0 truncate text-sm text-fg">{n.title}</span><span className="shrink-0 text-xs text-fg-subtle">{formatDateShort(n.at, tz)}</span></button></li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <Modal open={showQr} onClose={() => setShowQr(false)} title="Check-in code" size="sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt="Your check-in QR code" className="mx-auto w-full max-w-xs rounded-xl bg-white p-2" />}
        <p className="mt-3 text-center text-sm font-medium text-fg-heading">{data.member.name}</p>
      </Modal>
      <Modal open={!!opened} onClose={() => setOpened(null)} title={opened?.title || ''} description={opened ? formatDate(opened.at, tz) : undefined}><p className="whitespace-pre-wrap text-sm text-fg">{opened?.body}</p></Modal>
      <ConfirmModal open={!!cancelling} onClose={() => setCancelling(null)} onConfirm={() => cancelling && act(cancelling, 'cancel')} loading={!!busy} danger={!!cancelling && lateIf(cancelling)} title={cancelling?.status === 'waitlisted' ? 'Leave the waitlist?' : 'Cancel this booking?'} confirmLabel={cancelling?.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel booking'}>
        {cancelling && <p>{cancelling.name}, {formatDate(cancelling.startsAt, tz)} at {formatTime(cancelling.startsAt, tz)}.</p>}
        {cancelling && lateIf(cancelling) && <p className="font-medium text-red-600 dark:text-red-400">This class starts in less than {data.gym.cancelWindowHours} hours, so it counts as a late cancellation and any class credit is not returned.</p>}
      </ConfirmModal>
    </>
  )
}

function Notice({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm', tone === 'danger' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400')}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

function Tile({ icon, value, label }: { icon?: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <p className="tabular flex items-center gap-1 text-xl font-semibold text-fg-heading">{icon}{value}</p>
      <p className="text-[11px] leading-tight text-fg-muted">{label}</p>
    </div>
  )
}

function ScheduleTab({ base, tz, gym, onChange }: { base: string; tz: string; gym: Portal['gym']; onChange: () => void }) {
  const toast = useToast()
  const today = useMemo(() => new Date().toLocaleDateString('en-CA', { timeZone: tz }), [tz])
  const [date, setDate] = useState(today)
  const [classTypeId, setClassTypeId] = useState('')
  const { data, error, loading, reload } = useApi<Schedule>(`${base}/schedule?date=${date}&days=1${classTypeId ? `&classTypeId=${classTypeId}` : ''}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [waitlist, setWaitlist] = useState<ScheduleSession | null>(null)
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null)
  const days = useMemo(() => Array.from({ length: Math.min(14, gym.bookingWindowDays + 1) }, (_, i) => addDaysToDate(today, i)), [today, gym.bookingWindowDays])

  const book = async (s: ScheduleSession, joinWaitlist: boolean) => {
    setBusy(s.id)
    setProblem(null)
    try {
      const result = await api<{ status: string; waitlistPosition: number | null; usedCredit: boolean }>(`${base}/bookings`, { body: { sessionId: s.id, joinWaitlist } })
      toast.success(result.status === 'waitlisted' ? `You're #${result.waitlistPosition} on the waitlist for ${s.name}` : `Booked into ${s.name}${result.usedCredit ? ' · 1 credit used' : ''}`)
      reload()
      onChange()
    } catch (err) {
      const e = err as ClientError
      // Someone took the last spot while they were looking: offer the waitlist rather than a dead end.
      if (e.code === 'class_full' && (e.details as { waitlistAvailable?: boolean })?.waitlistAvailable) setWaitlist(s)
      else setProblem({ id: s.id, message: e.message })
      reload()
    } finally {
      setBusy(null)
    }
  }
  const cancel = async (s: ScheduleSession) => {
    setBusy(s.id)
    try {
      const result = await api<{ late: boolean }>(`${base}/bookings/${s.myBooking!.id}`, { body: { action: 'cancel' } })
      toast.success(result.late ? 'Cancelled. This counted as a late cancellation.' : 'Cancelled')
      reload()
      onChange()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Schedule</h1>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Day">
        {days.map((d) => {
          const [y, m, day] = d.split('-').map(Number)
          const utc = new Date(Date.UTC(y, m - 1, day))
          return (
            <button key={d} role="tab" type="button" aria-selected={date === d} onClick={() => setDate(d)} className={cn('ui-focus flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-xs font-medium transition', date === d ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-fg-muted')}>
              <span>{d === today ? 'Today' : utc.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
              <span className="tabular text-base font-semibold">{day}</span>
            </button>
          )
        })}
      </div>
      {data && data.classTypes.length > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter by class">
          {[{ id: '', name: 'All classes', color: '' }, ...data.classTypes].map((t) => (
            <button key={t.id} type="button" aria-pressed={classTypeId === t.id} onClick={() => setClassTypeId(t.id)} className={cn('ui-focus flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium', classTypeId === t.id ? 'border-fg bg-fg text-canvas' : 'border-line bg-surface text-fg-muted')}>
              {t.color && <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />}{t.name}
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.sessions.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No classes this day" description="Try another day." /></Card>
      ) : (
        <div className="space-y-2">
          {data.sessions.map((s) => {
            const mine = s.myBooking?.status
            const full = s.spotsLeft === 0
            return (
              <Card key={s.id} className="p-3 sm:p-3">
                <ClassRow item={s} tz={tz}>
                  {mine === 'booked' || mine === 'attended' ? <Badge tone="green">{mine === 'attended' ? 'Attended' : 'Booked'}</Badge> : mine === 'waitlisted' ? <Badge tone="amber">On waitlist</Badge> : mine === 'offered' ? <Badge tone="blue">Spot offered</Badge> : (
                    <span className={cn('tabular shrink-0 text-xs', full ? 'font-semibold text-amber-700 dark:text-amber-400' : s.spotsLeft <= 3 ? 'font-medium text-fg' : 'text-fg-muted')}>{full ? 'Full' : `${s.spotsLeft} spot${s.spotsLeft === 1 ? '' : 's'} left`}</span>
                  )}
                </ClassRow>
                {problem?.id === s.id && <div className="mt-2"><FormError message={problem.message} /></div>}
                <div className="mt-2.5 border-t border-line pt-2.5">
                  {mine === 'booked' || mine === 'waitlisted' ? (
                    <Button size="sm" className="w-full" loading={busy === s.id} onClick={() => cancel(s)}>{mine === 'waitlisted' ? 'Leave waitlist' : 'Cancel booking'}</Button>
                  ) : mine ? null : !s.bookable ? (
                    <p className="text-center text-xs text-fg-subtle">{s.opensAt ? `Booking opens ${formatDate(s.opensAt, tz)}` : 'Booking has closed for this class'}</p>
                  ) : full ? (
                    <Button size="sm" className="w-full" loading={busy === s.id} disabled={!s.waitlistOpen} onClick={() => book(s, true)}>{s.waitlistOpen ? `Join waitlist${s.waitlisted ? ` (${s.waitlisted} ahead)` : ''}` : 'Class and waitlist are full'}</Button>
                  ) : (
                    <Button size="sm" variant="primary" className="w-full" loading={busy === s.id} onClick={() => book(s, false)}>Book</Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <ConfirmModal open={!!waitlist} onClose={() => setWaitlist(null)} onConfirm={() => { const s = waitlist!; setWaitlist(null); book(s, true) }} title="That class just filled up" confirmLabel="Join the waitlist">
        <p>Someone took the last spot in {waitlist?.name}. Would you like to join the waitlist? We'll email you if a spot opens.</p>
      </ConfirmModal>
    </>
  )
}

function MembershipTab({ data, tz, money }: { data: Portal; tz: string; money: (c: number) => string }) {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Membership</h1>
      {data.memberships.length === 0 ? <Card><EmptyState icon={<CreditCard className="h-5 w-5" />} title="No active membership" description="Ask at the front desk about memberships, class packs and drop-ins." /></Card> : data.memberships.map((m) => (
        <Card key={m.id}>
          <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-fg-heading">{m.name}</p>{m.priceCents > 0 && <p className="tabular text-sm text-fg-muted">{money(m.priceCents)} {m.interval}</p>}</div><StatusBadge status={m.status} /></div>
          {m.description && <p className="mt-2 text-sm text-fg-muted">{m.description}</p>}
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
            {m.creditsRemaining !== null && <Row label="Sessions left" value={String(m.creditsRemaining)} />}
            {m.classLimit && <Row label="Class limit" value={`${m.classLimit} per ${m.classLimitPeriod}`} />}
            {m.trialEndsAt && <Row label="Trial ends" value={formatDate(m.trialEndsAt, tz)} />}
            {m.frozenUntil && <Row label="Frozen until" value={formatDate(m.frozenUntil, tz)} />}
            {m.renewsAt && <Row label="Next payment" value={`${formatDate(m.renewsAt, tz)}${m.priceCents ? ` · ${money(m.priceCents)}` : ''}`} />}
            {!m.renewsAt && m.endsAt && <Row label="Ends" value={formatDate(m.endsAt, tz)} />}
            {m.type === 'recurring' && <Row label="Paid by" value={PAYMENT_METHOD_LABELS[m.paymentMethod] || titleCase(m.paymentMethod)} />}
            <Row label="Member since" value={formatDate(m.startedAt, tz)} />
          </dl>
        </Card>
      ))}
      <p className="text-xs text-fg-subtle">To change, freeze or cancel a membership, speak to the front desk.</p>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-heading">Billing</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="text-xs text-fg-muted">Balance due</p><p className={cn('tabular text-xl font-semibold', data.billing.overdueCents > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-heading')}>{money(data.billing.balanceCents)}</p></div>
          <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="text-xs text-fg-muted">Account credit</p><p className="tabular text-xl font-semibold text-fg-heading">{money(data.member.creditBalanceCents)}</p></div>
        </div>
        {data.billing.balanceCents > 0 && <p className="mt-2 text-xs text-fg-muted">Payments are taken at the front desk.</p>}
        <Card padded={false} className="mt-2">
          {data.billing.invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
            <ul className="divide-y divide-line/60">
              {data.billing.invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm text-fg">{i.description}</p><p className="text-xs text-fg-subtle">{i.number} · {formatDate(i.date, tz)}</p></div>
                  <div className="text-right"><p className="tabular text-sm font-medium text-fg-heading">{money(i.totalCents)}</p><StatusBadge status={i.status === 'open' && i.dueDate && new Date(i.dueDate) < new Date() ? 'overdue' : i.status} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-heading">Attendance history</h2>
        <Card padded={false}>
          {data.attendance.recent.length === 0 ? <EmptyState title="No visits yet" description="Your check-ins will show up here." /> : (
            <ul className="divide-y divide-line/60">
              {data.attendance.recent.map((c) => <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="text-fg">{c.label}</span><span className="tabular text-xs text-fg-muted">{formatDateShort(c.at, tz)} · {formatTime(c.at, tz)}</span></li>)}
            </ul>
          )}
        </Card>
      </section>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-fg-muted">{label}</dt><dd className="text-right font-medium text-fg">{value}</dd></div>
}

function ProfileTab({ data, base, onSaved }: { data: Portal; base: string; onSaved: () => void }) {
  const toast = useToast()
  const m = data.member
  const [f, setF] = useState({ email: m.email, phone: m.phone || '', addressLine1: m.addressLine1 || '', city: m.city || '', state: m.state || '', postalCode: m.postalCode || '', emergencyContactName: m.emergencyContactName || '', emergencyContactPhone: m.emergencyContactPhone || '', emailOptIn: m.emailOptIn, smsOptIn: m.smsOptIn })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await api(base, { method: 'PATCH', body: f })
      toast.success('Details saved')
      onSaved()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Profile</h1>
      <Card className="flex items-center gap-3"><Avatar name={m.name} src={m.photoUrl} size="lg" /><div><p className="font-semibold text-fg-heading">{m.name}</p><p className="text-sm text-fg-muted">Member since {formatDate(m.joinedAt, data.gym.timezone)}</p></div></Card>
      <form onSubmit={save} className="space-y-4">
        <Card className="space-y-4">
          <Field label="Email" required><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Mobile phone"><Input type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Street address"><Input autoComplete="street-address" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} /></Field>
          <div className="grid grid-cols-5 gap-3">
            <Field label="City" className="col-span-2"><Input autoComplete="address-level2" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="State"><Input autoComplete="address-level1" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></Field>
            <Field label="Postal code" className="col-span-2"><Input autoComplete="postal-code" value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} /></Field>
          </div>
        </Card>
        <Card className="space-y-4">
          <p className="text-sm font-semibold text-fg-heading">Emergency contact</p>
          <Field label="Name"><Input value={f.emergencyContactName} onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })} /></Field>
          <Field label="Phone"><Input type="tel" value={f.emergencyContactPhone} onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })} /></Field>
        </Card>
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-fg-heading">Stay in touch</p>
          <Checkbox checked={f.emailOptIn} onChange={(e) => setF({ ...f, emailOptIn: e.target.checked })} label="Email me news and offers" />
          <Checkbox checked={f.smsOptIn} onChange={(e) => setF({ ...f, smsOptIn: e.target.checked })} label="Text me reminders and updates" />
          <p className="text-xs text-fg-subtle">You'll always get emails about your bookings and payments.</p>
        </Card>
        <FormError message={problem} />
        <Button variant="primary" size="lg" type="submit" className="w-full" loading={busy}>Save changes</Button>
      </form>
      {data.gym.address && <p className="text-center text-xs text-fg-subtle">{data.gym.name} · {data.gym.address}</p>}
    </>
  )
}

export default function MemberPortalPage() {
  return (
    <ToastProvider>
      <PortalApp />
    </ToastProvider>
  )
}
