'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Download } from 'lucide-react'
import { qs, useApi } from '@/lib/client'
import { LEAD_STAGES, formatPercent, titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, DateRangePicker, ErrorState, Page, PageHeader, Skeleton, Stat, Table, Tabs, Td, Th, rangeQuery, type RangeValue } from '@/components/ui'
import { BarList, ColumnChart, TrendChart } from '@/components/charts'

type Row = { label: string; value: number; count?: number }
type ClassRow = { label: string; sessions: number; capacity: number; attended: number; booked: number; noShows: number; lateCancels: number; utilizationPercent: number | null; noShowPercent: number | null }
type SourceRow = { label: string; leads: number; converted: number; conversionPercent: number | null }

const TABS = [
  { key: 'financial', label: 'Financial', needs: 'reports.financial' },
  { key: 'members', label: 'Members', needs: 'reports.view' },
  { key: 'attendance', label: 'Attendance', needs: 'reports.view' },
  { key: 'sales', label: 'Sales', needs: 'reports.view' },
] as const

export default function ReportsPage() {
  const { type } = useParams<{ type: string }>()
  const router = useRouter()
  const { can, locationId, money, locations } = useSession()
  const [range, setRange] = useState<RangeValue>({ preset: '30d', from: '', to: '' })
  const query = { ...rangeQuery(range), locationId }
  const { data, error, loading, refreshing, reload } = useApi<any>(`/api/reports/${type}${qs(query)}`)
  const tabs = TABS.filter((t) => can(t.needs))
  const period = 'vs previous period'
  const Export = ({ section }: { section: string }) => (
    <a href={`/api/reports/${type}${qs({ ...query, format: 'csv', section })}`} aria-label="Export this table as CSV"><Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />}>CSV</Button></a>
  )
  const unit = data?.monthly ? 'month' : 'day'
  const s = data?.summary

  return (
    <Page>
      <PageHeader
        title="Reports"
        description={locationId ? `Showing ${locations.find((l) => l.id === locationId)?.name || 'one location'}` : locations.length > 1 ? 'Showing all locations' : undefined}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />
      <Tabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} value={type as (typeof TABS)[number]['key']} onChange={(key) => router.push(`/reports/${key}`)} />

      {loading ? (
        <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}</div><Skeleton className="h-72 rounded-xl" /></div>
      ) : error || !data ? (
        <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card>
      ) : (
        <div className={refreshing ? 'space-y-4 opacity-70 transition-opacity' : 'space-y-4 transition-opacity'}>
          {type === 'financial' && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Net revenue" value={money(s.netCents)} delta={s.netChange} hint={period} />
                <Stat label="Gross collected" value={money(s.grossCents)} hint={`${s.payments} payments`} />
                <Stat label="Refunds" value={money(s.refundsCents)} />
                <Stat label="Failed payments" value={money(s.failedCents)} hint={`${s.failedCount} attempts`} href="/billing/failed" />
                <Stat label="Monthly recurring revenue" value={money(s.mrrCents)} hint="As of now" />
                <Stat label="Annual run rate" value={money(s.arrCents)} hint="MRR × 12" />
                <Stat label="Outstanding" value={money(s.outstandingCents)} hint="Open invoices, as of now" href="/billing/invoices?status=open" />
              </div>
              <Card><CardHeader title="Net revenue" description={`Payments less refunds, per ${unit}`} action={<Export section="series" />} /><TrendChart data={data.series} format="money" name="Net revenue" height={260} /></Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader title="Revenue by category" description="Paid invoices in this period" action={<Export section="byCategory" />} /><BarList rows={data.byCategory} format="money" /></Card>
                <Card><CardHeader title="Revenue by membership" description="Paid invoices in this period" action={<Export section="byPlan" />} /><BarList rows={(data.byPlan as Row[]).map((r) => ({ ...r, hint: `${r.count} invoice${r.count === 1 ? '' : 's'}` }))} format="money" /></Card>
                <Card><CardHeader title="Recurring revenue by plan" description="Monthly, from memberships set to renew" action={<Export section="mrrByPlan" />} /><BarList rows={(data.mrrByPlan as Row[]).map((r) => ({ ...r, hint: `${r.count} member${r.count === 1 ? '' : 's'}` }))} format="money" /></Card>
                <Card><CardHeader title="Top products" action={<Export section="byProduct" />} /><BarList rows={(data.byProduct as Row[]).map((r) => ({ ...r, hint: `${r.count} sold` }))} format="money" emptyLabel="No product sales in this period" /></Card>
                {data.byLocation.length > 1 && <Card><CardHeader title="Revenue by location" action={<Export section="byLocation" />} /><BarList rows={data.byLocation} format="money" /></Card>}
                <Card><CardHeader title="Payment methods" action={<Export section="byMethod" />} /><BarList rows={(data.byMethod as Row[]).map((r) => ({ ...r, label: titleCase(r.label), hint: `${r.count} payment${r.count === 1 ? '' : 's'}` }))} format="money" /></Card>
              </div>
            </>
          )}

          {type === 'members' && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Active members" value={s.active} hint={`${s.total} in total`} href="/members?status=active" />
                <Stat label="New members" value={s.joined} delta={s.joinedChange} hint={period} />
                <Stat label="Cancelled memberships" value={s.cancelled} delta={s.cancelledChange} goodWhen="down" hint={period} />
                <Stat label="Churn" value={formatPercent(s.churnPercent, 1)} hint="Recurring memberships cancelled in the period" />
                <Stat label="Retention" value={formatPercent(s.retentionPercent, 1)} hint="Of members at the start of the period" />
                <Stat label="Lifetime value" value={money(s.lifetimeValueCents)} hint="Average paid per paying member, all time" />
              </div>
              <Card><CardHeader title="New members" description={`Per ${unit}`} action={<Export section="series" />} /><TrendChart data={data.series} format="number" name="New members" /></Card>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card><CardHeader title="Members by status" action={<Export section="byStatus" />} /><BarList rows={(data.byStatus as Row[]).map((r) => ({ ...r, label: titleCase(r.label), href: `/members?status=${r.label}` }))} format="number" /></Card>
                <Card><CardHeader title="Members by plan" action={<Export section="byPlan" />} /><BarList rows={data.byPlan} format="number" emptyLabel="No memberships yet" /></Card>
                <Card><CardHeader title="Why members cancelled" action={<Export section="cancelReasons" />} /><BarList rows={data.cancelReasons} format="number" emptyLabel="No cancellations in this period" /></Card>
              </div>
            </>
          )}

          {type === 'attendance' && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Check-ins" value={s.checkins.toLocaleString()} delta={s.checkinsChange} hint={period} />
                <Stat label="Unique members" value={s.uniqueMembers} hint={`${s.averagePerDay.toFixed(1)} visits a day`} />
                <Stat label="Class utilization" value={formatPercent(s.utilizationPercent)} hint={`${s.classSessions} classes run`} />
                <Stat label="No-show rate" value={formatPercent(s.noShowPercent, 1)} hint={`${s.noShows} no-shows · ${s.lateCancels} late cancels`} />
              </div>
              <Card><CardHeader title="Check-ins" description={`Per ${unit}`} action={<Export section="series" />} /><TrendChart data={data.series} format="number" name="Check-ins" /></Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader title="Busiest hours" description="Check-ins by hour of day" action={<Export section="byHour" />} /><ColumnChart data={(data.byHour as { hour: number; value: number }[]).map((h) => ({ label: `${((h.hour + 11) % 12) + 1}${h.hour < 12 ? 'a' : 'p'}`, value: h.value }))} format="number" name="Check-ins" /></Card>
                <Card><CardHeader title="Most frequent members" action={<Export section="topMembers" />} /><BarList rows={(data.topMembers as (Row & { id: string })[]).map((r) => ({ ...r, href: `/members/${r.id}` }))} format="number" /></Card>
              </div>
              {([['byClass', 'By class'], ['byCoach', 'By coach'], ...(data.byLocation.length > 1 ? [['byLocation', 'By location']] : [])] as [string, string][]).map(([key, title]) => (
                <Card key={key} padded={false}>
                  <CardHeader title={title} className="px-4 pt-4 sm:px-5" action={<Export section={key} />} />
                  <Table>
                    <thead><tr><Th>{title.replace('By ', '').replace(/^./, (c) => c.toUpperCase())}</Th><Th align="right">Classes</Th><Th align="right">Booked</Th><Th align="right">Attended</Th><Th align="right">Utilization</Th><Th align="right">No-shows</Th><Th align="right">No-show rate</Th><Th align="right">Late cancels</Th></tr></thead>
                    <tbody>
                      {(data[key] as ClassRow[]).length === 0 ? <tr><Td className="py-6 text-center text-fg-subtle">No classes ran in this period</Td></tr> : (data[key] as ClassRow[]).map((r) => (
                        <tr key={r.label}><Td className="font-medium text-fg-heading">{r.label}</Td><Td align="right">{r.sessions}</Td><Td align="right">{r.booked}</Td><Td align="right">{r.attended}</Td><Td align="right">{formatPercent(r.utilizationPercent)}</Td><Td align="right">{r.noShows}</Td><Td align="right">{formatPercent(r.noShowPercent, 1)}</Td><Td align="right">{r.lateCancels}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              ))}
            </>
          )}

          {type === 'sales' && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="New leads" value={s.leads} delta={s.leadsChange} hint={period} href="/leads" />
                <Stat label="Contact rate" value={formatPercent(s.contactPercent)} hint="Of leads created in the period" />
                <Stat label="Trial rate" value={formatPercent(s.trialPercent)} hint="Leads that completed a trial" />
                <Stat label="Trial conversion" value={formatPercent(s.trialConversionPercent)} hint="Trials that became members" />
                <Stat label="Lead conversion" value={formatPercent(s.conversionPercent)} hint="Of leads created in the period" />
                <Stat label="Leads converted" value={s.converted} hint="Converted during the period" />
                <Stat label="Revenue from converted leads" value={money(s.leadRevenueCents)} hint="Paid to date by those members" />
                <Stat label="Memberships sold" value={s.membershipsSold} />
              </div>
              <Card><CardHeader title="New leads" description={`Per ${unit}`} action={<Export section="series" />} /><TrendChart data={data.series} format="number" name="New leads" /></Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader title="Funnel" description="Leads created in this period" action={<Export section="funnel" />} /><BarList rows={data.funnel} format="number" max={Math.max(1, data.funnel[0]?.value || 1)} /></Card>
                <Card><CardHeader title="Pipeline right now" description="All leads by stage" /><BarList rows={LEAD_STAGES.map((st) => ({ label: st.label, value: data.pipeline[st.key] || 0 }))} format="number" /></Card>
              </div>
              {([['bySource', 'Lead sources'], ['byStaff', 'Leads by employee']] as const).map(([key, title]) => (
                <Card key={key} padded={false}>
                  <CardHeader title={title} className="px-4 pt-4 sm:px-5" action={<Export section={key} />} />
                  <Table>
                    <thead><tr><Th>{key === 'bySource' ? 'Source' : 'Employee'}</Th><Th align="right">Leads</Th><Th align="right">Converted</Th><Th align="right">Conversion</Th></tr></thead>
                    <tbody>
                      {(data[key] as SourceRow[]).length === 0 ? <tr><Td className="py-6 text-center text-fg-subtle">No leads in this period</Td></tr> : (data[key] as SourceRow[]).map((r) => <tr key={r.label}><Td className="font-medium text-fg-heading">{r.label}</Td><Td align="right">{r.leads}</Td><Td align="right">{r.converted}</Td><Td align="right">{formatPercent(r.conversionPercent)}</Td></tr>)}
                    </tbody>
                  </Table>
                </Card>
              ))}
              <Card><CardHeader title="Product sales by employee" action={<Export section="posByStaff" />} /><BarList rows={(data.posByStaff as Row[]).map((r) => ({ ...r, hint: `${r.count} order${r.count === 1 ? '' : 's'}` }))} format="money" emptyLabel="No product sales in this period" /></Card>
            </>
          )}
        </div>
      )}
    </Page>
  )
}
