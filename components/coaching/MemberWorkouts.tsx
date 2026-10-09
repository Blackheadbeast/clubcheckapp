'use client'

// Member → Workouts on the staff profile: the member's programs, what is due, how recent workouts
// went, their records, and the coach's private notes.

import { useState } from 'react'
import Link from 'next/link'
import { Dumbbell, Lock, Trophy } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, SkeletonRows, useToast } from '@/components/ui'
import { SessionReview, TrainingStatus, duration } from './shared'

interface Entry { key: string; date: string; name: string; context: string | null; status: string; sessionId: string | null }
interface HistoryItem { id: string; name: string; completedAt: string; durationSec: number | null; programName: string | null; result: string | null; sets: number; records: number; hasNotes: boolean; hasFeedback: boolean; version: number }
interface RecordRow { id: string; name: string; label: string; value: string; previous: string | null; at: string; isRecord: boolean; detail: string | null }
interface Progress {
  todays: Entry[]; upcoming: Entry[]; missed: Entry[]
  programs: { id: string; programId: string; name: string; weeks: number; week: number; status: string; coachName: string | null; startDate: string; totalWorkouts: number; completedWorkouts: number; percent: number; notStarted: boolean }[]
  totals: { completed: number }
  history: HistoryItem[]; nextBefore: string | null
  records: RecordRow[]
  pastPrograms: { id: string; name: string; status: string; startDate: string }[]
  coachNotes: { sessionId: string; workout: string; note: string; at: string }[]
}

