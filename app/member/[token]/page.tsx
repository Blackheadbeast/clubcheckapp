'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode'
import { AlertTriangle, Bell, CalendarCheck, CalendarDays, CalendarPlus, Check, CheckCircle2, ChevronRight, Clock, CreditCard, Dumbbell, Flame, Home, LogOut, MapPin, QrCode, Receipt, ScanLine, Trophy, UserRound, Users, X } from 'lucide-react'
import { PasswordInput, PasswordRules, passwordOk } from '@/components/member/AuthShell'
import { AppointmentCard, AppointmentsTab, type MemberAppointment } from '@/components/member/Appointments'
import { WorkoutsTab } from '@/components/member/Workouts'
import { DocumentsBanner, DocumentsLink, DocumentsTab } from '@/components/member/Documents'
import { api, ClientError, useApi } from '@/lib/client'
import { addDaysToDate } from '@/lib/dates'
import { formatDate, formatDateShort, formatMoney, formatTime, titleCase } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/hooks'
import { PaymentMethods, methodLabel, type SavedMethod } from '@/components/billing/PaymentMethods'
import { PlanChangeBreakdown, newKey, type PlanPreview } from '@/components/billing/AdvancedBilling'
import { Avatar, Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, Select, Skeleton, Spinner, StatusBadge, ToastProvider, cn, useToast } from '@/components/ui'

interface Note { id: string; category: string; type: string; title: string; body: string | null; screen: string | null; read: boolean; createdAt: string }
interface Upcoming { id: string; status: string; offerExpiresAt: string | null; waitlistPosition: number | null; sessionId: string; name: string; color: string; startsAt: string; endsAt: string; coach: string | null; location: string | null }
interface Portal {
  gym: { name: string; logoUrl: string | null; address: string | null; timezone: string; currency: string; cancelWindowHours: number; bookingWindowDays: number }
  member: { name: string; email: string; phone: string | null; photoUrl: string | null; status: string; qrCode: string; joinedAt: string; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; emailOptIn: boolean; smsOptIn: boolean; smsMarketingOptIn?: boolean; smsStopped?: boolean; waiverRequired: boolean; waiverUrl: string; creditBalanceCents: number }
  memberships: { id: string; name: string; description: string | null; status: string; type: string; priceCents: number; interval: string; creditsRemaining: number | null; classLimit: number | null; classLimitPeriod: string; renewsAt: string | null; endsAt: string | null; trialEndsAt: string | null; frozenUntil: string | null; paymentMethod: string; startedAt: string; contractEndsAt: string | null; cancelsAt: string | null; cancellationNoticeDays: number; scheduledPlan?: string | null; maxFreezeDays: number; autoRenew: boolean; can: { freeze: boolean; unfreeze: boolean; cancel: boolean; resume: boolean; change: boolean } }[]
  upcoming: Upcoming[]
  attendance: { totalVisits: number; visitsLast30Days: number; currentStreak: number; longestStreak: number; lastVisitAt: string | null; recent: { id: string; at: string; label: string }[]; milestones: { visits: number; reached: boolean }[]; nextMilestone: number | null }
  billing: { balanceCents: number; overdueCents: number; credits?: { id: string; label: string; originalCents: number; remainingCents: number; at: string; uses: { amountCents: number; invoiceNumber: string | null; at: string }[] }[]; invoices: { id: string; number: string; status: string; totalCents: number; balanceCents: number; date: string; dueDate: string | null; paidAt: string | null; processing: boolean; description: string }[]; canPayOnline: boolean; nextBillingAt: string | null; paymentMethods: SavedMethod[]; payments: { id: string; type: string; status: string; amountCents: number; method: string; last4: string | null; failureReason: string | null; at: string; invoiceNumber: string | null }[] }
  account: { signedIn: boolean; pendingEmail: string | null; emailVerified: boolean }
  checkin: { selfCheckin: boolean }
  inbox: { unread: number; latest: Note[] }
  recentActivity: { id: string; kind: 'visit' | 'payment' | 'payment_failed' | 'refund' | 'booking'; at: string; title: string; amountCents: number | null }[]
  appointments: MemberAppointment[]
  events: unknown[]
  notifications: { id: string; title: string; body: string; at: string }[]
}
interface ScheduleSession { durationMin: number; category: string; locationId: string | null; id: string; name: string; color: string; classTypeId: string; startsAt: string; endsAt: string; coach: string | null; location: string | null; capacity: number; spotsLeft: number; waitlisted: number; waitlistOpen: boolean; myBooking: { id: string; status: string } | null; bookable: boolean; opensAt: string | null }
interface Schedule { categories: string[]; locations: { id: string; name: string }[]; today: string; classTypes: { id: string; name: string; color: string }[]; sessions: ScheduleSession[] }

// "documents" is reached from Home and Profile rather than the bottom bar, which is full.
type Tab = 'home' | 'schedule' | 'workouts' | 'checkin' | 'membership' | 'profile' | 'documents'
const TABS: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: 'home', label: 'Home', icon: Home }, { key: 'schedule', label: 'Schedule', icon: CalendarDays }, { key: 'workouts', label: 'Workouts', icon: Dumbbell }, { key: 'checkin', label: 'Check in', icon: ScanLine }, { key: 'membership', label: 'Membership', icon: CreditCard }, { key: 'profile', label: 'Profile', icon: UserRound },
]

