'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronRight, CreditCard, FileSignature, ListChecks, ScanLine, Target, TrendingUp, UserPlus, Users, Wallet, X } from 'lucide-react'
import { qs, useApi } from '@/lib/client'
import { formatMoneyCompact, formatPercent, timeAgo, titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, CardHeader, DateRangePicker, EmptyState, ErrorState, Page, Skeleton, Stat, StatusBadge, cn, rangeQuery, type RangeValue } from '@/components/ui'
import { TrendChart } from '@/components/charts'

interface Dashboard {
  revenue: { netCents: number; grossCents: number; refundsCents: number; change: number | null } | null
  recurring: { mrrCents: number; arrCents: number; subscriptions: number } | null
  members: { active: number; trial: number; pastDue: number; frozen: number; total: number; activeMemberships: number; joined: number; joinedChange: number | null; cancelled: number; cancelledChange: number | null; churnPercent: number | null }
  attendance: { checkins: number; change: number | null; today: number; utilizationPercent: number | null; sessions: number }
  billing: { outstandingCents: number; openInvoices: number; failedCents: number; failedCount: number; pastDueMemberships: number } | null
  leads: { created: number; createdChange: number | null; open: number; converted: number; conversionPercent: number | null; trialsScheduled: number } | null
  upcomingClasses: { id: string; name: string; color: string; startsAt: string; coach: string | null; booked: number; capacity: number }[]
  recentTransactions: { id: string; type: string; status: string; amountCents: number; method: string; createdAt: string; member: { id: string; name: string } | null }[] | null
  staffActivity: { id: string; description: string; actorEmail: string | null; createdAt: string }[] | null
  trends: { monthly: boolean; revenue: { date: string; value: number }[] | null; attendance: { date: string; value: number }[] }
  setup: { gymName: boolean; firstMember: boolean; membershipPlan: boolean; firstClass: boolean; kioskPin: boolean; firstCheckin: boolean; dismissed: boolean }
}

const SETUP_STEPS: { key: keyof Dashboard['setup']; label: string; href: string }[] = [
  { key: 'gymName', label: 'Name your gym', href: '/settings' },
  { key: 'membershipPlan', label: 'Create a membership plan', href: '/memberships' },
  { key: 'firstMember', label: 'Add your first member', href: '/members' },
  { key: 'firstClass', label: 'Set up a class', href: '/schedule/classes' },
  { key: 'kioskPin', label: 'Set a kiosk PIN', href: '/kiosk' },
  { key: 'firstCheckin', label: 'Check someone in', href: '/checkin' },
]

interface TodayData {
  classes: { id: string; name: string; color: string; startsAt: string; endsAt: string; coach: { id: string; name: string } | null; location: string | null; room: string | null; capacity: number; booked: number; checkedIn: number; waitlisted: number; spotsLeft: number }[]
  appointments: { id: string; status: string; startsAt: string; endsAt: string; type: { name: string; color: string | null }; staff: { id: string; name: string }; member: { id: string; name: string }; location: string | null }[]
  summary: { checkins: number; classes: number; classesRemaining: number; appointments: number; appointmentsRemaining: number; booked: number; toRecord: number; inNow: number }
  timezone: string
}

/** The part of the day, by the gym's own clock. */
function greeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