export function MemberWorkouts({ memberId }: { memberId: string }) {
  const toast = useToast()
  const { can, date, dateTime } = useSession()
  const { data, error, loading, reload } = useApi<Progress>(`/api/members/${memberId}/workouts`)
  const [open, setOpen] = useState<string | null>(null)
  const [more, setMore] = useState<HistoryItem[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const manage = can('workouts.manage')

  const loadMore = async () => {
    const before = cursor === undefined ? data?.nextBefore : cursor
    if (!before) return
    setBusy(true)
    try {
      const page = await api<{ items: HistoryItem[]; nextBefore: string | null }>(`/api/members/${memberId}/workouts?before=${encodeURIComponent(before)}`)
      setMore([...more, ...page.items])
      setCursor(page.nextBefore)
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const act = async (id: string, action: string, done: string) => {
    try { await api(`/api/coaching/assignments/${id}`, { body: { action } }); toast.success(done); reload() } catch (err) { toast.error((err as ClientError).message) }
  }

  if (loading) return <Card padded={false}><SkeletonRows rows={5} /></Card>
  if (error || !data) return <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card>
  const history = [...data.history, ...more]
  const hasMore = cursor === undefined ? !!data.nextBefore : !!cursor
  const due = [...data.missed, ...data.todays, ...data.upcoming].slice(0, 8)
  const nothing = data.programs.length === 0 && history.length === 0 && due.length === 0

  if (nothing) {
    return <Card><EmptyState icon={<Dumbbell className="h-5 w-5" />} title="No training yet" description="Assign a program, or a single workout, and their progress shows up here." action={manage ? <Link href="/coaching/programs"><Button variant="primary">Go to programs</Button></Link> : undefined} /></Card>
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card padded={false} className="min-w-0">
        <CardHeader title="Programs" className="px-4 pt-4 sm:px-5" action={manage && <Link href="/coaching/programs"><Button size="sm">Assign a program</Button></Link>} />
        {data.programs.length === 0 ? <p className="px-4 pb-4 text-sm text-fg-muted sm:px-5">Not on a program right now.</p> : (
          <ul className="divide-y divide-line/60 border-t border-line">
            {data.programs.map((p) => (
              <li key={p.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2"><Link href={`/coaching/programs/${p.programId}`} className="ui-focus min-w-0 flex-1 truncate rounded text-sm font-medium text-fg-heading hover:underline">{p.name}</Link><TrainingStatus status={p.status} /></div>
                <p className="text-xs text-fg-muted">{p.notStarted ? `Starts ${p.startDate}` : `Week ${p.week} of ${p.weeks}`}{p.coachName ? ` · ${p.coachName}` : ''} · {p.completedWorkouts} of {p.totalWorkouts} workouts done</p>
                <div className="mt-2 h-1.5 rounded-full bg-subtle" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}><div className="h-1.5 rounded-full bg-accent" style={{ width: `${p.percent}%` }} /></div>
                {manage && (
                  <div className="mt-2 flex gap-2">
                    {p.status === 'paused' ? <Button size="sm" onClick={() => act(p.id, 'resume', 'Program resumed')}>Resume</Button> : <Button size="sm" onClick={() => act(p.id, 'pause', 'Program paused')}>Pause</Button>}
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(p.id, 'cancel', 'Assignment ended')}>End</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.pastPrograms.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-fg-muted sm:px-5">Earlier: {data.pastPrograms.map((p) => `${p.name} (${p.status})`).join(', ')}</p>}
      </Card>

      <Card padded={false} className="min-w-0">
        <CardHeader title="Due and coming up" className="px-4 pt-4 sm:px-5" />
        {due.length === 0 ? <p className="px-4 pb-4 text-sm text-fg-muted sm:px-5">Nothing scheduled in the next two weeks.</p> : (
          <ul className="divide-y divide-line/60 border-t border-line">
            {due.map((e) => (
              <li key={e.key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg-heading">{e.name}</p><p className="truncate text-xs text-fg-muted">{e.date === new Date().toLocaleDateString('en-CA') ? 'Today' : e.date}{e.context ? ` · ${e.context}` : ''}</p></div>
                <TrainingStatus status={e.status} />
                {e.sessionId && <Button size="sm" onClick={() => setOpen(e.sessionId)}>View</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded={false} className="min-w-0">
        <CardHeader title="Workout history" description={`${data.totals.completed} completed`} className="px-4 pt-4 sm:px-5" />
        {history.length === 0 ? <p className="px-4 pb-4 text-sm text-fg-muted sm:px-5">No finished workouts yet.</p> : (
          <ul className="divide-y divide-line/60 border-t border-line">
            {history.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => setOpen(h.id)} className="ui-focus flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-subtle/60 sm:px-5">
                  <span className="min-w-0 flex-1 basis-[10rem]"><span className="block truncate text-sm font-medium text-fg-heading">{h.name}</span><span className="block truncate text-xs text-fg-muted">{dateTime(h.completedAt)}{h.programName ? ` · ${h.programName}` : ''}{duration(h.durationSec) ? ` · ${duration(h.durationSec)}` : ''}</span></span>
                  {h.result && <Badge tone="blue">{h.result}</Badge>}
                  {h.records > 0 && <Badge tone="amber"><Trophy className="mr-1 inline h-3 w-3" aria-hidden />{h.records}</Badge>}
                  {h.hasNotes && <Badge>Note</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasMore && <button type="button" disabled={busy} onClick={loadMore} className="ui-focus block w-full border-t border-line/60 px-4 py-3 text-center text-sm font-medium text-accent-text disabled:opacity-50">{busy ? 'Loading…' : 'Show earlier workouts'}</button>}
      </Card>

      <Card padded={false} className="min-w-0">
        <CardHeader title="Personal records" description="Their current best for each lift or workout." className="px-4 pt-4 sm:px-5" />
        {data.records.length === 0 ? <p className="px-4 pb-4 text-sm text-fg-muted sm:px-5">Records appear once there are results to compare.</p> : (
          <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto border-t border-line">
            {data.records.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg-heading">{r.name}</p><p className="truncate text-xs text-fg-muted">{r.label} · {date(r.at)}{r.previous ? ` · was ${r.previous}` : ' · first recorded'}</p></div>
                <span className="tabular shrink-0 text-sm font-semibold text-fg-heading">{r.value}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.coachNotes.length > 0 && (
        <Card padded={false} className="min-w-0 lg:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2"><Lock className="h-4 w-4 text-fg-subtle" aria-hidden />Coach notes</span>} description="Staff only. The member never sees these." className="px-4 pt-4 sm:px-5" />
          <ul className="divide-y divide-line/60 border-t border-line">
            {data.coachNotes.map((n) => <li key={n.sessionId} className="px-4 py-2.5 sm:px-5"><button type="button" onClick={() => setOpen(n.sessionId)} className="ui-focus block w-full rounded text-left"><span className="block text-xs text-fg-muted">{n.workout} · {date(n.at)}</span><span className="block whitespace-pre-wrap text-sm text-fg">{n.note}</span></button></li>)}
          </ul>
        </Card>
      )}
      <SessionReview sessionId={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  )
}