function PortalApp() {
  const { token } = useParams<{ token: string }>()
  const base = `/api/portal/${token}`
  const { data, error, loading, reload } = useApi<Portal>(base)
  const [tab, setTab] = useState<Tab>('home')
  const [inboxOpen, setInboxOpen] = useState(false)
  const [scheduleMode, setScheduleMode] = useState<'classes' | 'appointments'>('classes')
  const [openAppointment, setOpenAppointment] = useState<string | null>(null)
  const showAppointment = (id: string | null) => { setScheduleMode('appointments'); setOpenAppointment(id); setTab('schedule'); window.scrollTo(0, 0) }
  const go = (next: Tab) => { setTab(next); window.scrollTo(0, 0) }

  useEffect(() => {
    // Lets members add the portal to their home screen like an app.
    if (token !== 'me' && !document.querySelector('link[rel="manifest"]')) {
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
          <button type="button" onClick={() => setInboxOpen(true)} aria-label={data.inbox.unread ? `Notifications, ${data.inbox.unread} unread` : 'Notifications'} className="ui-focus relative flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:bg-subtle hover:text-fg">
            <Bell className="h-5 w-5" aria-hidden />
            {data.inbox.unread > 0 && <span className="tabular absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">{data.inbox.unread > 9 ? '9+' : data.inbox.unread}</span>}
          </button>
          <button type="button" onClick={() => go('profile')} aria-label="Profile" className="ui-focus rounded-full"><Avatar name={data.member.name} src={data.member.photoUrl} size="sm" /></button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {tab === 'home' && <DocumentsBanner base={base} onOpen={() => go('documents')} />}
        {tab === 'home' && <HomeTab data={data} base={base} tz={tz} money={money} onChange={reload} go={go} onAppointment={showAppointment} />}
        {tab === 'schedule' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Schedule</h1>
              <div className="flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Schedule type">
                {(['classes', 'appointments'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={scheduleMode === k} onClick={() => setScheduleMode(k)} className={cn('ui-focus h-9 rounded-lg px-3 text-sm font-medium capitalize transition', scheduleMode === k ? 'bg-accent text-accent-fg' : 'text-fg-muted')}>{k}</button>
                ))}
              </div>
            </div>
            {scheduleMode === 'classes' ? <ScheduleTab base={base} tz={tz} gym={data.gym} onChange={reload} /> : <AppointmentsTab base={base} tz={tz} openId={openAppointment} onOpened={() => setOpenAppointment(null)} onChange={reload} />}
          </>
        )}
        {tab === 'workouts' && <WorkoutsTab base={base} tz={tz} />}
        {tab === 'checkin' && <CheckinTab data={data} base={base} tz={tz} onChange={reload} go={go} />}
        {tab === 'membership' && <MembershipTab data={data} base={base} tz={tz} money={money} onChange={reload} />}
        {tab === 'profile' && <DocumentsLink base={base} onOpen={() => go('documents')} />}
        {tab === 'profile' && <ProfileTab data={data} base={base} onSaved={reload} />}
        {tab === 'documents' && <DocumentsTab base={base} onBack={() => go('profile')} />}
      </main>

      <nav aria-label="Member portal" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-2xl grid-cols-6">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" aria-current={tab === key || (tab === 'documents' && key === 'profile') ? 'page' : undefined} onClick={() => go(key)} className={cn('ui-focus flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[11px] font-medium', tab === key ? 'text-accent-text' : 'text-fg-muted')}>
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </nav>
      <NotificationCenter open={inboxOpen} onClose={() => { setInboxOpen(false); reload() }} base={base} tz={tz} onOpenScreen={(screen) => { setInboxOpen(false); if (screen === 'documents' || TABS.some((t) => t.key === screen)) go(screen as Tab) }} />
    </div>
  )
}

const NOTE_ICONS: Record<string, typeof Bell> = { appointment: UserRound, booking: CalendarCheck, waitlist: Clock, payment: Receipt, membership: CreditCard, account: UserRound, message: Bell }

/** Everything the gym or the system has told this member, newest first. Opening it marks it read. */
function NotificationCenter({ open, onClose, base, tz, onOpenScreen }: { open: boolean; onClose: () => void; base: string; tz: string; onOpenScreen: (screen: string) => void }) {
  const [items, setItems] = useState<Note[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'more'>('loading')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async (before?: string | null) => {
    setState(before ? 'more' : 'loading')
    try {
      const page = await api<{ items: Note[]; unread: number; nextBefore: string | null }>(`${base}/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`)
      setItems((prev) => (before ? [...prev, ...page.items] : page.items))
      setNext(page.nextBefore)
      setState('ready')
      // Seeing the list is reading it; the badge clears next time the home data loads.
      if (page.items.some((n) => !n.read)) api(`${base}/notifications/read`, { body: {} }).catch(() => {})
    } catch {
      setState('error')
    }
  }
  useEffect(() => { if (open) { setExpanded(null); load() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Notifications" className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <h2 className="flex-1 text-base font-semibold text-fg-heading">Notifications</h2>
          <button type="button" onClick={onClose} aria-label="Close notifications" className="ui-focus flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:bg-subtle hover:text-fg"><X className="h-5 w-5" aria-hidden /></button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-2xl px-4 py-4">
          {state === 'loading' ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            : state === 'error' ? <Card><ErrorState error="Could not load your notifications." onRetry={() => load()} /></Card>
            : items.length === 0 ? <Card><EmptyState icon={<Bell className="h-5 w-5" />} title="You're all caught up" description="Bookings, payments and messages from the gym will show up here." /></Card>
            : (
              <>
                <ul className="space-y-2">
                  {items.map((n) => {
                    const Icon = NOTE_ICONS[n.category] || Bell
                    const isOpen = expanded === n.id
                    const long = !!n.body && n.body.length > 90
                    return (
                      <li key={n.id}>
                        <button type="button" onClick={() => (long && !isOpen ? setExpanded(n.id) : n.screen ? onOpenScreen(n.screen) : setExpanded(isOpen ? null : n.id))} className={cn('ui-focus flex w-full items-start gap-3 rounded-xl border bg-surface p-3 text-left shadow-card', n.read ? 'border-line' : 'border-accent/50')}>
                          <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', n.type === 'payment_failed' || n.type === 'membership_past_due' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-subtle text-fg-muted')}><Icon className="h-4 w-4" aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-2"><span className={cn('flex-1 text-sm text-fg-heading', !n.read && 'font-semibold')}>{n.title}</span>{!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}</span>
                            {n.body && <span className={cn('mt-0.5 block whitespace-pre-wrap text-sm text-fg-muted', !isOpen && 'line-clamp-2')}>{n.body}</span>}
                            <span className="mt-1 block text-xs text-fg-subtle">{formatDateShort(n.createdAt, tz)} · {formatTime(n.createdAt, tz)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {next && <Button className="mt-3 w-full" loading={state === 'more'} onClick={() => load(next)}>Show older</Button>}
              </>
            )}
        </div>
      </div>
    </div>
  )
}

function QuickAction({ icon, label, onClick, badge }: { icon: React.ReactNode; label: string; onClick: () => void; badge?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="ui-focus relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-1 py-2 text-xs font-medium text-fg shadow-card active:bg-subtle">
      <span className="text-accent-text">{icon}</span>
      {label}
      {badge && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" aria-label="Needs attention" />}
    </button>
  )
}

/** The one thing most members open the app for: what am I doing next? */
function NextClass({ item, tz, onBook, onCheckin }: { item: Upcoming | null; tz: string; onBook: () => void; onCheckin: () => void }) {
  if (!item) {
    return (
      <button type="button" onClick={onBook} className="ui-focus flex w-full items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-4 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-text"><CalendarPlus className="h-5 w-5" aria-hidden /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">No class booked</span><span className="block text-sm text-fg-muted">Find your next one on the schedule.</span></span>
        <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
      </button>
    )
  }
  const start = new Date(item.startsAt)
  const minutes = Math.round((start.getTime() - Date.now()) / 60_000)
  const soon = minutes <= 60
  const day = start.toLocaleDateString('en-CA', { timeZone: tz })
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const when = day === today ? 'Today' : day === addDaysToDate(today, 1) ? 'Tomorrow' : start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="h-1.5" style={{ background: item.color }} aria-hidden />
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">{minutes <= 0 ? 'Happening now' : soon ? `Starts in ${minutes} min` : 'Next class'}</p>
        <p className="mt-1 text-lg font-semibold leading-tight text-fg-heading">{item.name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{when} · {formatTime(item.startsAt, tz)}</span>
          {item.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{item.location}</span>}
        </p>
        {item.coach && <p className="mt-0.5 text-sm text-fg-muted">with {item.coach}</p>}
        {soon && <Button variant="primary" size="lg" className="mt-3 w-full" onClick={onCheckin}><ScanLine className="h-4 w-4" />Check in</Button>}
      </div>
    </div>
  )
}

/** Membership and next payment at a glance; the full detail lives on the Membership tab. */
function MembershipSummary({ data, tz, money, onOpen }: { data: Portal; tz: string; money: (c: number) => string; onOpen: () => void }) {
  const m = data.memberships[0]
  const billing = data.billing
  const method = billing.paymentMethods.find((p) => p.isDefault) || billing.paymentMethods[0]
  const failed = billing.payments.find((p) => p.type === 'payment')?.status === 'failed'
  if (!m && billing.balanceCents === 0) return null
  return (
    <button type="button" onClick={onOpen} className="ui-focus block w-full rounded-xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-fg-subtle/40">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg-muted">Membership</p>
          <p className="mt-0.5 truncate text-base font-semibold text-fg-heading">{m ? m.name : 'No active membership'}</p>
          {m && (
            <p className="mt-0.5 text-sm text-fg-muted">
              {m.status === 'frozen' ? `Frozen${m.frozenUntil ? ` until ${formatDateShort(m.frozenUntil, tz)}` : ''}`
                : m.status === 'trial' && m.trialEndsAt ? `Trial ends ${formatDateShort(m.trialEndsAt, tz)}`
                : m.renewsAt ? `Renews ${formatDateShort(m.renewsAt, tz)} · ${money(m.priceCents)}`
                : m.endsAt ? `Ends ${formatDateShort(m.endsAt, tz)}`
                : m.creditsRemaining !== null ? `${m.creditsRemaining} session${m.creditsRemaining === 1 ? '' : 's'} left` : titleCase(m.status)}
            </p>
          )}
        </div>
        {m && <StatusBadge status={m.status} />}
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
      </div>
      {(billing.nextBillingAt || billing.balanceCents > 0 || failed) && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line/70 pt-3 text-sm">
          <div>
            <p className="text-xs text-fg-muted">{billing.balanceCents > 0 ? 'Balance due' : 'Next payment'}</p>
            <p className={cn('tabular font-medium', billing.overdueCents > 0 || failed ? 'text-red-600 dark:text-red-400' : 'text-fg-heading')}>
              {billing.balanceCents > 0 ? money(billing.balanceCents) : billing.nextBillingAt ? formatDateShort(billing.nextBillingAt, tz) : '—'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">Paying with</p>
            <p className="truncate font-medium text-fg-heading">{method ? methodLabel(method) : billing.canPayOnline ? 'Add a payment method' : 'At the front desk'}</p>
          </div>
        </div>
      )}
      {failed && billing.balanceCents > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Your last payment didn't go through. Tap to update your payment method.</p>}
    </button>
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

function HomeTab({ data, base, tz, money, onChange, go, onAppointment }: { data: Portal; base: string; tz: string; money: (c: number) => string; onChange: () => void; go: (tab: Tab) => void; onAppointment: (id: string | null) => void }) {
  const onBook = () => go('schedule')
  const onBilling = () => go('membership')
  const toast = useToast()
  const [cancelling, setCancelling] = useState<Upcoming | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const booked = data.upcoming.filter((b) => b.status !== 'offered')

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
        <Notice tone="danger">You have an overdue balance of {money(data.billing.overdueCents || data.billing.balanceCents)}. {data.billing.canPayOnline ? 'Pay it under Membership to keep booking classes.' : 'Please settle it at the front desk to keep booking classes.'}</Notice>
      ) : blocked ? (
        <Notice tone="warning">Your membership is {data.member.status === 'frozen' ? 'frozen' : 'not active'}, so check-in and booking are paused. Talk to the front desk to get going again.</Notice>
      ) : null}
      {data.member.waiverRequired && <Notice tone="warning">Please sign the liability waiver before your next visit. <a href={data.member.waiverUrl} className="font-semibold underline">Sign now</a></Notice>}

      {(() => {
        const nextClass = booked.find((b) => b.status === 'booked') || null
        const nextAppointment = data.appointments[0] || null
        if (nextAppointment && (!nextClass || new Date(nextAppointment.startsAt) < new Date(nextClass.startsAt))) {
          return (
            <button type="button" onClick={() => onAppointment(nextAppointment.id)} className="ui-focus block w-full overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-card">
              <div className="h-1.5" style={{ background: nextAppointment.type.color }} aria-hidden />
              <div className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">Next appointment</p>
                <p className="mt-1 text-lg font-semibold leading-tight text-fg-heading">{nextAppointment.type.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-fg-muted">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{formatDate(nextAppointment.startsAt, tz)} · {formatTime(nextAppointment.startsAt, tz)}</span>
                  {nextAppointment.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{nextAppointment.location}</span>}
                </p>
                <p className="mt-0.5 text-sm text-fg-muted">with {nextAppointment.coach.name}</p>
              </div>
            </button>
          )
        }
        return <NextClass item={nextClass} tz={tz} onBook={onBook} onCheckin={() => go('checkin')} />
      })()}

      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2">
        <QuickAction icon={<CalendarPlus className="h-5 w-5" />} label="Book" onClick={onBook} />
        <QuickAction icon={<ScanLine className="h-5 w-5" />} label="Check in" onClick={() => go('checkin')} />
        <QuickAction icon={<CreditCard className="h-5 w-5" />} label="Membership" onClick={onBilling} />
        <QuickAction icon={<Receipt className="h-5 w-5" />} label="Billing" onClick={() => { go('membership'); setTimeout(() => document.getElementById('billing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) }} badge={data.billing.balanceCents > 0} />
      </nav>

      <MembershipSummary data={data} tz={tz} money={money} onOpen={onBilling} />

      {data.appointments.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-fg-heading">Upcoming appointments</h2><button type="button" onClick={() => onAppointment(null)} className="ui-focus -mr-2 rounded px-2 py-1.5 text-sm font-medium text-accent-text">See all</button></div>
          <div className="space-y-2">{data.appointments.slice(0, 3).map((a) => <AppointmentCard key={a.id} a={a} tz={tz} onOpen={() => onAppointment(a.id)} />)}</div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-fg-heading">Upcoming classes</h2><button type="button" onClick={onBook} className="ui-focus -mr-2 rounded px-2 py-1.5 text-sm font-medium text-accent-text">Book a class</button></div>
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

      {data.recentActivity.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg-heading">Recent activity</h2>
          <Card padded={false}>
            <ul className="divide-y divide-line/60">
              {data.recentActivity.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', r.kind === 'payment_failed' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-subtle text-fg-muted')}>
                    {r.kind === 'visit' ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : r.kind === 'booking' ? <CalendarCheck className="h-4 w-4" aria-hidden /> : <Receipt className="h-4 w-4" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm text-fg">{r.title}</span><span className="block text-xs text-fg-subtle">{formatDateShort(r.at, tz)} · {formatTime(r.at, tz)}</span></span>
                  {r.amountCents !== null && <span className={cn('tabular shrink-0 text-sm font-medium', r.kind === 'payment_failed' ? 'text-red-600 dark:text-red-400' : 'text-fg-heading')}>{r.kind === 'refund' ? '−' : ''}{money(r.amountCents)}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <ConfirmModal open={!!cancelling} onClose={() => setCancelling(null)} onConfirm={() => cancelling && act(cancelling, 'cancel')} loading={!!busy} danger={!!cancelling && lateIf(cancelling)} title={cancelling?.status === 'waitlisted' ? 'Leave the waitlist?' : 'Cancel this booking?'} confirmLabel={cancelling?.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel booking'}>
        {cancelling && <p>{cancelling.name}, {formatDate(cancelling.startsAt, tz)} at {formatTime(cancelling.startsAt, tz)}.</p>}
        {cancelling && lateIf(cancelling) && <p className="font-medium text-red-600 dark:text-red-400">This class starts in less than {data.gym.cancelWindowHours} hours, so it counts as a late cancellation and any class credit is not returned.</p>}
      </ConfirmModal>
    </>
  )
}

interface CheckinState {
  selfCheckin: boolean
  qrCode: string
  lastCheckinAt: string | null
  currentClass: { bookingId: string; sessionId: string; name: string; color: string; startsAt: string; endsAt: string; coach: string | null; location: string | null } | null
  recent: { id: string; at: string; label: string }[]
}

function CheckinTab({ data, base, tz, onChange, go }: { data: Portal; base: string; tz: string; onChange: () => void; go: (tab: Tab) => void }) {
  const state = useApi<CheckinState>(`${base}/checkin`)
  const [qr, setQr] = useState('')
  const [big, setBig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<{ at: string; className: string | null; streak: number; duplicate: boolean } | null>(null)
  useEffect(() => { QRCode.toDataURL(data.member.qrCode, { width: 560, margin: 2 }).then(setQr).catch(() => {}) }, [data.member.qrCode])

  const checkIn = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ checkedInAt: string; duplicate: boolean; attended: { name: string } | null; streak: { current: number } }>(`${base}/checkin`, { method: 'POST' })
      setDone({ at: r.checkedInAt, className: r.attended?.name || null, streak: r.streak.current, duplicate: r.duplicate })
      state.reload()
      onChange()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  const c = state.data
  const recently = !done && c?.lastCheckinAt ? c.lastCheckinAt : null
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Check in</h1>

      {done ? (
        <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <p className="mt-2 text-lg font-semibold text-fg-heading">{done.duplicate ? "You're already checked in" : "You're checked in"}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{done.className ? `${done.className} · ` : ''}{formatTime(done.at, tz)}</p>
          {done.streak > 1 && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-sm font-medium text-fg-heading"><Flame className="h-4 w-4 text-orange-500" aria-hidden />{done.streak} day streak</p>}
        </div>
      ) : c?.currentClass ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="h-1.5" style={{ background: c.currentClass.color }} aria-hidden />
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">{new Date(c.currentClass.startsAt) <= new Date() ? 'Happening now' : 'Your next class'}</p>
            <p className="mt-1 text-lg font-semibold leading-tight text-fg-heading">{c.currentClass.name}</p>
            <p className="mt-1 text-sm text-fg-muted">{formatTime(c.currentClass.startsAt, tz)} – {formatTime(c.currentClass.endsAt, tz)}{c.currentClass.coach ? ` · ${c.currentClass.coach}` : ''}{c.currentClass.location ? ` · ${c.currentClass.location}` : ''}</p>
          </div>
        </div>
      ) : null}

      {state.loading ? <Skeleton className="h-14 rounded-xl" /> : state.error ? <Card><ErrorState error={state.error} onRetry={state.reload} /></Card> : c?.selfCheckin ? (
        !done && (
          <div>
            <Button variant="primary" size="lg" className="h-14 w-full text-base" loading={busy} onClick={checkIn}><ScanLine className="h-5 w-5" />{c.currentClass ? `Check in to ${c.currentClass.name}` : 'Check in'}</Button>
            {recently && <p className="mt-2 text-center text-xs text-fg-muted">You last checked in at {formatTime(recently, tz)}.</p>}
            {!c.currentClass && !recently && <p className="mt-2 text-center text-xs text-fg-muted">Not booked into a class right now, so this counts as an open gym visit.</p>}
          </div>
        )
      ) : (
        <Notice tone="warning">Check-in is done at the front desk here. Show the code below when you arrive.</Notice>
      )}
      <FormError message={problem} />

      <Card className="text-center">
        <button type="button" onClick={() => setBig(true)} className="ui-focus mx-auto block rounded-xl" aria-label="Show my check-in code full screen">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Your check-in QR code" className="mx-auto h-48 w-48 rounded-xl bg-white p-1" />
          ) : <Skeleton className="mx-auto h-48 w-48 rounded-xl" />}
        </button>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-sm font-medium text-fg-heading"><QrCode className="h-4 w-4" aria-hidden />Your check-in code</p>
        <p className="text-xs text-fg-muted">Scan it at the front desk or kiosk. Tap to enlarge.</p>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-heading">Recent check-ins</h2>
        <Card padded={false}>
          {state.loading ? <div className="space-y-2 p-4"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-2/3" /></div> : !c || c.recent.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No visits yet" description="Your check-ins will show up here." action={<Button onClick={() => go('schedule')}>See the schedule</Button>} />
          ) : (
            <ul className="divide-y divide-line/60">
              {c.recent.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="min-w-0 truncate text-fg">{r.label}</span><span className="tabular shrink-0 text-xs text-fg-muted">{formatDateShort(r.at, tz)} · {formatTime(r.at, tz)}</span></li>)}
            </ul>
          )}
        </Card>
      </section>

      <Modal open={big} onClose={() => setBig(false)} title="Check-in code" size="sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt="Your check-in QR code" className="mx-auto w-full max-w-xs rounded-xl bg-white p-2" />}
        <p className="mt-3 text-center text-sm font-medium text-fg-heading">{data.member.name}</p>
      </Modal>
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
  const [category, setCategory] = useState('')
  const [locationId, setLocationId] = useState('')
  const { data, error, loading, reload } = useApi<Schedule>(`${base}/schedule?date=${date}&days=1${classTypeId ? `&classTypeId=${classTypeId}` : ''}${category ? `&category=${category}` : ''}${locationId ? `&locationId=${locationId}` : ''}`)
  const tomorrow = useMemo(() => addDaysToDate(today, 1), [today])
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
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Day">
        {days.map((d) => {
          const [y, m, day] = d.split('-').map(Number)
          const utc = new Date(Date.UTC(y, m - 1, day))
          return (
            <button key={d} role="tab" type="button" aria-selected={date === d} onClick={() => setDate(d)} className={cn('ui-focus flex h-16 shrink-0 flex-col items-center justify-center rounded-xl border px-1 text-xs font-medium transition', d === today || d === tomorrow ? 'w-[4.75rem]' : 'w-14', date === d ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-fg-muted')}>
              <span>{d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : utc.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
              <span className="tabular text-base font-semibold">{day}</span>
            </button>
          )
        })}
      </div>
      {data && (data.locations.length > 1 || data.categories.length > 1) && (
        <div className="grid grid-cols-2 gap-2">
          {data.locations.length > 1 && (
            <label className={cn('block', data.categories.length <= 1 && 'col-span-2')}><span className="sr-only">Location</span>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="ui-input h-11"><option value="">All locations</option>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </label>
          )}
          {data.categories.length > 1 && (
            <label className={cn('block', data.locations.length <= 1 && 'col-span-2')}><span className="sr-only">Category</span>
              <select value={category} onChange={(e) => { setCategory(e.target.value); setClassTypeId('') }} className="ui-input h-11"><option value="">All categories</option>{data.categories.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select>
            </label>
          )}
        </div>
      )}
      {data && data.classTypes.length > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter by class">
          {[{ id: '', name: 'All classes', color: '' }, ...data.classTypes.filter((t) => !category || (t as { category?: string }).category === category)].map((t) => (
            <button key={t.id} type="button" aria-pressed={classTypeId === t.id} onClick={() => setClassTypeId(t.id)} className={cn('ui-focus flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium', classTypeId === t.id ? 'border-fg bg-fg text-canvas' : 'border-line bg-surface text-fg-muted')}>
              {t.color && <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />}{t.name}
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.sessions.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title={date === today ? 'No more classes today' : 'No classes this day'} description={classTypeId || category || locationId ? 'Nothing matches these filters. Try another day or clear them.' : date === today ? "Today's classes have finished or none are scheduled." : 'Try another day.'} action={classTypeId || category || locationId ? <Button onClick={() => { setClassTypeId(''); setCategory(''); setLocationId('') }}>Clear filters</Button> : date === today ? <Button variant="primary" onClick={() => setDate(tomorrow)}>See tomorrow</Button> : undefined} /></Card>
      ) : (
        <div className="space-y-2">
          {data.sessions.map((s) => {
            const mine = s.myBooking?.status
            const full = s.spotsLeft === 0
            return (
              <Card key={s.id} className="p-3 sm:p-3">
                <div className="flex gap-3">
                  <div className="w-[4.75rem] shrink-0 border-r border-line pr-3 text-right">
                    <p className="tabular whitespace-nowrap text-sm font-semibold text-fg-heading">{formatTime(s.startsAt, tz)}</p>
                    <p className="tabular text-xs text-fg-subtle">{s.durationMin} min</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-fg-heading"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden /><span className="truncate">{s.name}</span></p>
                    <p className="truncate text-xs text-fg-muted">{[s.coach, s.location].filter(Boolean).join(' · ') || 'Coach to be announced'}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {mine === 'booked' || mine === 'attended' ? <Badge tone="green">{mine === 'attended' ? 'Attended' : "You're booked"}</Badge> : mine === 'waitlisted' ? <Badge tone="amber">On the waitlist</Badge> : mine === 'offered' ? <Badge tone="blue">Spot offered to you</Badge> : null}
                      <span className={cn('tabular', full ? 'font-semibold text-amber-700 dark:text-amber-400' : s.spotsLeft <= 3 ? 'font-medium text-fg' : 'text-fg-muted')}>{full ? `Full${s.waitlisted ? ` · ${s.waitlisted} waiting` : ''}` : `${s.spotsLeft} of ${s.capacity} spots left`}</span>
                    </p>
                  </div>
                </div>
                {problem?.id === s.id && <div className="mt-2"><FormError message={problem.message} /></div>}
                <div className="mt-2.5 border-t border-line pt-2.5">
                  {mine === 'booked' || mine === 'waitlisted' ? (
                    <Button className="h-11 w-full" loading={busy === s.id} onClick={() => cancel(s)}>{mine === 'waitlisted' ? 'Leave waitlist' : 'Cancel booking'}</Button>
                  ) : mine ? null : !s.bookable ? (
                    <p className="text-center text-xs text-fg-subtle">{s.opensAt ? `Booking opens ${formatDate(s.opensAt, tz)}` : 'Booking has closed for this class'}</p>
                  ) : full ? (
                    <Button className="h-11 w-full" loading={busy === s.id} disabled={!s.waitlistOpen} onClick={() => book(s, true)}>{s.waitlistOpen ? `Join waitlist${s.waitlisted ? ` (${s.waitlisted} ahead)` : ''}` : 'Class and waitlist are full'}</Button>
                  ) : (
                    <Button variant="primary" className="h-11 w-full" loading={busy === s.id} onClick={() => book(s, false)}>Book</Button>
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

interface HouseholdInfo {
  name: string
  role: 'payer' | 'member'
  billedTo: string | null
  members: { name: string; amountDueCents: number; memberships: { plan: string; status: string; priceCents: number; interval: string; nextBillingDate: string | null }[]; invoices: { id: string; number: string; status: string; balanceCents: number; description: string | null }[] }[]
}

function MembershipTab({ data, base, tz, money, onChange }: { data: Portal; base: string; tz: string; money: (c: number) => string; onChange: () => void }) {
  const toast = useToast()
  const [paying, setPaying] = useState<string | null>(null)
  const [managing, setManaging] = useState<Managing | null>(null)
  const [allInvoices, setAllInvoices] = useState(false)
  const [allPayments, setAllPayments] = useState(false)
  const billing = data.billing
  const defaultMethod = billing.paymentMethods.find((m) => m.isDefault) || billing.paymentMethods[0]
  const household = useApi<{ household: HouseholdInfo | null }>(`${base}/household`)

  const payInvoice = async (id: string) => {
    setPaying(id)
    try {
      const result = await api<{ status: string; message: string | null }>(`${base}/invoices/${id}/pay`, { body: {} })
      if (result.status === 'failed') toast.error(result.message || 'The payment was declined. Try another card.')
      else toast.success(result.status === 'processing' ? 'Bank payment started. It will show as paid when it clears.' : 'Payment received. Thank you!')
      onChange()
      household.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setPaying(null)
    }
  }

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
            {m.contractEndsAt && <Row label="Contract until" value={formatDate(m.contractEndsAt, tz)} />}
            {m.cancelsAt && <Row label="Cancels on" value={formatDate(m.cancelsAt, tz)} />}
            {m.scheduledPlan && <Row label="Changing to" value={`${m.scheduledPlan}${m.renewsAt ? ` on ${formatDate(m.renewsAt, tz)}` : ''}`} />}
            {!m.cancelsAt && m.type === 'recurring' && m.cancellationNoticeDays > 0 && <Row label="Cancellation notice" value={`${m.cancellationNoticeDays} days`} />}
            <Row label="Member since" value={formatDate(m.startedAt, tz)} />
          </dl>
          {m.cancelsAt && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-400">This membership ends on {formatDate(m.cancelsAt, tz)}. You keep full access until then.</p>}
          {(m.can.freeze || m.can.unfreeze || m.can.cancel || m.can.resume || m.can.change) && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              {m.can.unfreeze && <Button variant="primary" className="h-11 flex-1" onClick={() => setManaging({ m, action: 'unfreeze' })}>Resume membership</Button>}
              {m.can.resume && <Button variant="primary" className="h-11 flex-1" onClick={() => setManaging({ m, action: 'resume' })}>Keep my membership</Button>}
              {m.can.change && <Button className="h-11 flex-1" onClick={() => setManaging({ m, action: 'change' })}>Change plan</Button>}
              {m.can.freeze && <Button className="h-11 flex-1" onClick={() => setManaging({ m, action: 'freeze' })}>Freeze</Button>}
              {m.can.cancel && <Button className="h-11 flex-1" onClick={() => setManaging({ m, action: 'cancel' })}>Cancel</Button>}
            </div>
          )}
        </Card>
      ))}
      <ManageMembership target={managing} base={base} tz={tz} money={money} onClose={() => setManaging(null)} onDone={onChange} />
      {data.memberships.length > 0 && !data.memberships.some((m) => m.can.freeze || m.can.unfreeze || m.can.cancel || m.can.resume || m.can.change) && <p className="text-xs text-fg-subtle">To change, freeze or cancel a membership, speak to the front desk.</p>}

      <section id="billing" className="scroll-mt-20">
        <h2 className="mb-2 text-sm font-semibold text-fg-heading">Billing</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="text-xs text-fg-muted">Amount due</p><p className={cn('tabular text-xl font-semibold', data.billing.overdueCents > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-heading')}>{money(data.billing.balanceCents)}</p></div>
          <div className="rounded-xl border border-line bg-surface p-3 shadow-card"><p className="text-xs text-fg-muted">Account credit</p><p className="tabular text-xl font-semibold text-fg-heading">{money(data.member.creditBalanceCents)}</p></div>
        </div>
        {household.data?.household?.role === 'member' && household.data.household.billedTo && <p className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted"><Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Your membership is billed to {household.data.household.billedTo}, who pays for your household. They can see and pay your invoices.</p>}
        {billing.nextBillingAt && <p className="mt-2 text-xs text-fg-muted">Next billing date: {formatDate(billing.nextBillingAt, tz)}{household.data?.household?.role === 'member' ? '' : defaultMethod ? `, charged to ${methodLabel(defaultMethod)}` : ''}.</p>}
        {billing.balanceCents > 0 && !billing.canPayOnline && <p className="mt-2 text-xs text-fg-muted">Payments are taken at the front desk.</p>}
        {billing.balanceCents > 0 && billing.canPayOnline && !defaultMethod && <p className="mt-2 text-xs text-fg-muted">Add a card or bank account below to pay online.</p>}
        <Card padded={false} className="mt-2">
          {data.billing.invoices.length === 0 ? <EmptyState title="No invoices yet" description="Your invoices and receipts will be listed here." /> : (
            <ul className="divide-y divide-line/60">
              {(allInvoices ? data.billing.invoices : data.billing.invoices.slice(0, 5)).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm text-fg">{i.description}</p><p className="text-xs text-fg-subtle">{i.number} · {formatDate(i.date, tz)}</p></div>
                  <div className="text-right"><p className="tabular text-sm font-medium text-fg-heading">{money(i.totalCents)}</p><StatusBadge status={i.processing ? 'pending' : i.status === 'open' && i.dueDate && new Date(i.dueDate) < new Date() ? 'overdue' : i.status} /></div>
                  {i.status === 'open' && !i.processing && i.balanceCents > 0 && billing.canPayOnline && defaultMethod && (
                    <Button size="sm" variant="primary" loading={paying === i.id} disabled={!!paying} onClick={() => payInvoice(i.id)}>Pay {money(i.balanceCents)}</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.billing.invoices.length > 5 && <button type="button" onClick={() => setAllInvoices((v) => !v)} className="ui-focus block w-full border-t border-line/60 px-4 py-3 text-center text-sm font-medium text-accent-text">{allInvoices ? 'Show fewer' : `Show all ${data.billing.invoices.length} invoices`}</button>}
        </Card>
      </section>

      {(billing.credits || []).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg-heading">Account credit</h2>
          <Card padded={false}>
            <ul className="divide-y divide-line/60">
              {(billing.credits || []).map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-3"><p className="min-w-0 flex-1 truncate text-sm text-fg">{c.label}</p><p className="tabular shrink-0 text-sm font-medium text-fg-heading">{money(c.remainingCents)} <span className="font-normal text-fg-subtle">left of {money(c.originalCents)}</span></p></div>
                  <p className="text-xs text-fg-subtle">{formatDate(c.at, tz)}{c.uses.map((u) => ` · ${money(u.amountCents)} used${u.invoiceNumber ? ` on ${u.invoiceNumber}` : ''}`).join('')}</p>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-xs text-fg-subtle">Credit comes off your next membership invoice automatically.</p>
        </section>
      )}

      {household.data?.household?.role === 'payer' && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg-heading">People you pay for</h2>
          <Card padded={false}>
            {household.data.household.members.length === 0 ? <EmptyState title="Nobody else yet" description="Family members billed with you will be listed here." /> : (
              <ul className="divide-y divide-line/60">
                {household.data.household.members.map((p) => (
                  <li key={p.name} className="px-4 py-3">
                    <div className="flex items-center gap-3"><p className="min-w-0 flex-1 truncate text-sm font-medium text-fg-heading">{p.name}</p><p className="shrink-0 text-xs text-fg-muted">Amount due <span className="tabular font-medium text-fg-heading">{money(p.amountDueCents)}</span></p></div>
                    <p className="text-xs text-fg-muted">{p.memberships.length === 0 ? 'No active membership' : p.memberships.map((x) => `${x.plan} · ${money(x.priceCents)} ${x.interval}${x.nextBillingDate ? ` · next ${formatDate(x.nextBillingDate, tz)}` : ''}`).join('  |  ')}</p>
                    {p.invoices.filter((i) => i.status === 'open' && i.balanceCents > 0).map((i) => (
                      <div key={i.id} className="mt-2 flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                        <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">{i.number} · {i.description}</p>
                        {billing.canPayOnline && defaultMethod ? <Button size="sm" variant="primary" loading={paying === i.id} disabled={!!paying} onClick={() => payInvoice(i.id)}>Pay {money(i.balanceCents)}</Button> : <span className="tabular text-xs font-medium text-fg-heading">{money(i.balanceCents)}</span>}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="mt-2 text-xs text-fg-subtle">Their memberships are charged to your saved payment method. You see their plans and invoices only.</p>
        </section>
      )}

      {(billing.canPayOnline || billing.paymentMethods.length > 0) && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg-heading">Payment methods</h2>
          <Card><PaymentMethods base={base} canManage onChange={onChange} /></Card>
        </section>
      )}

      {billing.payments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg-heading">Payment history</h2>
          <Card padded={false}>
            <ul className="divide-y divide-line/60">
              {(allPayments ? billing.payments : billing.payments.slice(0, 5)).map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{t.type === 'refund' ? 'Refund' : 'Payment'}{t.invoiceNumber ? ` · ${t.invoiceNumber}` : ''}</p>
                    <p className="truncate text-xs text-fg-subtle">{formatDate(t.at, tz)} · {PAYMENT_METHOD_LABELS[t.method] || titleCase(t.method)}{t.last4 ? ` ending ${t.last4}` : ''}{t.failureReason ? ` · ${t.failureReason}` : ''}</p>
                  </div>
                  <div className="text-right"><p className="tabular text-sm font-medium text-fg-heading">{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</p>{t.status !== 'succeeded' && <StatusBadge status={t.status} />}</div>
                </li>
              ))}
            </ul>
            {billing.payments.length > 5 && <button type="button" onClick={() => setAllPayments((v) => !v)} className="ui-focus block w-full border-t border-line/60 px-4 py-3 text-center text-sm font-medium text-accent-text">{allPayments ? 'Show fewer' : `Show all ${billing.payments.length} payments`}</button>}
          </Card>
        </section>
      )}
    </>
  )
}

type Membership = Portal['memberships'][number]
interface Managing { m: Membership; action: 'freeze' | 'unfreeze' | 'cancel' | 'resume' | 'change' }
interface PlanOption { id: string; name: string; description: string | null; priceCents: number; interval: string; classLimit: number | null; classLimitPeriod: string }

/** Freeze, resume, cancel or switch plan. The server applies the gym's rules; this only explains them. */
function ManageMembership({ target, base, tz, money, onClose, onDone }: { target: Managing | null; base: string; tz: string; money: (c: number) => string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [planId, setPlanId] = useState('')
  const plans = useApi<PlanOption[]>(target?.action === 'change' ? `${base}/plans` : null)
  useEffect(() => { setProblem(null); setUntil(''); setReason(''); setPlanId('') }, [target])
  const [effective, setEffective] = useState<'now' | 'next_period'>('now')
  // One key per confirmation on screen: a double tap or a retry is the same change.
  const key = useRef(newKey())
  const preview = useApi<PlanPreview>(target?.action === 'change' && planId ? `${base}/memberships/${target.m.id}/plan-change?planId=${planId}&effective=${effective}` : null)
  useEffect(() => { key.current = newKey(); setProblem(null) }, [planId, effective, target])
  useEffect(() => { setEffective('now') }, [target])
  if (!target) return null
  const { m, action } = target
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const latest = addDaysToDate(today, m.maxFreezeDays)

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    try {
      if (action === 'change') {
        const p = preview.data
        if (!p) return
        const done = await api<{ status: string; amountDueNowCents: number; creditCents: number; nextBillingDate: string; charge: { status: string; message: string | null } | null }>(`${base}/memberships/${m.id}/plan-change`, {
          body: { planId, effective, expected: { fromPlanId: p.from.id, amountDueNowCents: p.calc.amountDueNowCents, creditCents: p.calc.creditCents }, idempotencyKey: key.current },
        })
        if (done.charge?.status === 'failed') toast.error(`Your plan changed, but the payment was declined${done.charge.message ? `: ${done.charge.message}` : '.'} Please update your card.`)
        else toast.success(done.status === 'scheduled' ? `Your plan changes on ${formatDate(done.nextBillingDate, tz)}.` : done.creditCents > 0 ? `Plan changed. ${money(done.creditCents)} credit is on your account.` : done.amountDueNowCents > 0 ? `Plan changed. ${money(done.amountDueNowCents)} ${done.charge?.status === 'succeeded' ? 'was charged' : 'is due'}.` : 'Plan changed.')
        onDone()
        onClose()
        return
      }
      const body = action === 'freeze' ? { action, ...(until && { until }), ...(reason && { reason }) } : action === 'cancel' ? { action, ...(reason && { reason }) } : { action }
      const result = await api<{ cancelsAt: string | null; frozenUntil: string | null }>(`${base}/memberships/${m.id}`, { body })
      toast.success(
        action === 'freeze' ? `Frozen${result.frozenUntil ? ` until ${formatDate(result.frozenUntil, tz)}` : ''}`
        : action === 'unfreeze' ? 'Welcome back! Your membership is active again.'
        : action === 'cancel' ? `Cancelled. You have access until ${formatDate(result.cancelsAt, tz)}.`
        : action === 'resume' ? 'Your membership will continue as normal.'
        : 'Membership changed from your next billing date.'
      )
      onDone()
      onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
      // The figures moved since they were shown: show the new ones and ask again.
      if (['preview_changed', 'plan_already_changed'].includes((err as ClientError).code || '')) { key.current = newKey(); preview.reload() }
    } finally {
      setBusy(false)
    }
  }
  const title = { freeze: `Freeze ${m.name}`, unfreeze: `Resume ${m.name}`, cancel: `Cancel ${m.name}`, resume: `Keep ${m.name}`, change: 'Change membership' }[action]
  const confirm = { freeze: 'Freeze membership', unfreeze: 'Resume now', cancel: 'Cancel membership', resume: 'Keep my membership', change: !preview.data ? 'Choose a plan' : effective === 'next_period' ? 'Schedule change' : preview.data.calc.amountDueNowCents > 0 ? `Confirm and pay ${money(preview.data.calc.amountDueNowCents)}` : 'Confirm change' }[action]
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button onClick={onClose} disabled={busy}>Not now</Button><Button variant={action === 'cancel' ? 'danger' : 'primary'} loading={busy} disabled={action === 'change' && (!planId || !preview.data || !preview.data.allowed || preview.loading || preview.refreshing)} onClick={submit}>{confirm}</Button></>}>
      <div className="space-y-4 text-sm text-fg-muted">
        {action === 'freeze' && (
          <>
            <p>Billing and class bookings pause while your membership is frozen. Your billing date moves back by the time you were away.</p>
            <Field label="Freeze until" hint={`Up to ${m.maxFreezeDays} days. Leave blank to freeze for the longest allowed.`}><Input type="date" min={addDaysToDate(today, 1)} max={latest} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
            <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Travel, injury…" /></Field>
          </>
        )}
        {action === 'unfreeze' && <p>Your membership becomes active straight away and billing resumes.</p>}
        {action === 'cancel' && (
          <>
            <p>Your membership stays active until the end of the period you have paid for{m.cancellationNoticeDays > 0 ? ` (or ${m.cancellationNoticeDays} days from today, whichever is later)` : ''}. You will not be charged again after that, and you can change your mind any time before it ends.</p>
            <Field label="What made you decide to leave? (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
          </>
        )}
        {action === 'resume' && <p>Your cancellation is withdrawn and your membership renews as usual{m.renewsAt ? ` on ${formatDate(m.renewsAt, tz)}` : ''}.</p>}
        {action === 'change' && (
          plans.loading ? <div className="space-y-2"><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>
          : plans.error ? <ErrorState error={plans.error} onRetry={plans.reload} />
          : (plans.data || []).filter((p) => p.name !== m.name).length === 0 ? <p>There are no other memberships to switch to online. Ask the team about your options.</p>
          : (
            <>
              <p>Choose a plan to see exactly what you will pay, or be credited, before anything changes.</p>
              <div role="radiogroup" aria-label="Membership" className="space-y-2">
                {(plans.data || []).filter((p) => p.name !== m.name).map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} onClick={() => setPlanId(p.id)} className={cn('ui-focus flex w-full items-center gap-3 rounded-xl border p-3 text-left', planId === p.id ? 'border-accent bg-accent/10' : 'border-line bg-surface')}>
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', planId === p.id ? 'border-accent bg-accent text-accent-fg' : 'border-line')}>{planId === p.id && <Check className="h-3 w-3" aria-hidden />}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-fg-heading">{p.name}</span>{p.classLimit && <span className="block text-xs text-fg-muted">{p.classLimit} classes per {p.classLimitPeriod}</span>}</span>
                    <span className="tabular shrink-0 text-right text-fg-heading">{money(p.priceCents)}<span className="block text-xs text-fg-muted">{p.interval}</span></span>
                  </button>
                ))}
              </div>
              {planId && (
                <>
                  <Field label="When">
                    <Select value={effective} onChange={(e) => setEffective(e.target.value as 'now' | 'next_period')}>
                      <option value="now">Now</option>
                      <option value="next_period">On my next billing date{m.renewsAt ? ` (${formatDate(m.renewsAt, tz)})` : ''}</option>
                    </Select>
                  </Field>
                  {preview.loading ? <div className="space-y-2"><Skeleton className="h-10 rounded-lg" /><Skeleton className="h-32 rounded-lg" /></div>
                    : preview.error || !preview.data ? <ErrorState error={preview.error || 'Could not work out the change'} onRetry={preview.reload} />
                    : (
                      <>
                        <PlanChangeBreakdown preview={preview.data} money={money} date={(v) => formatDate(v, tz)} />
                        {preview.data.billedTo && <p className="text-xs text-fg-subtle">Your membership is billed to {preview.data.billedTo}. Any charge goes to their payment method and any credit to their account.</p>}
                        {preview.data.allowed ? <p className="text-xs text-fg-subtle">{preview.data.collection.description}</p> : <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-400" role="alert">{preview.data.blocked?.message}</p>}
                      </>
                    )}
                </>
              )}
            </>
          )
        )}
        <FormError message={problem} />
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-fg-muted">{label}</dt><dd className="text-right font-medium text-fg">{value}</dd></div>
}

function ProfileTab({ data, base, onSaved }: { data: Portal; base: string; onSaved: () => void }) {
  const toast = useToast()
  const m = data.member
  const [f, setF] = useState({ name: m.name, email: m.email, phone: m.phone || '', addressLine1: m.addressLine1 || '', city: m.city || '', state: m.state || '', postalCode: m.postalCode || '', emergencyContactName: m.emergencyContactName || '', emergencyContactPhone: m.emergencyContactPhone || '', emailOptIn: m.emailOptIn, smsOptIn: m.smsOptIn, smsMarketingOptIn: !!m.smsMarketingOptIn })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const saved = await api<{ emailPending: string | null }>(base, { method: 'PATCH', body: f })
      toast.success(saved.emailPending ? `Details saved. Confirm ${saved.emailPending} from the email we just sent.` : 'Details saved')
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
          <Field label="Full name" required><Input autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={120} /></Field>
          <Field label="Email" required hint={data.account.pendingEmail ? `Waiting for you to confirm ${data.account.pendingEmail}. Until then you sign in with your current address.` : data.account.signedIn ? "Changing this sends a confirmation link to the new address." : undefined}><Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
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
          <Checkbox checked={f.smsOptIn} disabled={!!m.smsStopped} onChange={(e) => setF({ ...f, smsOptIn: e.target.checked, smsMarketingOptIn: e.target.checked ? f.smsMarketingOptIn : false })} label="Text me reminders and updates about my bookings, appointments and payments" />
          <Checkbox checked={f.smsMarketingOptIn} disabled={!!m.smsStopped || !f.smsOptIn} onChange={(e) => setF({ ...f, smsMarketingOptIn: e.target.checked })} label="Text me news and offers too" />
          {m.smsStopped
            ? <p className="text-xs text-fg-subtle">You replied STOP to our texts, so we won't send any. To get them again, text START to the number they came from.</p>
            : <p className="text-xs text-fg-subtle">Texts are sent to your mobile number above. Message and data rates may apply. Reply STOP to any text to end them all.</p>}
          <p className="text-xs text-fg-subtle">You'll always get emails about your bookings and payments.</p>
        </Card>
        <FormError message={problem} />
        <Button variant="primary" size="lg" type="submit" className="w-full" loading={busy}>Save changes</Button>
      </form>
      <AccountSection data={data} />
      {data.gym.address && <p className="text-center text-xs text-fg-subtle">{data.gym.name} · {data.gym.address}</p>}
    </>
  )
}

/** Password, sign out, and for members still using an emailed link, how to get a real sign-in. */
function AccountSection({ data }: { data: Portal }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const signOut = async (everywhere: boolean) => {
    setBusy(everywhere ? 'everywhere' : 'out')
    try {
      await api('/api/member-auth/logout', { body: { everywhere } })
    } finally {
      window.location.href = '/member/login'
    }
  }
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('password')
    setProblem(null)
    try {
      await api('/api/member-auth/change-password', { body: { currentPassword: current, newPassword: next } })
      toast.success('Password changed. Other devices have been signed out.')
      setOpen(false)
      setCurrent('')
      setNext('')
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const sendSetup = async () => {
    setBusy('setup')
    try {
      await api('/api/member-auth/recover', { body: { email: data.member.email } })
      setSent(true)
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  if (!data.account.signedIn) {
    return (
      <Card className="space-y-2">
        <p className="text-sm font-semibold text-fg-heading">Sign in from any device</p>
        <p className="text-sm text-fg-muted">{sent ? `We've emailed a link to ${data.member.email}. Open it to choose a password.` : 'Create a password so you can get to your account without this link.'}</p>
        {!sent && <Button variant="primary" onClick={sendSetup} loading={busy === 'setup'}>Email me a setup link</Button>}
      </Card>
    )
  }
  return (
    <Card className="space-y-3">
      <p className="text-sm font-semibold text-fg-heading">Account</p>
      {open ? (
        <form onSubmit={changePassword} className="space-y-3">
          <input type="email" name="email" autoComplete="username" value={data.member.email} readOnly hidden />
          <Field label="Current password"><PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" autoFocus /></Field>
          <Field label="New password"><PasswordInput value={next} onChange={setNext} autoComplete="new-password" /></Field>
          <PasswordRules password={next} />
          <FormError message={problem} />
          <div className="flex gap-2"><Button variant="primary" type="submit" loading={busy === 'password'} disabled={!current || !passwordOk(next)}>Change password</Button><Button onClick={() => { setOpen(false); setProblem(null) }} disabled={busy === 'password'}>Cancel</Button></div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen(true)}>Change password</Button>
          <Button onClick={() => signOut(false)} loading={busy === 'out'}><LogOut className="h-4 w-4" />Sign out</Button>
          <Button onClick={() => signOut(true)} loading={busy === 'everywhere'}>Sign out of all devices</Button>
        </div>
      )}
    </Card>
  )
}

export default function MemberPortalPage() {
  return (
    <ToastProvider aboveBottomNav>
      <PortalApp />
    </ToastProvider>
  )
}
