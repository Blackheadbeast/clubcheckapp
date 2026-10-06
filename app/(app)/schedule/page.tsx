'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api, ClientError, qs, useApi } from '@/lib/client'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Button, Card, ConfirmModal, EmptyState, ErrorState, Page, PageHeader, Select, Spinner, cn, useToast } from '@/components/ui'
import type { SessionSummary } from '@/components/schedule/BookClassModal'
import { SessionDrawer, SessionFormModal, type SessionDraft } from '@/components/schedule/SessionModals'

type View = 'day' | 'week' | 'month' | 'agenda'
const VIEWS: { key: View; label: string }[] = [{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'agenda', label: 'Agenda' }]
const HOUR_PX = 56
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
/** Monday of the week containing `date`. */
const weekStart = (date: string) => addDaysToDate(date, -((weekday(date) + 6) % 7))
const pad = (n: number) => String(n).padStart(2, '0')
const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

interface Placed extends SessionSummary {
  date: string
  startMin: number
  endMin: number
  lane: number
  lanes: number
}

/** Convert sessions to gym-local positions and lay out overlapping ones side by side. */
function place(sessions: SessionSummary[], tz: string): Map<string, Placed[]> {
  const byDay = new Map<string, Placed[]>()
  for (const s of sessions) {
    const start = zonedParts(new Date(s.startsAt), tz)
    const startMin = start.hour * 60 + start.minute
    const duration = Math.max(15, Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60_000))
    const item: Placed = { ...s, date: start.date, startMin, endMin: startMin + duration, lane: 0, lanes: 1 }
    byDay.set(start.date, [...(byDay.get(start.date) || []), item])
  }
  for (const items of byDay.values()) {
    items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    let cluster: Placed[] = []
    let clusterEnd = -1
    const flush = () => {
      const lanes = Math.max(...cluster.map((c) => c.lane)) + 1
      cluster.forEach((c) => (c.lanes = lanes))
    }
    for (const item of items) {
      if (cluster.length && item.startMin >= clusterEnd) {
        flush()
        cluster = []
        clusterEnd = -1
      }
      const used = new Set(cluster.filter((c) => c.endMin > item.startMin).map((c) => c.lane))
      let lane = 0
      while (used.has(lane)) lane++
      item.lane = lane
      cluster.push(item)
      clusterEnd = Math.max(clusterEnd, item.endMin)
    }
    if (cluster.length) flush()
  }
  return byDay
}

