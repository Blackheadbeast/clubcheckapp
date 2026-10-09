'use client'

// Workouts in the member app: today's workout, the program it belongs to, logging it set by set,
// and the history and records that come out of that. The prescription always comes from the server
// and is only ever displayed; what the member types is saved beside it.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Ban, Check, ChevronLeft, ChevronRight, Clock, Dumbbell, History, MessageSquare, Play, Plus, Trophy, X } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { formatDate, formatDateTime, formatTime } from '@/lib/format'
import { BLOCK_LABELS, describeBlock, describePrescription, itemLabel, type Scaling, type WorkoutBlock, type WorkoutItem } from '@/lib/workouts/content'
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, Modal, SearchInput, Skeleton, StatusBadge, Textarea, cn, useToast } from '@/components/ui'

type Source = { sessionId: string } | { assignmentId: string; programDayId: string } | { classSessionId: string } | { appointmentId: string }
interface Entry { key: string; kind: string; date: string; startsAt: string | null; name: string; estimatedMinutes: number | null; programName: string | null; week: number | null; coachName: string | null; context: string | null; sessionId: string | null; status: string; source: Source }
interface RecordRow { id: string; name: string; type: string; label: string; value: string; previous: string | null; detail: string | null; at: string; isRecord: boolean; exerciseId: string | null }
interface Overview {
  today: string; todays: Entry[]; upcoming: Entry[]; missed: Entry[]
  programs: { id: string; name: string; goals: string | null; weeks: number; week: number; status: string; coachName: string | null; startDate: string; notStarted: boolean; totalWorkouts: number; completedWorkouts: number; percent: number }[]
  recent: { id: string; name: string; completedAt: string; durationSec: number | null; programName: string | null; result: string | null }[]
  records: RecordRow[]
  totals: { completed: number }
}
interface Logged { id: string; itemId: string; setNumber: number; exerciseName: string; weight: number | null; weightUnit: string | null; reps: number | null; durationSec: number | null; distanceM: number | null; rpe: number | null; notes: string | null }
interface Approach { performedAs: 'rx' | 'scaled' | 'substituted' | 'skipped'; scalingId: string | null; exerciseId: string | null; exerciseName: string | null; note: string | null }
type Item = WorkoutItem & {
  expectedSets: number
  exercise: { name: string; measure: string; description: string | null; instructions: string | null; videoUrl: string | null; primaryMuscle: string | null; equipment: string[] } | null
  approach: Approach
  lastTime: { at: string; sets: string[] } | null
  logged: Logged[]
}
interface Session {
  id: string; status: string; scheduledDate: string | null; completedAt: string | null; durationSec: number | null; resultText: string | null
  memberNotes: string | null; coachFeedback: string | null; coachName: string | null; programName: string | null; source: string
  workout: { name: string; description: string | null; instructions: string | null; estimatedMinutes: number | null; version: number; scoring: 'time' | 'rounds' | null; changedSince: boolean; blocks: (Omit<WorkoutBlock, 'items'> & { items: Item[] })[] }
  records: RecordRow[]
}

const minutes = (seconds: number | null | undefined) => (seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : null)
const setText = (s: Pick<Logged, 'weight' | 'weightUnit' | 'reps' | 'durationSec' | 'distanceM'>) =>
  [s.weight ? `${s.weight} ${s.weightUnit || 'lb'}` : null, s.reps != null ? (s.weight ? `× ${s.reps}` : `${s.reps} reps`) : null, s.durationSec ? `${Math.floor(s.durationSec / 60)}:${String(s.durationSec % 60).padStart(2, '0')}` : null, s.distanceM ? `${s.distanceM} m` : null].filter(Boolean).join(' ') || 'Done'
