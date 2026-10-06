'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Check, X } from 'lucide-react'
import { api, qs, useApi } from '@/lib/client'
import { formatMoneyCompact, formatPercent, timeAgo, titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, DateRangePicker, EmptyState, ErrorState, Page, PageHeader, Skeleton, Stat, StatusBadge, rangeQuery, type RangeValue } from '@/components/ui'
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

export default function DashboardPage() {
  const { locationId, money, time, date, gym, can, user } = useSession()
  const [range, setRange] = useState<RangeValue>({ preset: '30d', from: '', to: '' })
  const { data, error, loading, refreshing, reload } = useApi<Dashboard>(`/api/dashboard${qs({ ...rangeQuery(range), locationId })}`)
  const [setupHidden, setSetupHidden] = useState(false)
  const period = range.preset === 'today' ? 'vs yesterday' : 'vs previous period'

  return (
    <Page>
      <PageHeader title="Dashboard" description={`${gym.name} · signed in as ${user.name}`} actions={<DateRangePicker value={range} onChange={setRange} />} />

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}</div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : error || !data ? (
        <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card>
      ) : (
        <div className={refreshing ? 'space-y-4 opacity-70 transition-opacity' : 'space-y-4 transition-opacity'}>
          {!data.setup.dismissed && !setupHidden && SETUP_STEPS.some((s) => !data.setup[s.key]) && can('settings.manage') && (
            <Card>
              <CardHeader
                title="Finish setting up"
                description={`${SETUP_STEPS.filter((s) => data.setup[s.key]).length} of ${SETUP_STEPS.length} done`}
                action={<Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setSetupHidden(true); fetch('/api/dashboard', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss-setup' }) }) }}>Dismiss</Button>}
              />
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {SETUP_STEPS.map((step) => (
                  <li key={step.key}>
                    <Link href={step.href} className="ui-focus flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-subtle">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${data.setup[step.key] ? 'bg-emerald-500 text-white' : 'border border-line'}`}>{data.setup[step.key] && <Check className="h-3 w-3" />}</span>
                      <span className={data.setup[step.key] ? 'text-fg-subtle line-through' : 'text-fg'}>{step.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.revenue && <Stat label="Revenue" value={formatMoneyCompact(data.revenue.netCents)} delta={data.revenue.change} hint={period} href="/reports/financial" />}
            {data.recurring && <Stat label="Monthly recurring revenue" value={formatMoneyCompact(data.recurring.mrrCents)} hint={`${data.recurring.subscriptions} renewing memberships`} href="/billing/memberships" />}
            <Stat label="Active members" value={data.members.active.toLocaleString()} hint={`${data.members.activeMemberships} memberships · ${data.members.trial} on trial`} href="/members?status=active" />
            <Stat label="New members" value={data.members.joined} delta={data.members.joinedChange} hint={period} href="/reports/members" />
            <Stat label="Cancelled memberships" value={data.members.cancelled} delta={data.members.cancelledChange} goodWhen="down" hint={data.members.churnPercent !== null ? `${formatPercent(data.members.churnPercent, 1)} churn` : period} href="/reports/members" />
            <Stat label="Check-ins" value={data.attendance.checkins.toLocaleString()} delta={data.attendance.change} hint={`${data.attendance.today} today`} href="/attendance" />
            <Stat label="Class utilization" value={formatPercent(data.attendance.utilizationPercent)} hint={`${data.attendance.sessions} classes run`} href="/reports/attendance" />
            {data.billing
              ? <Stat label="Outstanding payments" value={formatMoneyCompact(data.billing.outstandingCents)} hint={`${data.billing.openInvoices} open invoice${data.billing.openInvoices === 1 ? '' : 's'}`} href="/billing/invoices?status=open" />
              : <Stat label="Past-due members" value={data.members.pastDue} href="/members?status=past_due" />}
            {data.billing && <Stat label="Failed payments" value={data.billing.failedCount} hint={`${money(data.billing.failedCents)} · ${data.billing.pastDueMemberships} past due`} href="/billing/failed" />}
            {data.leads && <Stat label="New leads" value={data.leads.created} delta={data.leads.createdChange} hint={`${data.leads.open} open in pipeline`} href="/leads" />}
            {data.leads && <Stat label="Lead conversions" value={data.leads.converted} hint={data.leads.conversionPercent !== null ? `${formatPercent(data.leads.conversionPercent)} of new leads` : undefined} href="/reports/sales" />}
            <Stat label="Trial members" value={data.members.trial} hint={data.leads ? `${data.leads.trialsScheduled} lead trial${data.leads.trialsScheduled === 1 ? '' : 's'} booked` : undefined} href="/members?status=trial" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
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

          <div className="grid gap-4 lg:grid-cols-3">
            <Card padded={false}>
              <CardHeader title="Upcoming classes" className="px-4 pt-4 sm:px-5" action={<Link href="/schedule"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>Calendar</Button></Link>} />
              {data.upcomingClasses.length === 0 ? <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nothing in the next day and a half" /> : (
                <ul className="divide-y divide-line/60">
                  {data.upcomingClasses.map((c) => (
                    <li key={c.id}>
                      <Link href={`/schedule?session=${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/50 sm:px-5">
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: c.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg-heading">{c.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{date(c.startsAt)} · {time(c.startsAt)}{c.coach ? ` · ${c.coach}` : ''}</span>
                        </span>
                        <span className={`tabular text-xs ${c.booked >= c.capacity ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-fg-muted'}`}>{c.booked}/{c.capacity}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {data.recentTransactions && (
              <Card padded={false}>
                <CardHeader title="Recent transactions" className="px-4 pt-4 sm:px-5" action={<Link href="/billing"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>All</Button></Link>} />
                {data.recentTransactions.length === 0 ? <EmptyState title="No transactions yet" /> : (
                  <ul className="divide-y divide-line/60">
                    {data.recentTransactions.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg-heading">{t.member ? <Link href={`/members/${t.member.id}?tab=billing`} className="hover:underline">{t.member.name}</Link> : 'Walk-in sale'}</span>
                          <span className="block text-xs text-fg-muted">{titleCase(t.type)} · {titleCase(t.method)} · {timeAgo(t.createdAt)}</span>
                        </span>
                        {t.status !== 'succeeded' && <StatusBadge status={t.status} />}
                        <span className={`tabular text-sm font-medium ${t.type === 'refund' ? 'text-amber-700 dark:text-amber-400' : t.status === 'failed' ? 'text-fg-subtle line-through' : 'text-fg-heading'}`}>{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {data.staffActivity && (
              <Card padded={false}>
                <CardHeader title="Staff activity" className="px-4 pt-4 sm:px-5" action={<Link href="/audit-logs"><Button size="sm" variant="ghost" icon={<ArrowRight className="h-3.5 w-3.5" />}>Audit log</Button></Link>} />
                {data.staffActivity.length === 0 ? <EmptyState title="No activity yet" /> : (
                  <ul className="divide-y divide-line/60">
                    {data.staffActivity.map((a) => (
                      <li key={a.id} className="px-4 py-2.5 sm:px-5">
                        <p className="text-sm text-fg">{a.description}</p>
                        <p className="text-xs text-fg-subtle">{a.actorEmail?.split('@')[0] || 'Staff'} · {timeAgo(a.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}
