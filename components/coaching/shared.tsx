'use client'

// Pieces the coaching screens share: a read-only rendering of a workout, the exercise picker, the
// control that attaches a workout to a class or appointment, and the review of one member's session.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, Ban, Dumbbell, Trophy } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { BLOCK_LABELS, describeBlock, describePrescription, itemLabel, type WorkoutBlock, type WorkoutItem } from '@/lib/workouts/content'
import { useSession } from '@/components/Session'
import { Badge, Button, ErrorState, Field, FormError, Modal, SearchInput, Select, SkeletonRows, StatusBadge, Textarea, cn, useToast } from '@/components/ui'

export interface ExerciseRow { id: string; name: string; category: string; measure: string; primaryMuscle: string | null; equipment: string[]; difficulty: string; system: boolean; isActive: boolean }
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
export const duration = (seconds: number | null | undefined) => (seconds ? (seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m` : `${Math.max(1, Math.round(seconds / 60))} min`) : null)

/** Choose an exercise from the gym's library and the built-in ones. */
export function ExercisePicker({ open, onClose, onPick, title = 'Choose an exercise' }: { open: boolean; onClose: () => void; onPick: (e: ExerciseRow) => void; title?: string }) {
  const [q, setQ] = useState('')
  const debounced = useDebounced(q.trim(), 200)
  const { data, loading, error, reload } = useApi<ExerciseRow[]>(open ? `/api/coaching/exercises?pageSize=40&search=${encodeURIComponent(debounced)}` : null)
  useEffect(() => { if (!open) setQ('') }, [open])
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name, muscle or category" />
        {loading ? <SkeletonRows rows={5} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No exercises match. <Link href="/coaching/exercises" className="font-medium text-accent-text underline">Add one to the library</Link>.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
            {data.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => { onPick(e); onClose() }} className="ui-focus flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-subtle/60">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg-heading">{e.name}</span><span className="block truncate text-xs text-fg-muted">{titleCase(e.category)}{e.primaryMuscle ? ` · ${e.primaryMuscle}` : ''}{e.equipment.length ? ` · ${e.equipment.join(', ')}` : ''}</span></span>
                  {!e.system && <Badge tone="blue">Yours</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

interface LoggedSet { id: string; setNumber: number; exerciseName: string; weight: number | null; weightUnit: string | null; reps: number | null; durationSec: number | null; distanceM: number | null; rpe: number | null; notes: string | null }
export const setLine = (s: Pick<LoggedSet, 'weight' | 'weightUnit' | 'reps' | 'durationSec' | 'distanceM' | 'rpe'>) =>
  [s.weight ? `${s.weight} ${s.weightUnit || 'lb'}` : null, s.reps != null ? (s.weight ? `× ${s.reps}` : `${s.reps} reps`) : null, s.durationSec ? `${Math.floor(s.durationSec / 60)}:${String(s.durationSec % 60).padStart(2, '0')}` : null, s.distanceM ? `${s.distanceM} m` : null, s.rpe ? `RPE ${s.rpe}` : null].filter(Boolean).join(' ') || 'Done'

type ReviewItem = WorkoutItem & { approach?: { performedAs: string; scalingId: string | null; exerciseName: string | null; note: string | null }; logged?: LoggedSet[] }

/** A workout laid out block by block. With `actual`, what the member did sits under each prescription. */
export function WorkoutOutline({ blocks, actual }: { blocks: (Omit<WorkoutBlock, 'items'> & { items: ReviewItem[] })[]; actual?: boolean }) {
  return (
    <ol className="space-y-3">
      {blocks.map((b, bi) => (
        <li key={b.id} className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle/50 px-3 py-2">
            <span className="text-sm font-semibold text-fg-heading">{b.title || BLOCK_LABELS[b.type]}</span>
            {describeBlock(b) !== (b.title || BLOCK_LABELS[b.type]) && <Badge>{describeBlock(b)}</Badge>}
          </div>
          {b.instructions && <p className="whitespace-pre-wrap px-3 pt-2 text-sm text-fg-muted">{b.instructions}</p>}
          <ul className="divide-y divide-line/60">
            {b.items.map((i, ii) => {
              const how = i.approach?.performedAs || 'rx'
              const scale = i.scaling.find((s) => s.id === i.approach?.scalingId)
              return (
                <li key={i.id} className="px-3 py-2.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium text-fg-heading">{itemLabel(bi, ii, b) && <span className="mr-1.5 text-fg-subtle">{itemLabel(bi, ii, b)}</span>}{i.exerciseName}</span><span className="text-fg-muted">{describePrescription(i)}</span></p>
                  {i.notes && <p className="text-xs text-fg-subtle">{i.notes}</p>}
                  {!actual && i.scaling.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">{i.scaling.map((s) => <li key={s.id}><span className="font-medium text-fg">{s.label}:</span> {s.exerciseName || i.exerciseName} {describePrescription(s)}{s.notes ? ` · ${s.notes}` : ''}</li>)}</ul>
                  )}
                  {actual && (
                    <div className="mt-1.5 rounded-md bg-subtle/60 px-2.5 py-1.5 text-xs">
                      {how === 'skipped' ? <p className="flex items-center gap-1.5 font-medium text-fg-muted"><Ban className="h-3.5 w-3.5" aria-hidden />Skipped{i.approach?.note ? `: ${i.approach.note}` : ''}</p> : (
                        <>
                          {how !== 'rx' && <p className="mb-1 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400"><ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />{how === 'scaled' ? `${!scale?.label || /^scaled$/i.test(scale.label) ? 'Scaled' : `Scaled (${scale.label})`}: ${scale?.exerciseName || i.exerciseName} ${scale ? describePrescription(scale) : ''}` : `Did ${i.approach?.exerciseName} instead`}{i.approach?.note ? ` · ${i.approach.note}` : ''}</p>}
                          {(i.logged || []).length === 0 ? <p className="text-fg-subtle">Nothing logged</p> : (
                            <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-fg">{(i.logged || []).map((s) => <li key={s.id}><span className="text-fg-subtle">Set {s.setNumber}</span> {setLine(s)}{s.notes ? ` (${s.notes})` : ''}</li>)}</ul>
                          )}
                          {how === 'rx' && i.approach?.note && <p className="mt-1 text-fg-muted">{i.approach.note}</p>}
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ol>
  )
}

interface SessionData {
  id: string; status: string; scheduledDate: string | null; completedAt: string | null; durationSec: number | null; resultText: string | null
  memberNotes: string | null; coachFeedback: string | null; coachNotes?: string | null; coachName: string | null; programName: string | null
  member?: { id: string; name: string } | null
  workout: { name: string; version: number; changedSince: boolean; instructions: string | null; blocks: (Omit<WorkoutBlock, 'items'> & { items: ReviewItem[] })[] }
  records: { id: string; name: string; label: string; value: string; previous: string | null; isRecord: boolean }[]
}

/** One member's workout, for their coach: what was set, what was done, and a place to write back. */
export function SessionReview({ sessionId, onClose, onChanged }: { sessionId: string | null; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast()
  const { can, dateTime } = useSession()
  const { data, error, loading, reload } = useApi<SessionData>(sessionId ? `/api/coaching/sessions/${sessionId}` : null)
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { setNotes(data?.coachNotes || ''); setFeedback(data?.coachFeedback || ''); setProblem(null) }, [data])
  const manage = can('workouts.manage')
  const dirty = !!data && (notes !== (data.coachNotes || '') || feedback !== (data.coachFeedback || ''))

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api(`/api/coaching/sessions/${sessionId}`, { method: 'PATCH', body: { coachNotes: notes.trim() || null, coachFeedback: feedback.trim() || null } })
      toast.success(feedback.trim() && feedback.trim() !== (data?.coachFeedback || '') ? 'Saved. The member has been told there is feedback.' : 'Saved')
      reload()
      onChanged?.()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const records = (data?.records || []).filter((r) => r.isRecord)

  return (
    <Modal
      open={!!sessionId}
      onClose={onClose}
      size="lg"
      title={data ? data.workout.name : 'Workout'}
      description={data ? [data.member?.name, data.programName, data.completedAt ? `completed ${dateTime(data.completedAt)}` : data.scheduledDate ? `for ${data.scheduledDate}` : null].filter(Boolean).join(' · ') : undefined}
      footer={manage && data ? <><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save notes</Button></> : undefined}
    >
      {loading ? <SkeletonRows rows={6} /> : error || !data ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={data.status} />
            {data.resultText && <Badge tone="blue">{data.resultText}</Badge>}
            {duration(data.durationSec) && <span className="text-fg-muted">{duration(data.durationSec)}</span>}
            <span className="text-fg-subtle">Version {data.workout.version}</span>
          </div>
          {data.workout.changedSince && <p className="rounded-lg border border-line bg-subtle/60 px-3 py-2 text-xs text-fg-muted">This workout has been changed since. What is shown here is the version this member was given.</p>}
          {records.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800/50 dark:bg-amber-950/30">
              {records.map((r) => <li key={r.id} className="flex items-center gap-2 text-fg"><Trophy className="h-4 w-4 shrink-0 text-amber-500" aria-hidden /><span><span className="font-medium">{r.name}</span> · {r.label}: {r.value} <span className="text-fg-muted">(was {r.previous})</span></span></li>)}
            </ul>
          )}
          <WorkoutOutline blocks={data.workout.blocks} actual />
          {data.memberNotes && <div><p className="text-xs font-medium text-fg-muted">Member&apos;s note</p><p className="whitespace-pre-wrap rounded-lg bg-subtle px-3 py-2 text-sm text-fg">{data.memberNotes}</p></div>}
          {manage ? (
            <>
              <Field label="Feedback for the member" hint="They see this on the workout and get a notification."><Textarea rows={2} value={feedback} maxLength={2000} onChange={(e) => setFeedback(e.target.value)} placeholder="Great depth today. Add 5 lb next week." /></Field>
              <Field label="Coach note (staff only)" hint="Never shown to the member."><Textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Watch the left knee on heavy sets." /></Field>
              <FormError message={problem} />
            </>
          ) : (data.coachFeedback || data.coachNotes) && (
            <div className="space-y-2 text-sm">{data.coachFeedback && <p><span className="font-medium text-fg-heading">Feedback:</span> {data.coachFeedback}</p>}{data.coachNotes && <p><span className="font-medium text-fg-heading">Coach note (staff only):</span> {data.coachNotes}</p>}</div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Attach a programmed workout to a class or a one-to-one appointment, or take it off. */
export function AttachWorkout({ url, current, onChanged, what }: { url: string; current: { id: string; name: string } | null | undefined; onChanged?: () => void; what: 'class' | 'appointment' }) {
  const toast = useToast()
  const { can } = useSession()
  const manage = can('workouts.manage')
  const [editing, setEditing] = useState(false)
  const { data } = useApi<{ id: string; name: string }[]>(editing ? '/api/coaching/workouts?pageSize=100' : null)
  const [busy, setBusy] = useState(false)
  if (!can('workouts.view')) return null
  const set = async (workoutId: string | null) => {
    setBusy(true)
    try {
      await api(url, { method: 'PUT', body: { workoutId } })
      toast.success(workoutId ? 'Workout attached' : 'Workout removed')
      setEditing(false)
      onChanged?.()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Dumbbell className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg-heading">{current ? current.name : 'No workout attached'}</p>
          <p className="text-xs text-fg-muted">{current ? `Members ${what === 'class' ? 'booked into this class' : 'in this appointment'} can see and log it. Doing it is recorded separately from attending.` : `Attach a workout so ${what === 'class' ? 'members booked into this class' : 'the member'} can see what is planned.`}</p>
        </div>
        {manage && !editing && <Button size="sm" onClick={() => setEditing(true)}>{current ? 'Change' : 'Attach workout'}</Button>}
        {manage && current && !editing && <Button size="sm" variant="ghost" loading={busy} onClick={() => set(null)}>Remove</Button>}
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select aria-label="Workout" className="min-w-[12rem] flex-1" defaultValue="" disabled={busy} onChange={(e) => e.target.value && set(e.target.value)}>
            <option value="">{data ? (data.length ? 'Choose a workout…' : 'No workouts yet') : 'Loading…'}</option>
            {(data || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      )}
    </div>
  )
}

export const statusTone = (status: string) => cn(status === 'completed' ? 'text-emerald-700 dark:text-emerald-400' : status === 'missed' ? 'text-red-600 dark:text-red-400' : status === 'in_progress' ? 'text-amber-700 dark:text-amber-400' : 'text-fg-muted')

/** A program or workout status. "Paused" here means a paused program, which the shared badge words differently. */
export function TrainingStatus({ status }: { status: string }) {
  return status === 'paused' ? <Badge tone="amber">Paused</Badge> : <StatusBadge status={status} />
}
