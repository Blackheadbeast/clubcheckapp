'use client'

// Pick a day and a time for an appointment. Used by staff (booking and
// rescheduling) and by members; the caller supplies the URL that returns the
// genuinely available slots for a date, so this never invents a time.

import { useEffect, useMemo, useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import { useApi } from '@/lib/client'
import { addDaysToDate } from '@/lib/dates'
import { formatTime } from '@/lib/format'
import { Button, EmptyState, ErrorState, Skeleton, cn } from '@/components/ui'

export interface PickedSlot {
  startsAt: string
  endsAt: string
  people: { id: string; name: string }[]
}
interface RawSlot { startsAt: string; endsAt: string; staff?: { id: string; name: string }[]; coaches?: { id: string; name: string }[] }

export function SlotPicker({ slotsUrl, tz, value, onChange, days = 14, touch }: {
  /** Returns the API URL for a YYYY-MM-DD date, or null to show nothing yet. */
  slotsUrl: (date: string) => string | null
  tz: string
  value: PickedSlot | null
  onChange: (slot: PickedSlot | null) => void
  days?: number
  /** Larger targets for phones. */
  touch?: boolean
}) {
  const today = useMemo(() => new Date().toLocaleDateString('en-CA', { timeZone: tz }), [tz])
  const [date, setDate] = useState(today)
  const dates = useMemo(() => Array.from({ length: Math.max(1, Math.min(60, days)) }, (_, i) => addDaysToDate(today, i)), [today, days])
  const url = slotsUrl(date)
  const { data, error, loading, reload } = useApi<RawSlot[]>(url)
  // A different day or filter invalidates whatever time was chosen.
  useEffect(() => { onChange(null) }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  const slots: PickedSlot[] = (data || []).map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, people: s.staff || s.coaches || [] }))
  const groups = [
    { label: 'Morning', items: slots.filter((s) => hour(s.startsAt, tz) < 12) },
    { label: 'Afternoon', items: slots.filter((s) => hour(s.startsAt, tz) >= 12 && hour(s.startsAt, tz) < 17) },
    { label: 'Evening', items: slots.filter((s) => hour(s.startsAt, tz) >= 17) },
  ].filter((g) => g.items.length > 0)
  const nextWithDay = dates[dates.indexOf(date) + 1]

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Day">
        {dates.map((d) => {
          const [y, m, day] = d.split('-').map(Number)
          const utc = new Date(Date.UTC(y, m - 1, day))
          return (
            <button key={d} type="button" role="tab" aria-selected={date === d} onClick={() => setDate(d)} className={cn('ui-focus flex shrink-0 flex-col items-center justify-center rounded-xl border px-1 text-xs font-medium transition', touch ? 'h-16 w-14' : 'h-14 w-12', date === d ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-fg-muted hover:border-fg-subtle/50')}>
              <span>{d === today ? 'Today' : utc.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
              <span className="tabular text-base font-semibold">{day}</span>
            </button>
          )
        })}
      </div>

      {!url ? null : loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={touch ? 'h-11 rounded-lg' : 'h-9 rounded-lg'} />)}</div>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : slots.length === 0 ? (
        <EmptyState icon={<CalendarX2 className="h-5 w-5" />} title="No times available" description="Everything is booked or outside working hours on this day." action={nextWithDay ? <Button onClick={() => setDate(nextWithDay)}>Try the next day</Button> : undefined} />
      ) : (
        <div className="space-y-3" role="radiogroup" aria-label="Time">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 text-xs font-medium text-fg-muted">{g.label}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {g.items.map((s) => {
                  const selected = value?.startsAt === s.startsAt
                  return (
                    <button key={s.startsAt} type="button" role="radio" aria-checked={selected} onClick={() => onChange(selected ? null : s)} className={cn('ui-focus tabular rounded-lg border text-sm font-medium transition', touch ? 'h-11' : 'h-9', selected ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-fg hover:border-fg-subtle/50')}>
                      {formatTime(s.startsAt, tz)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function hour(iso: string, tz: string) {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date(iso)))
}
