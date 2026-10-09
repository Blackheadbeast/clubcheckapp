'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ClipboardList, MessageSquare, Trophy } from 'lucide-react'
import { useApi } from '@/lib/client'
import { addDaysToDate } from '@/lib/dates'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Page, PageHeader, SkeletonRows, Stat } from '@/components/ui'
import { SessionReview, TrainingStatus } from '@/components/coaching/shared'

interface Row { key: string; member: { id: string; name: string; photoUrl: string | null }; workout: string; context: string; status: string; sessionId: string | null; completedAt: string | null; result: string | null; records: number; note: string | null }
interface Day {
  date: string; today: string; isToday: boolean
  summary: { due: number; completed: number; inProgress: number; notStarted: number; missed: number; skipped: number }
  assignments: { active: number; scheduled: number; paused: number }
  rows: Row[]
  recent: { id: string; member: { id: string; name: string; photoUrl: string | null }; workout: string; programName: string | null; completedAt: string; result: string | null; records: number; note: string | null; hasFeedback: boolean }[]
}

export default function CoachingPage() {
  const { can, dateTime, time } = useSession()
  const [date, setDate] = useState<string | null>(null)
  const { data, error, loading, reload } = useApi<Day>(`/api/coaching/day${date ? `?date=${date}` : ''}`)
  const [open, setOpen] = useState<string | null>(null)
  const label = data ? (data.isToday ? 'Today' : new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })) : ''

  return (
    <Page>
      <PageHeader
        title="Coaching"
        description="Who has a workout, who has done it, and how it went."
        actions={can('workouts.manage') ? <><Link href="/coaching/programs"><Button>Programs</Button></Link><Link href="/coaching/workouts/new"><Button variant="primary">New workout</Button></Link></> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button aria-label="Previous day" className="px-2" disabled={!data} onClick={() => setDate(addDaysToDate(data!.date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[9rem] text-center text-sm font-semibold text-fg-heading" aria-live="polite">{label}</span>
        <Button aria-label="Next day" className="px-2" disabled={!data} onClick={() => setDate(addDaysToDate(data!.date, 1))}><ChevronRight className="h-4 w-4" /></Button>
        {data && !data.isToday && <Button onClick={() => setDate(null)}>Today</Button>}
      </div>
      {loading ? <Card padded={false}><SkeletonRows rows={6} /></Card> : error || !data ? <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Workouts due" value={data.summary.due} hint={`${data.assignments.active} member${data.assignments.active === 1 ? '' : 's'} on a program`} />
            <Stat label="Completed" value={data.summary.completed} hint={data.summary.due ? `${Math.round((data.summary.completed / data.summary.due) * 100)}% of those due` : undefined} />
            <Stat label={data.date < data.today ? 'Missed' : 'Not started'} value={data.date < data.today ? data.summary.missed : data.summary.notStarted} hint={data.summary.inProgress ? `${data.summary.inProgress} in progress` : undefined} />
            <Stat label="Paused programs" value={data.assignments.paused} hint={data.assignments.scheduled ? `${data.assignments.scheduled} starting later` : undefined} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card padded={false} className="min-w-0 xl:col-span-2">
              <CardHeader title={`${label}'s workouts`} className="px-4 pt-4 sm:px-5" />
              {data.rows.length === 0 ? (
                <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="Nothing programmed for this day" description="Assign a program or a single workout and it shows up here on the day it is due." action={can('workouts.manage') ? <Link href="/coaching/programs"><Button variant="primary">Go to programs</Button></Link> : undefined} />
              ) : (
                <ul className="divide-y divide-line/60">
                  {data.rows.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                      <div className="flex min-w-0 flex-1 basis-[14rem] items-center gap-3">
                        <Avatar name={r.member.name} src={r.member.photoUrl} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/members/${r.member.id}?tab=workouts`} className="ui-focus block truncate rounded text-sm font-medium text-fg-heading hover:underline">{r.member.name}</Link>
                          <p className="truncate text-xs text-fg-muted">{r.workout} · {r.context}</p>
                          {r.note && <p className="mt-0.5 flex items-start gap-1 text-xs text-fg"><MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" aria-hidden /><span className="line-clamp-2">{r.note}</span></p>}
                        </div>
                      </div>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        {r.result && <Badge tone="blue">{r.result}</Badge>}
                        {r.records > 0 && <Badge tone="amber"><Trophy className="mr-1 inline h-3 w-3" aria-hidden />{r.records} PR{r.records === 1 ? '' : 's'}</Badge>}
                        <TrainingStatus status={r.status} />
                        {r.completedAt && <span className="text-xs text-fg-subtle">{time(r.completedAt)}</span>}
                        {r.sessionId && <Button size="sm" onClick={() => setOpen(r.sessionId)}>View</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card padded={false} className="min-w-0">
              <CardHeader title="Recent results" description="The latest finished workouts." className="px-4 pt-4 sm:px-5" />
              {data.recent.length === 0 ? <EmptyState title="No finished workouts yet" description="When members log a workout, their results appear here so you can follow up." /> : (
                <ul className="divide-y divide-line/60">
                  {data.recent.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setOpen(r.id)} className="ui-focus block w-full px-4 py-2.5 text-left hover:bg-subtle/60 sm:px-5">
                        <span className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate font-medium text-fg-heading">{r.member.name}</span>{r.records > 0 && <Trophy className="h-3.5 w-3.5 text-amber-500" aria-label={`${r.records} personal records`} />}{r.result && <span className="tabular text-xs text-fg-muted">{r.result}</span>}</span>
                        <span className="block truncate text-xs text-fg-muted">{r.workout} · {dateTime(r.completedAt)}</span>
                        {r.note && <span className="mt-0.5 block truncate text-xs text-fg">“{r.note}”</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
      <SessionReview sessionId={open} onClose={() => setOpen(null)} onChanged={reload} />
    </Page>
  )
}
