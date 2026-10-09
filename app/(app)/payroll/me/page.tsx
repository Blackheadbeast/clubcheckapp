'use client'

// One person's own earnings, period by period. Nobody else's figures are ever sent to this page.

import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Card, CardHeader, EmptyState, ErrorState, Page, PageHeader, SkeletonRows } from '@/components/ui'
import { Amount, Lines, PeriodStatus, range, type Line } from '@/components/payroll/shared'

interface Period { id: string; name: string; startDate: string; endDate: string; status: string; baseCents: number; commissionCents: number; reversalCents: number; adjustmentCents: number; totalCents: number }
interface Data { periods: Period[]; lines: { period: { id: string }; lines: Line[] } | null }

export default function MyEarningsPage() {
  const { money, date } = useSession()
  const [periodId, setPeriodId] = useState<string | null>(null)
  const { data, error, loading, reload } = useApi<Data>(`/api/payroll/me${periodId ? `?periodId=${periodId}` : ''}`)
  useEffect(() => { if (!periodId && data?.periods.length) setPeriodId(data.periods[0].id) }, [data, periodId])
  const current = data?.periods.find((p) => p.id === periodId) || null
  return (
    <Page width="narrow">
      <PageHeader title="My earnings" description="What you have earned in each pay period. Figures for a period that is still open can change until it is finalized." />
      {loading && !data ? <Card padded={false}><SkeletonRows rows={5} /></Card> : error || !data ? <Card><ErrorState error={error || 'Could not load your earnings'} onRetry={reload} /></Card> : data.periods.length === 0 ? (
        <Card><EmptyState icon={<Wallet className="h-5 w-5" />} title="Nothing to show yet" description="Your earnings appear here once your gym has started a pay period." /></Card>
      ) : (
        <div className="space-y-5">
          <Card padded={false}>
            <ul className="divide-y divide-line/60" aria-label="Pay periods">
              {data.periods.map((p) => (
                <li key={p.id}>
                  <button type="button" aria-current={p.id === periodId ? 'true' : undefined} onClick={() => setPeriodId(p.id)} className={`ui-focus flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left sm:px-5 ${p.id === periodId ? 'bg-subtle/70' : 'hover:bg-subtle/40'}`}>
                    <span className="min-w-0 flex-1 basis-40 text-sm font-medium text-fg-heading">{range(p.startDate, p.endDate)}</span>
                    <PeriodStatus status={p.status} />
                    <Amount cents={p.totalCents} money={money} strong className="w-24 text-right" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current && (
            <Card>
              <CardHeader title={range(current.startDate, current.endDate)} description={current.status === 'finalized' ? 'Final.' : 'Not final yet.'} />
              <dl className="my-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                {([['Base pay', current.baseCents], ['Commissions', current.commissionCents], ['Refund reversals', current.reversalCents], ['Adjustments', current.adjustmentCents]] as const).map(([label, cents]) => <div key={label}><dt className="text-xs text-fg-muted">{label}</dt><dd><Amount cents={cents} money={money} className="font-medium" /></dd></div>)}
              </dl>
              {data.lines && data.lines.period.id === current.id ? <Lines lines={data.lines.lines} money={money} date={date} /> : <SkeletonRows rows={3} />}
              <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-sm"><span className="font-semibold text-fg-heading">Total</span><Amount cents={current.totalCents} money={money} strong className="text-base" /></p>
            </Card>
          )}
        </div>
      )}
    </Page>
  )
}
