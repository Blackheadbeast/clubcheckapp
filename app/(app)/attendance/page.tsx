'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, ScanLine } from 'lucide-react'
import { qs, useApi } from '@/lib/client'
import { formatPercent, titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, CardHeader, DateRangePicker, EmptyState, ErrorState, Page, PageHeader, Pagination, Select, SkeletonRows, Stat, Table, Td, Th, rangeQuery, type RangeValue } from '@/components/ui'
import { TrendChart } from '@/components/charts'

interface LogRow { id: string; timestamp: string; source: string | null; type: string; member: { id: string; name: string; photoUrl: string | null }; session: { title: string | null; classType: { name: string } } | null; location: { name: string } | null }
interface Report { summary: { checkins: number; checkinsChange: number | null; uniqueMembers: number; averagePerDay: number; utilizationPercent: number | null; noShows: number; noShowPercent: number | null; lateCancels: number }; series: { date: string; value: number }[]; monthly: boolean }

export default function AttendancePage() {
  const { locationId, dateTime, can } = useSession()
  const [range, setRange] = useState<RangeValue>({ preset: '7d', from: '', to: '' })
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const query = { ...rangeQuery(range), locationId }
  useEffect(() => setPage(1), [range, type, locationId])
  const log = useApi<LogRow[]>(`/api/checkin${qs({ ...query, type, page, pageSize: 25 })}`)
  const report = useApi<Report>(can('reports.view') ? `/api/reports/attendance${qs(query)}` : null)

  return (
    <Page>
      <PageHeader title="Attendance" description="Every check-in: classes, open gym and personal training." actions={<><DateRangePicker value={range} onChange={setRange} />{can('reports.view') && <a href={`/api/checkin/export${qs({ from: range.from, to: range.to })}`}><Button icon={<Download className="h-4 w-4" />}>Export</Button></a>}</>} />
      {report.data && (
        <div className="mb-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Check-ins" value={report.data.summary.checkins.toLocaleString()} delta={report.data.summary.checkinsChange} hint="vs previous period" />
            <Stat label="Unique members" value={report.data.summary.uniqueMembers} hint={`${report.data.summary.averagePerDay.toFixed(1)} visits a day`} />
            <Stat label="Class utilization" value={formatPercent(report.data.summary.utilizationPercent)} />
            <Stat label="No-shows" value={report.data.summary.noShows} hint={`${formatPercent(report.data.summary.noShowPercent, 1)} of bookings · ${report.data.summary.lateCancels} late cancels`} />
          </div>
          <Card><CardHeader title="Check-ins" description={`Per ${report.data.monthly ? 'month' : 'day'}`} action={<Link href="/reports/attendance"><Button size="sm" variant="ghost">Full report</Button></Link>} /><TrendChart data={report.data.series} format="number" name="Check-ins" height={200} /></Card>
        </div>
      )}
      <Card padded={false}>
        <CardHeader title="Check-in log" className="px-4 pt-4 sm:px-5" action={<Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-auto"><option value="">All types</option><option value="class">Class</option><option value="open_gym">Open gym</option><option value="personal_training">Personal training</option></Select>} />
        {log.loading ? <SkeletonRows rows={8} /> : log.error ? <ErrorState error={log.error} onRetry={log.reload} /> : !log.data || log.data.length === 0 ? (
          <EmptyState icon={<ScanLine className="h-5 w-5" />} title="No check-ins in this period" description="Every visit is recorded here when a member checks in at the desk, at the kiosk or for a class. Try a wider date range." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Member</Th><Th>When</Th><Th>For</Th><Th>Method</Th><Th>Location</Th></tr></thead>
              <tbody>
                {log.data.map((c) => (
                  <tr key={c.id}>
                    <Td><Link href={`/members/${c.member.id}`} className="ui-focus flex items-center gap-2.5 rounded font-medium text-fg-heading hover:underline"><Avatar name={c.member.name} src={c.member.photoUrl} size="sm" />{c.member.name}</Link></Td>
                    <Td className="text-fg-muted">{dateTime(c.timestamp)}</Td>
                    <Td>{c.session ? c.session.title || c.session.classType.name : titleCase(c.type)}</Td>
                    <Td className="text-fg-muted">{titleCase(c.source || 'manual')}</Td>
                    <Td className="text-fg-muted">{c.location?.name || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {log.meta && <Pagination page={log.meta.page} totalPages={log.meta.totalPages} total={log.meta.total} onPage={setPage} noun="check-ins" />}
          </>
        )}
      </Card>
    </Page>
  )
}