interface Attention { key: string; icon: typeof Users; tone: 'red' | 'amber' | 'blue' | 'violet'; title: string; detail: string; href: string; action: string }
const ATTENTION_TONES = { red: 'bg-red-500/10 text-red-600 dark:text-red-400', amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' }

export default function DashboardPage() {
  const { locationId, money, time, gym, can, user } = useSession()
  const [range, setRange] = useState<RangeValue>({ preset: '30d', from: '', to: '' })
  const { data, error, loading, refreshing, reload } = useApi<Dashboard>(`/api/dashboard${qs({ ...rangeQuery(range), locationId })}`)
  // The day itself comes from the same place the Today screen reads it; nothing is worked out twice.
  const today = useApi<TodayData>(`/api/today${qs({ locationId })}`)
  const documents = useApi<unknown[]>(can('documents.view') ? '/api/documents?pageSize=1' : null)
  const [setupHidden, setSetupHidden] = useState(false)
  const period = range.preset === 'today' ? 'vs yesterday' : 'vs previous period'
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
  const now = Date.now()

  const schedule = today.data
    ? [
        ...today.data.classes.map((c) => ({ kind: 'class' as const, id: c.id, startsAt: c.startsAt, endsAt: c.endsAt, c })),
        ...today.data.appointments.map((a) => ({ kind: 'appointment' as const, id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, a })),
      ].sort((x, y) => x.startsAt.localeCompare(y.startsAt))
    : []
  const waitlisted = today.data ? today.data.classes.reduce((sum, c) => sum + c.waitlisted, 0) : 0
  const docCounts = (documents.meta as { counts?: Record<string, number> } | null)?.counts || {}
  const unsigned = (docCounts.sent || 0) + (docCounts.viewed || 0) + (docCounts.partially_completed || 0)

  // Only things that are true right now, each with the one place to deal with it.
  const attention: Attention[] = []
  if (data?.billing && data.billing.failedCount > 0) attention.push({ key: 'failed', icon: CreditCard, tone: 'red', title: `${plural(data.billing.failedCount, 'failed payment')}`, detail: `${money(data.billing.failedCents)} to recover`, href: '/billing/failed', action: 'Review' })
  const pastDue = data ? data.billing?.pastDueMemberships ?? data.members.pastDue : 0
  if (pastDue > 0) attention.push({ key: 'pastdue', icon: AlertTriangle, tone: 'red', title: `${plural(pastDue, 'membership')} past due`, detail: 'Payment has not gone through', href: '/members?status=past_due', action: 'View' })
  if (data?.billing && data.billing.openInvoices > 0) attention.push({ key: 'open', icon: Wallet, tone: 'amber', title: `${plural(data.billing.openInvoices, 'unpaid invoice')}`, detail: `${money(data.billing.outstandingCents)} outstanding`, href: '/billing/invoices?status=open', action: 'Collect' })
  if (today.data && today.data.summary.toRecord > 0) attention.push({ key: 'record', icon: ListChecks, tone: 'amber', title: `${plural(today.data.summary.toRecord, 'appointment')} to mark`, detail: 'Finished today, attendance not recorded', href: '/appointments', action: 'Record' })
  if (waitlisted > 0) attention.push({ key: 'waitlist', icon: Users, tone: 'amber', title: `${plural(waitlisted, 'person', 'people')} on a waitlist today`, detail: 'A spot may be about to open', href: '/schedule/bookings?status=waitlisted', action: 'View' })
  if (unsigned > 0) attention.push({ key: 'documents', icon: FileSignature, tone: 'blue', title: `${plural(unsigned, 'document')} waiting for a signature`, detail: 'Sent to members, not yet signed', href: '/documents', action: 'Follow up' })
  if (data?.leads && data.leads.open > 0) attention.push({ key: 'leads', icon: Target, tone: 'violet', title: `${plural(data.leads.open, 'open lead')}`, detail: data.leads.trialsScheduled ? `${plural(data.leads.trialsScheduled, 'trial')} booked` : 'In the pipeline, not yet members', href: '/leads', action: 'Follow up' })
  if (data && data.members.trial > 0) attention.push({ key: 'trials', icon: UserPlus, tone: 'blue', title: `${plural(data.members.trial, 'member')} on a trial`, detail: 'The moment to turn them into members', href: '/members?status=trial', action: 'View' })

  const firstName = (user.name || '').split(/[\s@.]/)[0]
  const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: gym.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="ui-eyebrow">{dayLabel}</p>
          <h1 className="ui-page-title mt-1 truncate">{greeting(gym.timezone)}{firstName ? `, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}` : ''}</h1>
          <p className="mt-1.5 text-[0.9375rem] leading-6 text-fg-muted">
            Here is how {gym.name} is doing{today.data ? `: ${plural(today.data.summary.checkins, 'check-in')} so far today, ${plural(today.data.summary.classesRemaining, 'class', 'classes')} and ${plural(today.data.summary.appointmentsRemaining, 'appointment')} still to come.` : '.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          {can('members.manage') && <Link href="/members?new=1"><Button icon={<UserPlus className="h-4 w-4" />}>Add member</Button></Link>}
        </div>
      </div>

      {loading ? (
        <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[124px] rounded-2xl" />)}</div>
          <div className="grid gap-5 lg:grid-cols-5"><Skeleton className="h-80 rounded-2xl lg:col-span-3" /><Skeleton className="h-80 rounded-2xl lg:col-span-2" /></div>
        </div>
      ) : error || !data ? (
        <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card>
      ) : (
        <div className={cn('space-y-5 transition-opacity', refreshing && 'opacity-70')}>
          {!data.setup.dismissed && !setupHidden && SETUP_STEPS.some((s) => !data.setup[s.key]) && can('settings.manage') && (
            <Card>
              <CardHeader
                title="Finish setting up"
                description={`${SETUP_STEPS.filter((s) => data.setup[s.key]).length} of ${SETUP_STEPS.length} done`}
                action={<Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setSetupHidden(true); fetch('/api/dashboard', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss-setup' }) }).catch(() => {}) }}>Dismiss</Button>}
              />
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {SETUP_STEPS.map((step) => (
                  <li key={step.key}>
                    <Link href={step.href} className="ui-focus flex min-h-11 items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-sm transition hover:bg-subtle">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${data.setup[step.key] ? 'bg-emerald-500 text-white' : 'border border-line'}`}>{data.setup[step.key] && <Check className="h-3 w-3" />}</span>
                      <span className={data.setup[step.key] ? 'text-fg-subtle line-through' : 'font-medium text-fg'}>{step.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* The six numbers an owner looks for first. */}
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Active members" value={data.members.active.toLocaleString()} delta={data.members.joinedChange} hint={`${data.members.joined} new`} href="/members?status=active" icon={<Users className="h-4 w-4" />} tone="blue" />
            <Stat label="Check-ins today" value={(today.data?.summary.checkins ?? data.attendance.today).toLocaleString()} hint={today.data && today.data.summary.inNow > 0 ? `${today.data.summary.inNow} in class now` : `${data.attendance.checkins.toLocaleString()} this period`} href="/attendance" icon={<ScanLine className="h-4 w-4" />} tone="green" />
            {data.revenue
              ? <Stat label="Revenue" value={formatMoneyCompact(data.revenue.netCents)} delta={data.revenue.change} hint={period} href="/reports/financial" icon={<TrendingUp className="h-4 w-4" />} tone="amber" />
              : <Stat label="Classes today" value={today.data?.summary.classes ?? 0} hint={today.data ? `${today.data.summary.classesRemaining} still to come` : undefined} href="/schedule" icon={<CalendarDays className="h-4 w-4" />} tone="amber" />}
            {data.billing
              ? <Stat label="Failed payments" value={data.billing.failedCount} hint={data.billing.failedCount ? `${money(data.billing.failedCents)} to recover` : 'Nothing to chase'} href="/billing/failed" icon={<CreditCard className="h-4 w-4" />} tone={data.billing.failedCount ? 'red' : 'neutral'} alert={data.billing.failedCount > 0} />
              : <Stat label="Past-due members" value={data.members.pastDue} href="/members?status=past_due" icon={<AlertTriangle className="h-4 w-4" />} tone={data.members.pastDue ? 'red' : 'neutral'} alert={data.members.pastDue > 0} />}
            {data.leads
              ? <Stat label="New leads" value={data.leads.created} delta={data.leads.createdChange} hint={`${data.leads.open} open`} href="/leads" icon={<Target className="h-4 w-4" />} tone="violet" />
              : <Stat label="On trial" value={data.members.trial} href="/members?status=trial" icon={<UserPlus className="h-4 w-4" />} tone="violet" />}
            <Stat label="Appointments today" value={today.data?.summary.appointments ?? 0} hint={today.data ? `${today.data.summary.appointmentsRemaining} still to come` : undefined} href="/appointments" icon={<CalendarClock className="h-4 w-4" />} tone="neutral" />
          </section>

          <div className="grid gap-5 lg:grid-cols-5">
            {/* What the day looks like. */}
            <Card padded={false} className="lg:col-span-3">
              <CardHeader title="Today's schedule" description={today.data ? `${plural(today.data.summary.classes, 'class', 'classes')} · ${plural(today.data.summary.appointments, 'appointment')} · ${plural(today.data.summary.booked, 'booking')} still to arrive` : undefined} className="px-4 pt-4 sm:px-6 sm:pt-5" action={<Link href="/schedule"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>Calendar</Button></Link>} />
              {today.loading && !today.data ? (
                <div className="space-y-3 px-4 pb-5 sm:px-6" aria-busy="true" aria-label="Loading today's schedule">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
              ) : today.error ? (
                <ErrorState error={today.error} onRetry={today.reload} />
              ) : schedule.length === 0 ? (
                data.upcomingClasses.length === 0 ? (
                  <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nothing on the schedule today" description="Classes and appointments appear here as they are scheduled. Set up your weekly classes to fill the calendar." action={can('classes.manage') ? <Link href="/schedule/classes"><Button variant="primary">Set up classes</Button></Link> : undefined} />
                ) : (
                  <>
                    <p className="px-4 pb-2 text-sm text-fg-muted sm:px-6">Nothing today. Coming up next:</p>
                    <ul className="divide-y divide-line/70 border-t border-line/70">
                      {data.upcomingClasses.slice(0, 5).map((c) => (
                        <li key={c.id}>
                          <Link href={`/schedule?session=${c.id}`} className="ui-focus flex items-center gap-3 px-4 py-3 transition hover:bg-subtle/60 sm:px-6">
                            <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: c.color }} />
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-fg-heading">{c.name}</span><span className="block truncate text-xs text-fg-muted">{new Intl.DateTimeFormat('en-US', { timeZone: gym.timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(c.startsAt))} · {time(c.startsAt)}{c.coach ? ` · ${c.coach}` : ''}</span></span>
                            <span className="tabular text-sm text-fg-muted">{c.booked}/{c.capacity}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              ) : (
                <ul className="divide-y divide-line/70 border-t border-line/70" aria-label="Today's classes and appointments">
                  {schedule.map((item) => {
                    const start = new Date(item.startsAt).getTime()
                    const end = new Date(item.endsAt).getTime()
                    const live = start <= now && end > now
                    const over = end <= now
                    if (item.kind === 'class') {
                      const c = item.c
                      const fill = c.capacity > 0 ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0
                      return (
                        <li key={`c-${c.id}`}>
                          <Link href={`/schedule?session=${c.id}`} className={cn('ui-focus flex items-center gap-3 px-4 py-3 transition hover:bg-subtle/60 sm:gap-4 sm:px-6', over && 'opacity-60')}>
                            <span className="w-16 shrink-0 text-right sm:w-[4.5rem]"><span className="tabular block whitespace-nowrap text-sm font-semibold text-fg-heading">{time(c.startsAt)}</span>{live && <span className="mt-0.5 inline-flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />Now</span>}</span>
                            <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-fg-heading">{c.name}</span>
                              <span className="block truncate text-xs text-fg-muted">Class{c.coach ? ` · ${c.coach.name}` : ' · no coach assigned'}{c.room ? ` · ${c.room}` : c.location ? ` · ${c.location}` : ''}</span>
                            </span>
                            {c.waitlisted > 0 && <Badge tone="amber" className="hidden sm:inline-flex">{c.waitlisted} waiting</Badge>}
                            <span className="w-14 shrink-0 sm:w-32">
                              <span className="flex items-baseline justify-between text-xs"><span className="tabular font-semibold text-fg-heading">{c.booked}/{c.capacity}</span><span className="hidden text-fg-muted sm:inline">{over || live ? `${c.checkedIn} in` : c.spotsLeft === 0 ? 'Full' : `${c.spotsLeft} left`}</span></span>
                              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${c.booked} of ${c.capacity} booked`}><span className={cn('block h-full rounded-full', fill >= 100 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${fill}%` }} /></span>
                            </span>
                          </Link>
                        </li>
                      )
                    }
                    const a = item.a
                    return (
                      <li key={`a-${a.id}`}>
                        <Link href={`/appointments?open=${a.id}`} className={cn('ui-focus flex items-center gap-3 px-4 py-3 transition hover:bg-subtle/60 sm:gap-4 sm:px-6', over && a.status !== 'booked' && 'opacity-60')}>
                          <span className="w-16 shrink-0 text-right sm:w-[4.5rem]"><span className="tabular block whitespace-nowrap text-sm font-semibold text-fg-heading">{time(a.startsAt)}</span>{live && <span className="mt-0.5 inline-flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />Now</span>}</span>
                          <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: a.type.color || 'rgb(var(--color-text-muted))' }} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-fg-heading">{a.member.name}</span>
                            <span className="block truncate text-xs text-fg-muted">{a.type.name} · with {a.staff.name}{a.location ? ` · ${a.location}` : ''}</span>
                          </span>
                          {a.status === 'booked' && over ? <Badge tone="amber">To mark</Badge> : a.status !== 'booked' ? <StatusBadge status={a.status} /> : <Badge tone="blue">Appointment</Badge>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            {/* What needs doing, and nothing that does not. */}
            <Card padded={false} className="lg:col-span-2">
              <CardHeader title="Needs attention" description={attention.length ? `${plural(attention.length, 'thing')} to look at` : undefined} className="px-4 pt-4 sm:px-6 sm:pt-5" />
              {attention.length === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="You are all caught up" description="No failed payments, no unpaid invoices, nothing waiting on you. This list fills in when something needs a decision." />
              ) : (
                <ul className="divide-y divide-line/70 border-t border-line/70" aria-label="Needs attention">
                  {attention.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.key}>
                        <Link href={item.href} className="ui-focus group flex items-center gap-3 px-4 py-3 transition hover:bg-subtle/60 sm:px-6">
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', ATTENTION_TONES[item.tone])} aria-hidden><Icon className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-fg-heading">{item.title}</span><span className="block truncate text-xs text-fg-muted">{item.detail}</span></span>
                          <span className="hidden shrink-0 text-sm font-medium text-accent-text sm:inline">{item.action}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>

          {/* How the business is moving over the chosen period. */}
          <section aria-labelledby="overview-title" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
              <div><h2 id="overview-title" className="ui-section-title">Business overview</h2><p className="mt-0.5 text-sm text-fg-muted">Over the period selected above.</p></div>
              {can('reports.view') && <Link href="/reports/financial"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>All reports</Button></Link>}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {data.recurring && <Stat label="Monthly recurring revenue" value={formatMoneyCompact(data.recurring.mrrCents)} hint={`${data.recurring.subscriptions} renewing memberships`} href="/billing/memberships" />}
              <Stat label="New members" value={data.members.joined} delta={data.members.joinedChange} hint={period} href="/reports/members" />
              <Stat label="Cancelled memberships" value={data.members.cancelled} delta={data.members.cancelledChange} goodWhen="down" hint={data.members.churnPercent !== null ? `${formatPercent(data.members.churnPercent, 1)} churn` : period} href="/reports/members" />
              <Stat label="Class utilization" value={formatPercent(data.attendance.utilizationPercent)} hint={`${data.attendance.sessions} classes run`} href="/reports/attendance" />
              {data.billing && <Stat label="Outstanding payments" value={formatMoneyCompact(data.billing.outstandingCents)} hint={`${data.billing.openInvoices} open invoice${data.billing.openInvoices === 1 ? '' : 's'}`} href="/billing/invoices?status=open" />}
              {data.leads && <Stat label="Lead conversions" value={data.leads.converted} hint={data.leads.conversionPercent !== null ? `${formatPercent(data.leads.conversionPercent)} of new leads` : undefined} href="/reports/sales" />}
              <Stat label="Check-ins" value={data.attendance.checkins.toLocaleString()} delta={data.attendance.change} hint={period} href="/attendance" />
              <Stat label="Trial members" value={data.members.trial} hint={data.leads ? `${data.leads.trialsScheduled} lead trial${data.leads.trialsScheduled === 1 ? '' : 's'} booked` : undefined} href="/members?status=trial" />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              {data.trends.revenue && (
                <Card>
                  <CardHeader title="Revenue" description={`Net of refunds, per ${data.trends.monthly ? 'month' : 'day'}`} />
                  <TrendChart data={data.trends.revenue} format="money" name="Revenue" />
                </Card>
              )}
              <Card className={data.trends.revenue ? '' : 'lg:col-span-2'}>
                <CardHeader title="Attendance" description={`Check-ins per ${data.trends.monthly ? 'month' : 'day'}`} />
                <TrendChart data={data.trends.attendance} format="number" name="Check-ins" />
              </Card>
            </div>
          </section>

          {(data.recentTransactions || data.staffActivity) && (
            <div className="grid gap-5 lg:grid-cols-2">
              {data.recentTransactions && (
                <Card padded={false}>
                  <CardHeader title="Recent payments" description="The latest money in and out." className="px-4 pt-4 sm:px-6 sm:pt-5" action={<Link href="/billing"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>All</Button></Link>} />
                  {data.recentTransactions.length === 0 ? <EmptyState icon={<CreditCard className="h-5 w-5" />} title="No payments yet" description="Payments, refunds and credits show here as they are recorded." /> : (
                    <ul className="divide-y divide-line/70 border-t border-line/70">
                      {data.recentTransactions.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-fg-heading">{t.member ? <Link href={`/members/${t.member.id}?tab=billing`} className="hover:underline">{t.member.name}</Link> : 'Walk-in sale'}</span>
                            <span className="block text-xs text-fg-muted">{titleCase(t.type)} · {titleCase(t.method)} · {timeAgo(t.createdAt)}</span>
                          </span>
                          {t.status !== 'succeeded' && <StatusBadge status={t.status} />}
                          <span className={`tabular text-sm font-semibold ${t.type === 'refund' ? 'text-amber-700 dark:text-amber-400' : t.status === 'failed' ? 'text-fg-subtle line-through' : 'text-fg-heading'}`}>{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
              {data.staffActivity && (
                <Card padded={false}>
                  <CardHeader title="Staff activity" description="What your team has been doing." className="px-4 pt-4 sm:px-6 sm:pt-5" action={<Link href="/audit-logs"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>Audit log</Button></Link>} />
                  {data.staffActivity.length === 0 ? <EmptyState title="No activity yet" description="Changes your staff make are listed here, newest first." /> : (
                    <ul className="divide-y divide-line/70 border-t border-line/70">
                      {data.staffActivity.map((a) => (
                        <li key={a.id} className="px-4 py-3 sm:px-6">
                          <p className="text-sm text-fg">{a.description}</p>
                          <p className="mt-0.5 text-xs text-fg-muted">{a.actorEmail?.split('@')[0] || 'Staff'} · {timeAgo(a.createdAt)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </Page>
  )
}