const dayLabel = (date: string, today: string) => {
  if (date === today) return 'Today'
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const STATUS: Record<string, string> = { not_started: 'To do', in_progress: 'In progress', completed: 'Done', skipped: 'Skipped', missed: 'Not done yet' }

type View = { name: 'home' } | { name: 'session'; source: Source } | { name: 'history' } | { name: 'records'; exercise?: { id: string; name: string } }

export function WorkoutsTab({ base, tz }: { base: string; tz: string }) {
  const [view, setView] = useState<View>({ name: 'home' })
  const go = (v: View) => { setView(v); window.scrollTo(0, 0) }
  if (view.name === 'session') return <SessionScreen base={base} tz={tz} source={view.source} onBack={() => go({ name: 'home' })} />
  if (view.name === 'history') return <HistoryScreen base={base} tz={tz} onBack={() => go({ name: 'home' })} onOpen={(id) => go({ name: 'session', source: { sessionId: id } })} />
  if (view.name === 'records') return <RecordsScreen base={base} tz={tz} exercise={view.exercise} onBack={() => go(view.exercise ? { name: 'records' } : { name: 'home' })} onExercise={(exercise) => go({ name: 'records', exercise })} />
  return <Home base={base} tz={tz} go={go} />
}

function Back({ onBack, label }: { onBack: () => void; label: string }) {
  return <button type="button" onClick={onBack} className="ui-focus -ml-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-fg-muted"><ChevronLeft className="h-4 w-4" aria-hidden />{label}</button>
}

function EntryCard({ e, today, tz, onOpen, prominent }: { e: Entry; today: string; tz: string; onOpen: () => void; prominent?: boolean }) {
  const done = e.status === 'completed'
  return (
    <button type="button" onClick={onOpen} className={cn('ui-focus flex w-full items-center gap-3 rounded-xl border bg-surface p-3 text-left shadow-card', prominent && !done ? 'border-accent/60' : 'border-line')}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-subtle text-fg-muted')}>{done ? <Check className="h-5 w-5" aria-hidden /> : <Dumbbell className="h-5 w-5" aria-hidden />}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold leading-snug text-fg-heading">{e.name}</span>
        <span className="block truncate text-xs text-fg-muted">{[prominent ? null : dayLabel(e.date, today), e.startsAt ? formatTime(e.startsAt, tz) : null, e.context, e.estimatedMinutes ? `${e.estimatedMinutes} min` : null].filter(Boolean).join(' · ')}</span>
        {e.coachName && e.kind === 'program' && <span className="block truncate text-xs text-fg-subtle">Coach: {e.coachName}</span>}
      </span>
      <span className={cn('shrink-0 text-xs font-medium', done ? 'text-emerald-700 dark:text-emerald-400' : e.status === 'in_progress' ? 'text-amber-700 dark:text-amber-400' : 'text-fg-muted')}>{STATUS[e.status] || e.status}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
    </button>
  )
}

function Home({ base, tz, go }: { base: string; tz: string; go: (v: View) => void }) {
  const { data, error, loading, reload } = useApi<Overview>(`${base}/workouts`)
  if (loading) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-7 w-32" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-16 rounded-xl" /></div>
  if (error || !data) return <><h1 className="text-xl font-semibold tracking-tight text-fg-heading">Workouts</h1><Card><ErrorState error={error || 'Could not load your workouts'} onRetry={reload} /></Card></>
  const open = (e: Entry) => go({ name: 'session', source: e.sessionId ? { sessionId: e.sessionId } : e.source })
  const nothing = data.todays.length === 0 && data.upcoming.length === 0 && data.programs.length === 0 && data.recent.length === 0 && data.missed.length === 0
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Workouts</h1>
      {nothing ? (
        <Card><EmptyState icon={<Dumbbell className="h-5 w-5" />} title="No workouts yet" description="When your coach gives you a program or a workout, or a class you have booked has one, it shows up here." /></Card>
      ) : (
        <>
          <section aria-labelledby="w-today">
            <h2 id="w-today" className="mb-2 text-sm font-semibold text-fg-heading">Today</h2>
            {data.todays.length === 0 ? (
              <Card><p className="text-sm text-fg-muted">Nothing programmed for today.{data.upcoming[0] ? ` Next up: ${data.upcoming[0].name}, ${dayLabel(data.upcoming[0].date, data.today)}.` : ''}</p></Card>
            ) : <div className="space-y-2">{data.todays.map((e) => <EntryCard key={e.key} e={e} today={data.today} tz={tz} onOpen={() => open(e)} prominent />)}</div>}
          </section>

          {data.missed.length > 0 && (
            <section aria-labelledby="w-missed">
              <h2 id="w-missed" className="mb-2 text-sm font-semibold text-fg-heading">Still to do</h2>
              <div className="space-y-2">{data.missed.map((e) => <EntryCard key={e.key} e={e} today={data.today} tz={tz} onOpen={() => open(e)} />)}</div>
              <p className="mt-1 text-xs text-fg-subtle">From the last week. You can still do these today.</p>
            </section>
          )}

          {data.programs.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="text-xs text-fg-muted">Current program</p><p className="break-words font-semibold text-fg-heading">{p.name}</p></div>
                {p.status === 'paused' ? <Badge tone="amber">Paused</Badge> : p.notStarted ? <Badge tone="blue">Starts {formatDate(`${p.startDate}T12:00:00Z`, 'UTC')}</Badge> : <Badge tone="green">Week {p.week} of {p.weeks}</Badge>}
              </div>
              {p.goals && <p className="mt-1 text-sm text-fg-muted">{p.goals}</p>}
              <div className="mt-3 h-2 rounded-full bg-subtle" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Program progress"><div className="h-2 rounded-full bg-accent" style={{ width: `${p.percent}%` }} /></div>
              <p className="mt-1.5 text-xs text-fg-muted">{p.completedWorkouts} of {p.totalWorkouts} workouts done{p.coachName ? ` · Coach: ${p.coachName}` : ''}</p>
              {p.status === 'paused' && <p className="mt-2 text-xs text-fg-subtle">Your coach has paused this program. The rest of it moves back until it is resumed.</p>}
            </Card>
          ))}

          {data.upcoming.length > 0 && (
            <section aria-labelledby="w-upcoming">
              <h2 id="w-upcoming" className="mb-2 text-sm font-semibold text-fg-heading">Coming up</h2>
              <div className="space-y-2">{data.upcoming.slice(0, 6).map((e) => <EntryCard key={e.key} e={e} today={data.today} tz={tz} onOpen={() => open(e)} />)}</div>
            </section>
          )}

          <section aria-labelledby="w-records">
            <div className="mb-2 flex items-center justify-between"><h2 id="w-records" className="text-sm font-semibold text-fg-heading">Personal records</h2><button type="button" onClick={() => go({ name: 'records' })} className="ui-focus min-h-11 rounded text-sm font-medium text-accent-text">All records</button></div>
            {data.records.length === 0 ? <Card><p className="text-sm text-fg-muted">Log your workouts and your records build up here. A record needs an earlier result to beat.</p></Card> : (
              <Card padded={false}><ul className="divide-y divide-line/60">{data.records.map((r) => <RecordLine key={r.id} r={r} tz={tz} />)}</ul></Card>
            )}
          </section>

          <section aria-labelledby="w-recent">
            <div className="mb-2 flex items-center justify-between"><h2 id="w-recent" className="text-sm font-semibold text-fg-heading">Recent workouts</h2>{data.totals.completed > 0 && <button type="button" onClick={() => go({ name: 'history' })} className="ui-focus min-h-11 rounded text-sm font-medium text-accent-text">History ({data.totals.completed})</button>}</div>
            {data.recent.length === 0 ? <Card><p className="text-sm text-fg-muted">Finished workouts appear here.</p></Card> : (
              <Card padded={false}>
                <ul className="divide-y divide-line/60">
                  {data.recent.map((r) => (
                    <li key={r.id}><button type="button" onClick={() => go({ name: 'session', source: { sessionId: r.id } })} className="ui-focus flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg-heading">{r.name}</span><span className="block truncate text-xs text-fg-muted">{formatDate(r.completedAt, tz)}{r.programName ? ` · ${r.programName}` : ''}{minutes(r.durationSec) ? ` · ${minutes(r.durationSec)}` : ''}</span></span>
                      {r.result && <span className="tabular shrink-0 text-sm font-medium text-fg-heading">{r.result}</span>}
                      <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                    </button></li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </>
      )}
    </>
  )
}

function RecordLine({ r, tz, onOpen }: { r: RecordRow; tz: string; onOpen?: () => void }) {
  const inner = (
    <>
      <Trophy className={cn('h-4 w-4 shrink-0', r.isRecord ? 'text-amber-500' : 'text-fg-subtle')} aria-hidden />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg-heading">{r.name}</span><span className="block truncate text-xs text-fg-muted">{r.label} · {formatDate(r.at, tz)} · {r.previous ? `previous best ${r.previous}` : 'first recorded'}</span></span>
      <span className="tabular shrink-0 text-sm font-semibold text-fg-heading">{r.value}</span>
    </>
  )
  return <li>{onOpen ? <button type="button" onClick={onOpen} className="ui-focus flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">{inner}</button> : <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">{inner}</div>}</li>
}

// ---------------------------------------------------------------------------
// One workout
// ---------------------------------------------------------------------------

function SessionScreen({ base, tz, source, onBack }: { base: string; tz: string; source: Source; onBack: () => void }) {
  const toast = useToast()
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<ClientError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [changing, setChanging] = useState<Item | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [celebrate, setCelebrate] = useState<RecordRow[] | null>(null)
  const key = JSON.stringify(source)

  const load = async () => {
    setError(null)
    try { setSession(await api<Session>(`${base}/workouts/sessions`, { body: { source } })) } catch (err) { setError(err as ClientError) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSession(null); load() }, [key])
  const url = session ? `${base}/workouts/sessions/${session.id}` : ''
  const refresh = async () => { if (session) { try { setSession(await api<Session>(url)) } catch (err) { toast.error((err as ClientError).message) } } }

  const run = async (name: string, body: unknown, after?: (result: never) => void) => {
    setBusy(name)
    try {
      const result = await api(url, { body })
      if (after) after(result as never); else await refresh()
      return true
    } catch (err) {
      toast.error((err as ClientError).message)
      // Something moved (finished on another device, say): show what is true now.
      await refresh()
      return false
    } finally {
      setBusy(null)
    }
  }

  if (error) return <><Back onBack={onBack} label="Workouts" /><Card><ErrorState error={error} onRetry={load} /></Card></>
  if (!session) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-6 w-24" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>

  const w = session.workout
  const active = session.status === 'in_progress'
  const done = session.status === 'completed'
  const items = w.blocks.flatMap((b) => b.items)
  const loggedSets = items.reduce((n, i) => n + i.logged.length, 0)
  const records = session.records.filter((r) => r.isRecord)

  return (
    <>
      <Back onBack={onBack} label="Workouts" />
      <div>
        <h1 className="break-words text-xl font-semibold leading-tight tracking-tight text-fg-heading">{w.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          {done ? <StatusBadge status="completed" /> : session.status === 'skipped' ? <StatusBadge status="skipped" /> : active ? <Badge tone="amber">In progress</Badge> : null}
          {session.programName && <span>{session.programName}</span>}
          {session.coachName && <span>Coach: {session.coachName}</span>}
          {w.estimatedMinutes && !done && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{w.estimatedMinutes} min</span>}
          {done && session.completedAt && <span>{formatDateTime(session.completedAt, tz)}</span>}
          {done && minutes(session.durationSec) && <span>{minutes(session.durationSec)}</span>}
        </p>
      </div>
      {done && session.resultText && <Card className="flex items-center justify-between"><span className="text-sm text-fg-muted">{w.scoring === 'time' ? 'Time' : 'Score'}</span><span className="tabular text-xl font-semibold text-fg-heading">{session.resultText}</span></Card>}
      {done && records.length > 0 && (
        <Card className="border-amber-300/60 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg-heading"><Trophy className="h-4 w-4 text-amber-500" aria-hidden />{records.length} personal record{records.length === 1 ? '' : 's'}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-fg">{records.map((r) => <li key={r.id}>{r.name}: {r.value} <span className="text-fg-muted">({r.label}, was {r.previous})</span></li>)}</ul>
        </Card>
      )}
      {session.coachFeedback && <Card><p className="flex items-center gap-2 text-xs font-medium text-fg-muted"><MessageSquare className="h-3.5 w-3.5" aria-hidden />From {session.coachName || 'your coach'}</p><p className="mt-1 whitespace-pre-wrap text-sm text-fg">{session.coachFeedback}</p></Card>}
      {w.changedSince && done && <p className="text-xs text-fg-subtle">Your coach has updated this workout since. This is the version you did.</p>}
      {(w.description || w.instructions) && <Card>{w.description && <p className="text-sm text-fg">{w.description}</p>}{w.instructions && <p className={cn('whitespace-pre-wrap text-sm text-fg-muted', w.description && 'mt-2')}>{w.instructions}</p>}</Card>}

      {!active && !done && (
        <Button variant="primary" size="lg" className="w-full" loading={busy === 'start'} icon={<Play className="h-4 w-4" />} onClick={() => run('start', { action: 'start' }, (s) => setSession(s))}>{session.status === 'skipped' ? 'Do it after all' : 'Start workout'}</Button>
      )}

      {w.blocks.map((b, bi) => (
        <section key={b.id} aria-label={b.title || BLOCK_LABELS[b.type]}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg-heading">{b.title || BLOCK_LABELS[b.type]}</h2>
            {describeBlock(b) !== (b.title || BLOCK_LABELS[b.type]) && <Badge>{describeBlock(b)}</Badge>}
          </div>
          {b.instructions && <p className="mb-2 whitespace-pre-wrap text-sm text-fg-muted">{b.instructions}</p>}
          <div className="space-y-2">
            {b.items.map((item, ii) => <ItemCard key={item.id} item={item} label={itemLabel(bi, ii, b)} tz={tz} active={active} done={done} busy={busy} run={run} onChange={() => setChanging(item)} />)}
          </div>
        </section>
      ))}

      {(active || done || session.memberNotes) && <NotesCard key={session.id} initial={session.memberNotes || ''} readOnly={!active && !done ? true : false} onSave={(notes) => run('notes', { action: 'notes', notes: notes || null }, () => undefined)} />}

      {active && (
        <div className="space-y-2 pb-2">
          <Button variant="primary" size="lg" className="w-full" icon={<Check className="h-4 w-4" />} onClick={() => setFinishing(true)}>Finish workout</Button>
          <p className="text-center text-xs text-fg-subtle">{loggedSets} set{loggedSets === 1 ? '' : 's'} logged. Once finished, it is saved as it is.</p>
          <button type="button" disabled={!!busy} onClick={async () => { if (await run('skip', { action: 'skip' }, () => undefined)) { toast.success('Workout skipped'); onBack() } }} className="ui-focus mx-auto block min-h-11 rounded text-sm font-medium text-fg-muted">Skip this workout</button>
        </div>
      )}

      {changing && <ApproachSheet base={base} item={changing} busy={busy === 'approach'} onClose={() => setChanging(null)} onChoose={async (approach) => { if (await run('approach', { action: 'approach', approach: { itemId: changing.id, ...approach } })) setChanging(null) }} />}
      {finishing && <FinishSheet scoring={w.scoring} nothingLogged={loggedSets === 0} busy={busy === 'complete'} notes={session.memberNotes || ''} onClose={() => setFinishing(false)} onFinish={(result) => run('complete', { action: 'complete', result }, (r: { session: Session; records: RecordRow[] }) => { setSession(r.session); setFinishing(false); setCelebrate(r.records); window.scrollTo(0, 0) })} />}
      <Modal open={!!celebrate} onClose={() => setCelebrate(null)} title="Workout complete" footer={<Button variant="primary" className="w-full" onClick={() => setCelebrate(null)}>Done</Button>}>
        {celebrate && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-fg"><Check className="h-5 w-5 text-emerald-500" aria-hidden />{w.name} is in your history.</p>
            {celebrate.filter((r) => r.isRecord).length > 0 ? (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 dark:border-amber-800/50 dark:bg-amber-950/30">
                <p className="flex items-center gap-2 font-semibold text-fg-heading"><Trophy className="h-4 w-4 text-amber-500" aria-hidden />New personal record{celebrate.filter((r) => r.isRecord).length === 1 ? '' : 's'}</p>
                <ul className="mt-1 space-y-1">{celebrate.filter((r) => r.isRecord).map((r) => <li key={r.id} className="text-fg"><span className="font-medium">{r.name}</span>: {r.value}<span className="block text-xs text-fg-muted">{r.label}. Previous best {r.previous}.</span></li>)}</ul>
              </div>
            ) : celebrate.length > 0 ? <p className="text-fg-muted">This is your first result for {celebrate.length === 1 ? celebrate[0].name : 'these'}. Next time there will be something to beat.</p> : null}
          </div>
        )}
      </Modal>
    </>
  )
}

function NotesCard({ initial, readOnly, onSave }: { initial: string; readOnly: boolean; onSave: (notes: string) => void }) {
  const [notes, setNotes] = useState(initial)
  const saved = useRef(initial)
  if (readOnly) return initial ? <Card><p className="text-xs font-medium text-fg-muted">Your note</p><p className="mt-1 whitespace-pre-wrap text-sm text-fg">{initial}</p></Card> : null
  return (
    <Card>
      <Field label="Your notes" hint="How it felt, anything your coach should know. Your coach can read this.">
        <Textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes.trim() !== saved.current.trim()) { saved.current = notes; onSave(notes.trim()) } }} />
      </Field>
    </Card>
  )
}

function ItemCard({ item, label, tz, active, done, busy, run, onChange }: { item: Item; label: string; tz: string; active: boolean; done: boolean; busy: string | null; run: (name: string, body: unknown) => Promise<boolean>; onChange: () => void }) {
  const [details, setDetails] = useState(false)
  const how = item.approach.performedAs
  const scale = item.scaling.find((s) => s.id === item.approach.scalingId) || null
  const doing = how === 'substituted' ? item.approach.exerciseName : how === 'scaled' && scale?.exerciseName ? scale.exerciseName : item.exerciseName
  const measure = how === 'rx' ? item.measure : item.exercise?.measure || (scale?.measure ?? item.measure)
  const target: Scaling | WorkoutItem = how === 'scaled' && scale ? scale : item
  const rows = Math.max(how === 'skipped' ? 0 : how === 'scaled' && scale?.sets ? scale.sets : item.expectedSets, ...item.logged.map((l) => l.setNumber), 0)
  const [extra, setExtra] = useState(0)
  const about = item.exercise

  return (
    <div className={cn('rounded-xl border border-line bg-surface p-3 shadow-card', how === 'skipped' && 'opacity-70')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug text-fg-heading">{label && <span className="mr-1.5 text-fg-subtle">{label}</span>}{item.exerciseName}</p>
          <p className="text-sm text-fg-muted">{describePrescription(item) || 'As instructed'}</p>
          {item.notes && <p className="mt-0.5 text-xs text-fg-subtle">{item.notes}</p>}
        </div>
        {about && (about.instructions || about.description || about.videoUrl || about.primaryMuscle || about.equipment.length > 0) && <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} className="ui-focus min-h-11 shrink-0 rounded px-1 text-xs font-medium text-accent-text">{details ? 'Hide' : 'Details'}</button>}
      </div>
      {details && about && (
        <div className="mt-2 rounded-lg bg-subtle/60 px-3 py-2 text-sm text-fg-muted">
          {about.description && <p>{about.description}</p>}
          {about.instructions && <p className="mt-1 whitespace-pre-wrap">{about.instructions}</p>}
          {about.primaryMuscle && <p className="mt-1 text-xs">Works: {about.primaryMuscle}</p>}
          {about.equipment.length > 0 && <p className="mt-1 text-xs">Equipment: {about.equipment.join(', ')}</p>}
          {about.videoUrl && <a href={about.videoUrl} target="_blank" rel="noopener noreferrer" className="ui-focus mt-1 inline-block rounded text-sm font-medium text-accent-text underline">Watch a demonstration</a>}
        </div>
      )}

      {how !== 'rx' && (
        <p className={cn('mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium', how === 'skipped' ? 'bg-subtle text-fg-muted' : 'bg-amber-500/10 text-amber-800 dark:text-amber-400')}>
          {how === 'skipped' ? <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span>{how === 'skipped' ? 'Skipped' : how === 'scaled' ? `${scale?.label || 'Scaled'}: ${doing} ${scale ? describePrescription(scale) : ''}` : `You did ${doing} instead`}{item.approach.note ? ` · ${item.approach.note}` : ''}</span>
        </p>
      )}
      {how === 'rx' && item.approach.note && <p className="mt-1 text-xs text-fg-muted">Note: {item.approach.note}</p>}
      {item.lastTime && active && how !== 'skipped' && <p className="mt-2 text-xs text-fg-subtle">Last time ({formatDate(item.lastTime.at, tz)}): {item.lastTime.sets.join(', ') || 'done'}</p>}
      {item.scaling.length > 0 && !active && !done && <p className="mt-2 text-xs text-fg-muted">Options: {item.scaling.map((s) => `${s.label}${s.exerciseName ? ` (${s.exerciseName})` : ''}`).join(', ')}</p>}

      {active && how !== 'skipped' && (
        <ul className="mt-3 space-y-2">
          {Array.from({ length: rows + extra }, (_, i) => i + 1).map((n) => <SetRow key={`${n}:${how}:${item.approach.scalingId}:${item.approach.exerciseId}`} n={n} measure={measure} target={target} logged={item.logged.find((l) => l.setNumber === n) || null} busy={!!busy} onSave={(set) => run(`set:${item.id}:${n}`, { action: 'set', set: { itemId: item.id, setNumber: n, ...set } })} onDelete={() => run(`del:${item.id}:${n}`, { action: 'delete_set', itemId: item.id, setNumber: n })} />)}
        </ul>
      )}
      {done && how !== 'skipped' && (
        item.logged.length === 0 ? <p className="mt-2 text-xs text-fg-subtle">Nothing logged</p> : <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg">{item.logged.map((l) => <li key={l.id}><span className="text-xs text-fg-subtle">Set {l.setNumber}</span> {setText(l)}{l.rpe ? ` · RPE ${l.rpe}` : ''}</li>)}</ul>
      )}
      {active && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {how !== 'skipped' && <button type="button" onClick={() => setExtra((v) => v + 1)} className="ui-focus inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-accent-text"><Plus className="h-4 w-4" aria-hidden />Add set</button>}
          <button type="button" onClick={onChange} className="ui-focus inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-accent-text"><ArrowLeftRight className="h-4 w-4" aria-hidden />{how === 'rx' ? 'Scale, swap or skip' : 'Change'}</button>
        </div>
      )}
    </div>
  )
}

const numeric = (reps: string | null) => (reps && /^\d+$/.test(reps.trim()) ? Number(reps) : null)

function SetRow({ n, measure, target, logged, busy, onSave, onDelete }: { n: number; measure: string; target: Scaling | WorkoutItem; logged: Logged | null; busy: boolean; onSave: (set: Record<string, unknown>) => Promise<boolean>; onDelete: () => void }) {
  const text = (v: number | null | undefined) => (v == null ? '' : String(v))
  const [weight, setWeight] = useState(text(logged?.weight))
  const [reps, setReps] = useState(text(logged?.reps))
  const [time, setTime] = useState(text(logged?.durationSec))
  const [dist, setDist] = useState(text(logged?.distanceM))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setWeight(text(logged?.weight)); setReps(text(logged?.reps)); setTime(text(logged?.durationSec)); setDist(text(logged?.distanceM)) }, [logged])
  const unit = logged?.weightUnit || target.weightUnit || 'lb'
  // An empty box means "as prescribed": one tap logs the set the coach wrote.
  const hint = { weight: target.weight, reps: numeric(target.reps), time: target.durationSec, dist: target.distanceM }
  const value = (typed: string, fallback: number | null) => (typed.trim() === '' ? fallback : Number(typed))
  const changed = !!logged && (weight !== text(logged.weight) || reps !== text(logged.reps) || time !== text(logged.durationSec) || dist !== text(logged.distanceM))
  const save = async () => {
    setSaving(true)
    const set: Record<string, unknown> = {}
    if (measure === 'weight_reps') { set.weight = value(weight, hint.weight); set.weightUnit = unit; set.reps = value(reps, hint.reps) }
    if (measure === 'reps') set.reps = value(reps, hint.reps)
    if (measure === 'time') set.durationSec = value(time, hint.time)
    if (measure === 'distance') { set.distanceM = value(dist, hint.dist); if (time.trim()) set.durationSec = Number(time) }
    for (const k of Object.keys(set)) if (set[k] == null || Number.isNaN(set[k])) delete set[k]
    await onSave(set)
    setSaving(false)
  }
  const box = (label: string, v: string, on: (s: string) => void, placeholder: number | null, step = '1') => (
    <label className="block min-w-0 flex-1">
      <span className="sr-only">Set {n} {label}</span>
      <Input type="number" inputMode="decimal" min={0} step={step} value={v} placeholder={placeholder != null ? String(placeholder) : label} aria-label={`Set ${n} ${label}`} onChange={(e) => on(e.target.value)} className="h-11 text-center" />
      <span className="mt-0.5 block text-center text-[11px] text-fg-subtle" aria-hidden>{label}</span>
    </label>
  )
  return (
    <li className="flex items-start gap-2">
      <span className={cn('mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', logged ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-subtle text-fg-muted')} aria-hidden>{n}</span>
      {measure === 'weight_reps' && <>{box(unit, weight, setWeight, hint.weight, '0.5')}{box('reps', reps, setReps, hint.reps)}</>}
      {measure === 'reps' && box('reps', reps, setReps, hint.reps)}
      {measure === 'time' && box('seconds', time, setTime, hint.time)}
      {measure === 'distance' && <>{box('metres', dist, setDist, hint.dist, '0.1')}{box('seconds', time, setTime, null)}</>}
      <Button variant={logged && !changed ? 'secondary' : 'primary'} className="h-11 w-11 shrink-0 px-0" loading={saving} disabled={busy && !saving} aria-label={logged ? (changed ? `Update set ${n}` : `Set ${n} logged`) : `Complete set ${n}`} onClick={save}><Check className="h-5 w-5" aria-hidden /></Button>
      {logged ? <Button variant="ghost" className="h-11 w-9 shrink-0 px-0" disabled={busy} aria-label={`Remove set ${n}`} onClick={onDelete}><X className="h-4 w-4" aria-hidden /></Button> : <span className="w-9 shrink-0" aria-hidden />}
    </li>
  )
}

function ApproachSheet({ base, item, busy, onClose, onChoose }: { base: string; item: Item; busy: boolean; onClose: () => void; onChoose: (a: { performedAs: string; scalingId?: string; exerciseId?: string; note?: string | null }) => void }) {
  const [note, setNote] = useState(item.approach.note || '')
  const [swapping, setSwapping] = useState(false)
  const [q, setQ] = useState('')
  const debounced = useDebounced(q.trim(), 250)
  const found = useApi<{ id: string; name: string; category: string }[]>(swapping ? `${base}/workouts/exercises?search=${encodeURIComponent(debounced)}` : null)
  const send = (a: { performedAs: string; scalingId?: string; exerciseId?: string }) => onChoose({ ...a, note: note.trim() || null })
  const option = (active: boolean) => cn('ui-focus flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left', active ? 'border-accent bg-accent/10' : 'border-line bg-surface')
  return (
    <Modal open onClose={onClose} title={item.exerciseName} description={`Prescribed: ${describePrescription(item) || 'as instructed'}`}>
      <div className="space-y-3">
        {swapping ? (
          <>
            <Back onBack={() => setSwapping(false)} label="Options" />
            <SearchInput value={q} onChange={setQ} placeholder="What did you do instead?" />
            <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
              {found.loading ? <li className="px-3 py-3 text-sm text-fg-muted">Searching…</li> : found.error ? <li className="px-3 py-3 text-sm text-fg-muted">Could not load exercises.</li> : (found.data || []).filter((e) => e.id !== item.exerciseId).length === 0 ? <li className="px-3 py-3 text-sm text-fg-muted">No exercises match.</li> : (found.data || []).filter((e) => e.id !== item.exerciseId).map((e) => (
                <li key={e.id}><button type="button" disabled={busy} onClick={() => send({ performedAs: 'substituted', exerciseId: e.id })} className="ui-focus flex min-h-12 w-full items-center px-3 py-2 text-left text-sm font-medium text-fg-heading">{e.name}</button></li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => send({ performedAs: 'rx' })} className={option(item.approach.performedAs === 'rx')}><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">As written</span><span className="block text-xs text-fg-muted">{item.exerciseName} {describePrescription(item)}</span></span></button>
            {item.scaling.map((s) => (
              <button key={s.id} type="button" disabled={busy} onClick={() => send({ performedAs: 'scaled', scalingId: s.id })} className={option(item.approach.performedAs === 'scaled' && item.approach.scalingId === s.id)}>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">{s.label}</span><span className="block text-xs text-fg-muted">{s.exerciseName || item.exerciseName} {describePrescription(s)}{s.notes ? ` · ${s.notes}` : ''}</span></span>
              </button>
            ))}
            {item.scaling.length === 0 && <p className="text-xs text-fg-subtle">Your coach has not set scaling options for this exercise.</p>}
            <button type="button" disabled={busy} onClick={() => setSwapping(true)} className={option(item.approach.performedAs === 'substituted')}><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">I did something else</span><span className="block text-xs text-fg-muted">{item.approach.performedAs === 'substituted' ? `Currently: ${item.approach.exerciseName}` : 'Recorded as a substitution, so your coach knows.'}</span></span><ChevronRight className="h-4 w-4 text-fg-subtle" aria-hidden /></button>
            <button type="button" disabled={busy} onClick={() => send({ performedAs: 'skipped' })} className={option(item.approach.performedAs === 'skipped')}><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">Skip this exercise</span><span className="block text-xs text-fg-muted">Any sets you logged for it are removed.</span></span></button>
          </>
        )}
        <Field label="Note (optional)" hint="Why, for your coach."><Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Sore shoulder, no rack free…" /></Field>
      </div>
    </Modal>
  )
}

function FinishSheet({ scoring, nothingLogged, busy, notes: initial, onClose, onFinish }: { scoring: 'time' | 'rounds' | null; nothingLogged: boolean; busy: boolean; notes: string; onClose: () => void; onFinish: (result: Record<string, unknown>) => void }) {
  const [min, setMin] = useState('')
  const [sec, setSec] = useState('')
  const [rounds, setRounds] = useState('')
  const [reps, setReps] = useState('')
  const [notes, setNotes] = useState(initial)
  const timeSec = (Number(min) || 0) * 60 + (Number(sec) || 0)
  const result = useMemo(() => ({ ...(scoring === 'time' && timeSec > 0 && { timeSec }), ...(scoring === 'rounds' && rounds !== '' && { rounds: Number(rounds), reps: Number(reps) || 0 }), ...(notes.trim() !== initial.trim() && { notes: notes.trim() || null }) }), [scoring, timeSec, rounds, reps, notes, initial])
  const empty = nothingLogged && !('timeSec' in result) && !('rounds' in result) && !notes.trim()
  return (
    <Modal open onClose={onClose} title="Finish workout" footer={<><Button onClick={onClose} disabled={busy}>Keep going</Button><Button variant="primary" loading={busy} disabled={empty} onClick={() => onFinish(result)}>Finish</Button></>}>
      <div className="space-y-4 text-sm">
        {scoring === 'time' && (
          <div><p className="mb-1 font-medium text-fg-heading">Your time</p>
            <div className="flex items-center gap-2"><Input type="number" inputMode="numeric" min={0} max={999} value={min} aria-label="Minutes" placeholder="min" onChange={(e) => setMin(e.target.value)} className="h-11 w-24 text-center" /><span className="text-fg-muted">:</span><Input type="number" inputMode="numeric" min={0} max={59} value={sec} aria-label="Seconds" placeholder="sec" onChange={(e) => setSec(e.target.value)} className="h-11 w-24 text-center" /></div>
          </div>
        )}
        {scoring === 'rounds' && (
          <div><p className="mb-1 font-medium text-fg-heading">Your score</p>
            <div className="flex items-center gap-2"><Input type="number" inputMode="numeric" min={0} max={1000} value={rounds} aria-label="Rounds" placeholder="rounds" onChange={(e) => setRounds(e.target.value)} className="h-11 w-28 text-center" /><span className="text-fg-muted">+</span><Input type="number" inputMode="numeric" min={0} max={999} value={reps} aria-label="Extra reps" placeholder="reps" onChange={(e) => setReps(e.target.value)} className="h-11 w-28 text-center" /></div>
          </div>
        )}
        <Field label="How did it go? (optional)"><Textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></Field>
        {empty ? <p className="text-fg-muted">Log at least one set, a result or a note first. To leave it undone, skip the workout instead.</p> : <p className="text-fg-muted">Finishing saves your sets and result as they are. Only your note can be changed afterwards.</p>}
        <FormError message={null} />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// History and records
// ---------------------------------------------------------------------------

interface HistoryItem { id: string; name: string; completedAt: string; durationSec: number | null; programName: string | null; result: string | null; sets: number; records: number; hasFeedback: boolean }

function HistoryScreen({ base, tz, onBack, onOpen }: { base: string; tz: string; onBack: () => void; onOpen: (id: string) => void }) {
  const first = useApi<{ items: HistoryItem[]; nextBefore: string | null }>(`${base}/workouts/history`)
  const [more, setMore] = useState<HistoryItem[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const next = cursor === undefined ? first.data?.nextBefore : cursor
  const load = async () => {
    if (!next) return
    setBusy(true)
    setProblem(null)
    try {
      const page = await api<{ items: HistoryItem[]; nextBefore: string | null }>(`${base}/workouts/history?before=${encodeURIComponent(next)}`)
      setMore((m) => [...m, ...page.items])
      setCursor(page.nextBefore)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const items = [...(first.data?.items || []), ...more]
  return (
    <>
      <Back onBack={onBack} label="Workouts" />
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Workout history</h1>
      {first.loading ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div> : first.error ? <Card><ErrorState error={first.error} onRetry={first.reload} /></Card> : items.length === 0 ? (
        <Card><EmptyState icon={<History className="h-5 w-5" />} title="No finished workouts yet" description="Every workout you finish is kept here, exactly as you did it." /></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line/60">
            {items.map((h) => (
              <li key={h.id}><button type="button" onClick={() => onOpen(h.id)} className="ui-focus flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium leading-snug text-fg-heading">{h.name}</span><span className="block truncate text-xs text-fg-muted">{formatDate(h.completedAt, tz)}{h.programName ? ` · ${h.programName}` : ''} · {h.sets} set{h.sets === 1 ? '' : 's'}{minutes(h.durationSec) ? ` · ${minutes(h.durationSec)}` : ''}</span></span>
                {h.result && <span className="tabular shrink-0 text-sm font-medium text-fg-heading">{h.result}</span>}
                {h.records > 0 && <Badge tone="amber"><Trophy className="h-3 w-3" aria-hidden />{h.records}</Badge>}
                {h.hasFeedback && <MessageSquare className="h-4 w-4 shrink-0 text-fg-subtle" aria-label="Coach feedback" />}
                <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
              </button></li>
            ))}
          </ul>
          {next && <button type="button" disabled={busy} onClick={load} className="ui-focus block min-h-12 w-full border-t border-line/60 px-4 py-3 text-center text-sm font-medium text-accent-text disabled:opacity-50">{busy ? 'Loading…' : 'Show earlier workouts'}</button>}
        </Card>
      )}
      <FormError message={problem} />
    </>
  )
}

function RecordsScreen({ base, tz, exercise, onBack, onExercise }: { base: string; tz: string; exercise?: { id: string; name: string }; onBack: () => void; onExercise: (e: { id: string; name: string }) => void }) {
  const { data, error, loading, reload } = useApi<{ records: RecordRow[] }>(`${base}/workouts/records${exercise ? `?exerciseId=${exercise.id}` : ''}`)
  return (
    <>
      <Back onBack={onBack} label={exercise ? 'All records' : 'Workouts'} />
      <h1 className="break-words text-xl font-semibold tracking-tight text-fg-heading">{exercise ? exercise.name : 'Personal records'}</h1>
      {exercise && <p className="text-sm text-fg-muted">Every time you set a new best, newest first.</p>}
      {loading ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.records.length === 0 ? (
        <Card><EmptyState icon={<Trophy className="h-5 w-5" />} title="No records yet" description="Log weights, reps and times in your workouts. Your bests are worked out from what you log, and a record needs an earlier result to beat." /></Card>
      ) : (
        <Card padded={false}><ul className="divide-y divide-line/60">{data.records.map((r) => <RecordLine key={r.id} r={r} tz={tz} onOpen={!exercise && r.exerciseId ? () => onExercise({ id: r.exerciseId!, name: r.name }) : undefined} />)}</ul></Card>
      )}
    </>
  )
}