function Calendar() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { gym, locationId, can, time } = useSession()
  const tz = gym.timezone
  const lookups = useLookups()
  const today = zonedParts(new Date(), tz).date

  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(today)
  const [classTypeId, setClassTypeId] = useState(params.get('classTypeId') || '')
  const [coachId, setCoachId] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [openId, setOpenId] = useState<string | null>(params.get('session'))
  const [draft, setDraft] = useState<Partial<SessionDraft> | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [move, setMove] = useState<{ session: Placed; date: string; startTime: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const canManage = can('classes.manage')

  // Phones get the agenda: a 7-column grid is unreadable at that width.
  useEffect(() => {
    if (window.innerWidth < 640) setView('agenda')
  }, [])

  const { first, days } = useMemo(() => {
    if (view === 'day') return { first: anchor, days: 1 }
    if (view === 'week') return { first: weekStart(anchor), days: 7 }
    if (view === 'agenda') return { first: anchor, days: 14 }
    return { first: weekStart(anchor.slice(0, 8) + '01'), days: 42 }
  }, [view, anchor])
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDaysToDate(first, i)), [first, days])
  const from = zonedToUtc(first, '00:00', tz).toISOString()
  const to = zonedToUtc(addDaysToDate(first, days), '00:00', tz).toISOString()

  const { data, error, loading, refreshing, reload } = useApi<SessionSummary[]>(`/api/schedule/sessions${qs({ from, to, locationId, classTypeId, coachId, cancelled: showCancelled ? 1 : null })}`)
  const byDay = useMemo(() => place(data || [], tz), [data, tz])

  const step = (direction: 1 | -1) => {
    if (view === 'month') {
      const [y, m] = anchor.split('-').map(Number)
      const next = new Date(Date.UTC(y, m - 1 + direction, 1))
      setAnchor(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`)
    } else setAnchor(addDaysToDate(anchor, direction * (view === 'day' ? 1 : view === 'week' ? 7 : 14)))
  }
  const title =
    view === 'day' ? dayLabel(anchor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : view === 'month' ? dayLabel(anchor, { month: 'long', year: 'numeric' })
    : `${dayLabel(dates[0], { month: 'short', day: 'numeric' })} – ${dayLabel(dates[dates.length - 1], { month: 'short', day: 'numeric', year: 'numeric' })}`

  const create = (date?: string, startTime?: string) => {
    setDraft({ date: date || (dates.includes(today) ? today : dates[0]), startTime: startTime || '09:00', classTypeId: classTypeId || undefined, coachId: coachId || undefined })
    setFormOpen(true)
  }
  const open = (id: string) => setOpenId(id)
  const closeDrawer = () => {
    setOpenId(null)
    if (params.get('session')) router.replace('/schedule')
  }

  const reschedule = async (target: NonNullable<typeof move>) => {
    setMoving(true)
    try {
      const result = await api<{ notified: number }>(`/api/schedule/sessions/${target.session.id}`, { method: 'PATCH', body: { date: target.date, startTime: target.startTime } })
      toast.success(`Moved to ${dayLabel(target.date, { weekday: 'short', month: 'short', day: 'numeric' })}${result.notified ? ` · ${result.notified} member${result.notified === 1 ? '' : 's'} notified` : ''}`)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setMoving(false)
      setMove(null)
    }
  }
  const requestMove = (session: Placed, date: string, startTime: string) => {
    if (session.date === date && `${pad(Math.floor(session.startMin / 60))}:${pad(session.startMin % 60)}` === startTime) return
    const target = { session, date, startTime }
    // Moving a class people have booked sends them an email, so ask first.
    if (session.booked + session.waitlisted > 0) setMove(target)
    else reschedule(target)
  }

  return (
    <Page>
      <PageHeader
        title="Calendar"
        actions={canManage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => create()}>New class</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button onClick={() => setAnchor(today)}>Today</Button>
          <Button aria-label="Previous" onClick={() => step(-1)} className="px-2"><ChevronLeft className="h-4 w-4" /></Button>
          <Button aria-label="Next" onClick={() => step(1)} className="px-2"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <h2 className="mr-auto min-w-0 truncate text-base font-semibold text-fg-heading" aria-live="polite">{title}</h2>
        {refreshing && <Spinner className="h-4 w-4" />}
        <Select aria-label="Class" value={classTypeId} onChange={(e) => setClassTypeId(e.target.value)} className="w-auto">
          <option value="">All classes</option>
          {lookups.classTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select aria-label="Coach" value={coachId} onChange={(e) => setCoachId(e.target.value)} className="w-auto">
          <option value="">All coaches</option>
          {lookups.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-amber-500" />Cancelled</label>
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" type="button" aria-selected={view === v.key} onClick={() => setView(v.key)} className={cn('ui-focus rounded-md px-2.5 py-1 text-sm font-medium transition', view === v.key ? 'bg-subtle text-fg-heading' : 'text-fg-muted hover:text-fg')}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <Card padded={false} className="overflow-hidden">
        {loading ? (
          <div className="flex h-96 items-center justify-center"><Spinner className="h-6 w-6" /></div>
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : view === 'month' ? (
          <MonthGrid dates={dates} month={anchor.slice(0, 7)} today={today} byDay={byDay} time={time} onOpen={open} onDay={(d) => { setAnchor(d); setView('day') }} />
        ) : view === 'agenda' ? (
          <Agenda dates={dates} today={today} byDay={byDay} time={time} onOpen={open} onCreate={canManage ? () => create() : undefined} />
        ) : (
          <TimeGrid dates={dates} today={today} byDay={byDay} time={time} onOpen={open} canManage={canManage} onCreate={create} onMove={requestMove} />
        )}
      </Card>
      {(view === 'week' || view === 'day') && canManage && <p className="mt-2 hidden text-xs text-fg-subtle sm:block">Drag a class to reschedule it. Click an empty slot to add one.</p>}

      <SessionDrawer sessionId={openId} onClose={closeDrawer} onChanged={reload} />
      <SessionFormModal open={formOpen} initial={draft} onClose={() => setFormOpen(false)} onSaved={reload} />
      <ConfirmModal open={!!move} onClose={() => setMove(null)} onConfirm={() => move && reschedule(move)} loading={moving} title="Move this class?" confirmLabel="Move and notify">
        {move && <p>{move.session.title} will move to {dayLabel(move.date, { weekday: 'long', month: 'short', day: 'numeric' })} at {time(zonedToUtc(move.date, move.startTime, tz))}. The {move.session.booked + move.session.waitlisted} member{move.session.booked + move.session.waitlisted === 1 ? '' : 's'} booked or waiting will be emailed about the change.</p>}
      </ConfirmModal>
    </Page>
  )
}

function Block({ s, time, compact }: { s: Placed; time: (v: string) => string; compact?: boolean }) {
  const full = s.spotsLeft === 0
  const cancelled = s.status === 'cancelled'
  return (
    <>
      <span className={cn('block truncate text-xs font-semibold text-fg-heading', cancelled && 'line-through')}>{s.title}</span>
      {!compact && <span className="block truncate text-[11px] text-fg-muted">{time(s.startsAt)}{s.coach ? ` · ${s.coach.name.split(' ')[0]}` : ''}</span>}
      <span className={cn('tabular block truncate text-[11px]', cancelled ? 'text-red-600 dark:text-red-400' : full ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-fg-muted')}>
        {cancelled ? 'Cancelled' : `${s.booked}/${s.capacity}${s.waitlisted ? ` · ${s.waitlisted} waiting` : ''}`}
      </span>
    </>
  )
}

function TimeGrid({
  dates, today, byDay, time, onOpen, canManage, onCreate, onMove,
}: {
  dates: string[]
  today: string
  byDay: Map<string, Placed[]>
  time: (v: string | Date) => string
  onOpen: (id: string) => void
  canManage: boolean
  onCreate: (date: string, startTime: string) => void
  onMove: (session: Placed, date: string, startTime: string) => void
}) {
  const all = dates.flatMap((d) => byDay.get(d) || [])
  const startHour = Math.max(0, Math.min(6, ...all.map((s) => Math.floor(s.startMin / 60))))
  const endHour = Math.min(24, Math.max(21, ...all.map((s) => Math.ceil(s.endMin / 60))))
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const drag = useRef<{ session: Placed; offset: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const minutesAt = (e: React.MouseEvent | React.DragEvent, offset = 0, snap = 15) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const raw = ((e.clientY - rect.top - offset) / HOUR_PX) * 60 + startHour * 60
    return Math.max(startHour * 60, Math.min(endHour * 60 - snap, Math.round(raw / snap) * snap))
  }
  const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: dates.length > 1 ? 760 : 320 }}>
        <div className="sticky top-0 z-10 grid border-b border-line bg-surface" style={{ gridTemplateColumns: `3.5rem repeat(${dates.length}, minmax(0, 1fr))` }}>
          <div />
          {dates.map((d) => (
            <div key={d} className={cn('border-l border-line px-2 py-2 text-center', d === today && 'bg-accent/5')}>
              <span className="text-xs text-fg-subtle">{dayLabel(d, { weekday: 'short' })}</span>{' '}
              <span className={cn('tabular text-sm font-semibold', d === today ? 'rounded-full bg-accent px-1.5 py-0.5 text-accent-fg' : 'text-fg-heading')}>{Number(d.slice(8))}</span>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${dates.length}, minmax(0, 1fr))` }}>
          <div>
            {hours.map((h) => (
              <div key={h} className="tabular relative text-right text-[11px] text-fg-subtle" style={{ height: HOUR_PX }}>
                <span className="absolute -top-2 right-2">{h === startHour ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`}</span>
              </div>
            ))}
          </div>
          {dates.map((d) => (
            <div
              key={d}
              className={cn('relative border-l border-line', d === today && 'bg-accent/[0.03]', hover === d && 'bg-accent/10')}
              style={{ height: hours.length * HOUR_PX, backgroundImage: 'linear-gradient(to bottom, rgb(var(--color-border) / 0.6) 1px, transparent 1px)', backgroundSize: `100% ${HOUR_PX}px` }}
              onClick={(e) => { if (canManage && e.target === e.currentTarget) onCreate(d, hhmm(minutesAt(e, 0, 30))) }}
              onDragOver={(e) => { if (drag.current) { e.preventDefault(); setHover(d) } }}
              onDragLeave={() => setHover((h) => (h === d ? null : h))}
              onDrop={(e) => {
                e.preventDefault()
                setHover(null)
                if (!drag.current) return
                onMove(drag.current.session, d, hhmm(minutesAt(e, drag.current.offset)))
                drag.current = null
              }}
            >
              {(byDay.get(d) || []).map((s) => {
                const movable = canManage && s.status === 'scheduled' && new Date(s.startsAt) > new Date()
                return (
                  <button
                    key={s.id}
                    type="button"
                    draggable={movable}
                    onDragStart={(e) => { drag.current = { session: s, offset: e.clientY - e.currentTarget.getBoundingClientRect().top }; e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { drag.current = null; setHover(null) }}
                    onClick={() => onOpen(s.id)}
                    aria-label={`${s.title}, ${time(s.startsAt)}, ${s.booked} of ${s.capacity} booked`}
                    className={cn('ui-focus absolute overflow-hidden rounded-md border border-line bg-surface px-1.5 py-1 text-left shadow-card transition hover:z-10 hover:shadow-pop', s.status === 'cancelled' && 'opacity-60', movable && 'cursor-grab active:cursor-grabbing')}
                    style={{
                      top: ((s.startMin - startHour * 60) / 60) * HOUR_PX + 1,
                      height: Math.max(26, ((s.endMin - s.startMin) / 60) * HOUR_PX - 2),
                      left: `calc(${(s.lane / s.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / s.lanes}% - 4px)`,
                      borderLeft: `3px solid ${s.classType.color}`,
                    }}
                  >
                    <Block s={s} time={time} compact={s.endMin - s.startMin < 50} />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MonthGrid({ dates, month, today, byDay, time, onOpen, onDay }: { dates: string[]; month: string; today: string; byDay: Map<string, Placed[]>; time: (v: string) => string; onOpen: (id: string) => void; onDay: (date: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 700 }}>
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((d) => <div key={d} className="px-2 py-2 text-center text-xs font-medium text-fg-subtle">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {dates.map((d) => {
            const items = byDay.get(d) || []
            return (
              <div key={d} className={cn('min-h-[112px] border-b border-l border-line p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0', !d.startsWith(month) && 'bg-subtle/40')}>
                <button type="button" onClick={() => onDay(d)} aria-label={`Open ${dayLabel(d, { weekday: 'long', month: 'long', day: 'numeric' })}`} className={cn('ui-focus tabular mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium hover:bg-subtle', d === today ? 'bg-accent text-accent-fg' : d.startsWith(month) ? 'text-fg' : 'text-fg-subtle')}>
                  {Number(d.slice(8))}
                </button>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((s) => (
                    <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={cn('ui-focus flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-subtle', s.status === 'cancelled' && 'line-through opacity-60')}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.classType.color }} />
                      <span className="tabular shrink-0 text-fg-subtle">{time(s.startsAt).replace(':00', '').replace(' ', '').toLowerCase()}</span>
                      <span className="truncate text-fg">{s.title}</span>
                    </button>
                  ))}
                  {items.length > 3 && <button type="button" onClick={() => onDay(d)} className="ui-focus rounded px-1 text-[11px] font-medium text-accent-text hover:underline">+{items.length - 3} more</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Agenda({ dates, today, byDay, time, onOpen, onCreate }: { dates: string[]; today: string; byDay: Map<string, Placed[]>; time: (v: string) => string; onOpen: (id: string) => void; onCreate?: () => void }) {
  const withClasses = dates.filter((d) => (byDay.get(d) || []).length > 0)
  if (withClasses.length === 0) {
    return <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No classes in these two weeks" description="Schedule a one-off class or set up a weekly recurring one." action={onCreate && <Button variant="primary" onClick={onCreate}>New class</Button>} />
  }
  return (
    <div className="divide-y divide-line">
      {withClasses.map((d) => (
        <section key={d} className="px-4 py-3 sm:px-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{d === today ? 'Today · ' : ''}{dayLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
          <ul className="space-y-1.5">
            {(byDay.get(d) || []).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpen(s.id)} className={cn('ui-focus flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-subtle/60', s.status === 'cancelled' && 'opacity-60')}>
                  <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: s.classType.color }} />
                  <span className="tabular w-16 shrink-0 text-sm font-medium text-fg-heading">{time(s.startsAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium text-fg-heading', s.status === 'cancelled' && 'line-through')}>{s.title}</span>
                    <span className="block truncate text-xs text-fg-muted">{[s.coach?.name, s.location?.name, s.room].filter(Boolean).join(' · ') || 'No coach assigned'}</span>
                  </span>
                  <span className={cn('tabular shrink-0 text-xs', s.status === 'cancelled' ? 'text-red-600 dark:text-red-400' : s.spotsLeft === 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-fg-muted')}>
                    {s.status === 'cancelled' ? 'Cancelled' : `${s.booked}/${s.capacity}${s.waitlisted ? ` +${s.waitlisted}` : ''}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default function SchedulePage() {
  return (
    <Suspense>
      <Calendar />
    </Suspense>
  )
}
