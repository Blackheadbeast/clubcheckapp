'use client'

import { Badge, cn, type Tone } from '@/components/ui'

export const STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  open: { label: 'Open', tone: 'blue', help: 'Earnings are still being added.' },
  review: { label: 'In review', tone: 'amber', help: 'Check the figures, then approve.' },
  approved: { label: 'Approved', tone: 'violet', help: 'Nothing more can be added. Finalize to lock it.' },
  finalized: { label: 'Finalized', tone: 'green', help: 'Locked.' },
}

export function PeriodStatus({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, tone: 'neutral' as Tone }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** A calendar date (YYYY-MM-DD) as words, without shifting it through a timezone. */
export const day = (date: string | null | undefined, year = true) => (date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }), timeZone: 'UTC' }) : '')
export const range = (start: string, end: string) => `${day(start, start.slice(0, 4) !== end.slice(0, 4))} – ${day(end)}`
export const hours = (minutes: number) => `${Number((minutes / 60).toFixed(2))} h`

/** An amount of money; anything taken away is shown in red with a minus sign. */
export function Amount({ cents, money, strong, className }: { cents: number; money: (c: number) => string; strong?: boolean; className?: string }) {
  return <span className={cn('tabular whitespace-nowrap', cents < 0 && 'text-red-600 dark:text-red-400', cents === 0 && !strong && 'text-fg-subtle', strong && 'font-semibold text-fg-heading', strong && cents < 0 && 'text-red-600 dark:text-red-400', className)}>{cents < 0 ? `−${money(-cents)}` : money(cents)}</span>
}

export const KIND_LABELS: Record<string, string> = {
  base_hourly: 'Hourly pay', base_salary: 'Salary', base_flat: 'Flat pay', session_pay: 'Appointment pay', class_pay: 'Class pay',
  commission: 'Commission', refund_reversal: 'Refund reversal', adjustment: 'Adjustment',
}
export const ADJUSTMENT_LABELS: Record<string, string> = { bonus: 'Bonus', deduction: 'Deduction', commission_adjustment: 'Commission adjustment', correction: 'Correction', other: 'Other' }

export interface Line {
  id: string; kind: string; adjustmentType: string | null; description: string; reason: string | null; earnedAt: string; carried: boolean; memberName: string | null
  commissionPlanName: string | null; rateType: string | null; percentBps: number | null; flatCents: number | null; sharePercent: number; basisCents: number; minutes: number | null; rateCents: number | null
  amountCents: number; createdByName?: string | null
}

/** The ledger lines behind one person's pay. Wide on a desk, stacked on a phone. */
export function Lines({ lines, money, date }: { lines: Line[]; money: (c: number) => string; date: (v: string) => string }) {
  if (!lines.length) return <p className="py-6 text-center text-sm text-fg-muted">Nothing earned in this period yet.</p>
  return (
    <ul className="divide-y divide-line/60 rounded-lg border border-line" aria-label="Earnings lines">
      {lines.map((l) => {
        const share = l.sharePercent !== 100 ? ` · ${l.sharePercent}% share` : ''
        // A reversal takes back part of a commission; the original line beside it shows what that was worked out on.
        const rate = l.kind === 'refund_reversal' ? (l.rateType === 'percent' ? `${(l.percentBps || 0) / 100}% commission taken back${share}` : `commission taken back${share}`) : l.rateType === 'percent' ? `${(l.percentBps || 0) / 100}% of ${money(l.basisCents)}${l.sharePercent !== 100 ? ` · ${l.sharePercent}% share` : ''}` : l.rateType === 'flat' && l.kind === 'commission' ? `${money(l.flatCents || 0)} fixed${l.sharePercent !== 100 ? ` · ${l.sharePercent}% share` : ''}` : null
        return (
          <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
            <span className="w-24 shrink-0 text-xs text-fg-muted">{date(l.earnedAt)}</span>
            <span className="min-w-0 flex-1 basis-56">
              <span className="block break-words text-fg">{l.description}</span>
              <span className="block text-xs text-fg-muted">
                {l.kind === 'adjustment' ? ADJUSTMENT_LABELS[l.adjustmentType || 'other'] : KIND_LABELS[l.kind] || l.kind}
                {rate ? ` · ${rate}` : ''}{l.commissionPlanName && l.kind === 'commission' ? ` · ${l.commissionPlanName}` : ''}
                {l.reason ? ` · ${l.reason}` : ''}{l.createdByName && l.kind === 'adjustment' ? ` · by ${l.createdByName}` : ''}{l.carried ? ' · carried from an earlier period' : ''}
              </span>
            </span>
            <Amount cents={l.amountCents} money={money} className="ml-auto font-medium" />
          </li>
        )
      })}
    </ul>
  )
}
