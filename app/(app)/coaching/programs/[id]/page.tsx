'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, Users } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { DIFFICULTIES } from '@/lib/workouts/content'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, SearchInput, Select, SkeletonRows, Textarea, useToast } from '@/components/ui'
import { TrainingStatus, WEEKDAYS, titleCase } from '@/components/coaching/shared'

interface Day { id?: string; week: number; day: number; workoutId: string; title: string | null; workoutName?: string }
interface Detail { id: string; name: string; description: string | null; goals: string | null; difficulty: string; audience: string | null; weeks: number; archived: boolean; canEdit: boolean; createdByName: string | null; days: Day[] }
interface Assigned { id: string; status: string; startDate: string; endDate: string | null; member: { id: string; name: string; photoUrl: string | null }; coach: { id: string; name: string } | null; completed: number; total: number; dueSoFar: number | null; lastCompletedAt: string | null; week: number }
interface Found { id: string; name: string; email: string }

const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toLocaleDateString('en-CA') }

export default function ProgramPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const { can, date } = useSession()
  const manage = can('workouts.manage')
  const { data, error, loading, reload } = useApi<Detail>(`/api/coaching/programs/${id}`)
  const members = useApi<Assigned[]>(`/api/coaching/programs/${id}/members`)
  const workouts = useApi<{ id: string; name: string }[]>('/api/coaching/workouts?pageSize=100')
  const [f, setF] = useState({ name: '', description: '', goals: '', audience: '', difficulty: 'intermediate', weeks: 4 })
  const [days, setDays] = useState<Day[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  useEffect(() => {
    if (!data) return
    setF({ name: data.name, description: data.description || '', goals: data.goals || '', audience: data.audience || '', difficulty: data.difficulty, weeks: data.weeks })
    setDays(data.days)
    setDirty(false)
    setProblem(null)
  }, [data])
  const readOnly = !manage || !data?.canEdit || !!data?.archived
  const options = useMemo(() => {
    const list = [...(workouts.data || [])]
    // A workout that has since been archived still shows on the days that use it.
    for (const d of data?.days || []) if (!list.some((w) => w.id === d.workoutId)) list.push({ id: d.workoutId, name: `${d.workoutName} (archived)` })
    return list
  }, [workouts.data, data])
  const change = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setDirty(true) }
  const setDay = (week: number, day: number, workoutId: string) => {
    setDays((current) => [...current.filter((d) => !(d.week === week && d.day === day)), ...(workoutId ? [{ week, day, workoutId, title: null }] : [])])
    setDirty(true)
  }
  const copyWeek = (from: number) => {
    setDays((current) => [...current.filter((d) => d.week <= from || d.week > f.weeks), ...Array.from({ length: f.weeks - from }, (_, i) => current.filter((d) => d.week === from).map((d) => ({ week: from + i + 1, day: d.day, workoutId: d.workoutId, title: d.title }))).flat()])
    setDirty(true)
  }

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api(`/api/coaching/programs/${id}`, { method: 'PATCH', body: { ...f, days: days.filter((d) => d.week <= f.weeks).map((d) => ({ week: d.week, day: d.day, workoutId: d.workoutId, title: d.title })) } })
      toast.success('Program saved')
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const act = async (url: string, body: unknown, done: string, method = 'POST') => {
    setBusy(true)
    try {
      await api(url, { method, ...(body !== undefined && { body }) })
      toast.success(done)
      reload(); members.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Page><Card padded={false}><SkeletonRows rows={8} /></Card></Page>
  if (error || !data) return <Page><Card><ErrorState error={error || 'Program not found'} onRetry={reload} /></Card></Page>
  const live = (members.data || []).filter((m) => ['scheduled', 'active', 'paused'].includes(m.status))

  return (
    <Page>
      <PageHeader
        back={<Link href="/coaching/programs" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Programs</Link>}
        title={data.name}
        description={`${data.weeks} week${data.weeks === 1 ? '' : 's'} · ${data.days.length} training day${data.days.length === 1 ? '' : 's'}${data.createdByName ? ` · built by ${data.createdByName}` : ''}${data.archived ? ' · archived' : ''}`}
        actions={
          <>
            {manage && data.canEdit && (data.archived ? <Button loading={busy} onClick={() => act(`/api/coaching/programs/${id}`, { action: 'restore' }, 'Program restored')}>Restore</Button> : <Button variant="ghost" className="text-red-600" loading={busy} onClick={async () => { await act(`/api/coaching/programs/${id}`, undefined, 'Program archived', 'DELETE') }}>Archive</Button>)}
            {!readOnly && <Button loading={busy} disabled={!dirty} onClick={save}>Save changes</Button>}
            {manage && !data.archived && <Button variant="primary" icon={<Users className="h-4 w-4" />} disabled={dirty || data.days.length === 0} onClick={() => setAssigning(true)}>Assign</Button>}
          </>
        }
      />
      <div className="space-y-4">
        <FormError message={problem} />
        {manage && !data.canEdit && <p className="rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">Built by {data.createdByName || 'someone else'}. You can assign it, but only they or a manager can change it.</p>}
        {dirty && <p className="rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">Save your changes before assigning this program.</p>}
        <Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Program name" required className="sm:col-span-2"><Input value={f.name} disabled={readOnly} maxLength={120} onChange={(e) => change({ name: e.target.value })} /></Field>
            <Field label="Weeks"><Input type="number" min={1} max={52} disabled={readOnly} value={f.weeks} onChange={(e) => change({ weeks: Math.min(52, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            <Field label="Difficulty"><Select value={f.difficulty} disabled={readOnly} onChange={(e) => change({ difficulty: e.target.value })}>{DIFFICULTIES.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}</Select></Field>
            <Field label="Goals" className="sm:col-span-2"><Input value={f.goals} disabled={readOnly} maxLength={500} onChange={(e) => change({ goals: e.target.value })} /></Field>
            <Field label="Who it is for" className="sm:col-span-2"><Input value={f.audience} disabled={readOnly} maxLength={200} onChange={(e) => change({ audience: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2 lg:col-span-4"><Textarea rows={2} value={f.description} disabled={readOnly} maxLength={2000} onChange={(e) => change({ description: e.target.value })} /></Field>
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader title="Training days" description="Choose a workout for each day that has one. Each day points at the workout, so improving a workout improves every program that uses it." className="px-4 pt-4 sm:px-5" />
          {workouts.data && workouts.data.length === 0 && <div className="px-4 pb-4 sm:px-5"><EmptyState title="No workouts to choose from yet" action={<Link href="/coaching/workouts/new"><Button variant="primary">Build a workout</Button></Link>} /></div>}
          <div className="divide-y divide-line/60 border-t border-line">
            {Array.from({ length: f.weeks }, (_, w) => w + 1).map((week) => (
              <div key={week} className="px-4 py-3 sm:px-5">
                <div className="mb-2 flex items-center gap-3">
                  <p className="text-sm font-semibold text-fg-heading">Week {week}</p>
                  <span className="text-xs text-fg-muted">{days.filter((d) => d.week === week).length} training day{days.filter((d) => d.week === week).length === 1 ? '' : 's'}</span>
                  {!readOnly && week < f.weeks && days.some((d) => d.week === week) && <button type="button" onClick={() => copyWeek(week)} className="ui-focus ml-auto rounded text-xs font-medium text-accent-text hover:underline">Copy to the weeks after</button>}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                  {WEEKDAYS.map((name, i) => {
                    const current = days.find((d) => d.week === week && d.day === i + 1)
                    return (
                      <label key={name} className="block min-w-0">
                        <span className="mb-1 block text-xs text-fg-muted">{name}</span>
                        <Select aria-label={`Week ${week} ${name}`} value={current?.workoutId || ''} disabled={readOnly} onChange={(e) => setDay(week, i + 1, e.target.value)} className="h-9 w-full truncate text-sm">
                          <option value="">Rest</option>
                          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </Select>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card padded={false}>
          <CardHeader title="Members on this program" description={members.data ? `${live.length} now, ${(members.data.length - live.length)} finished or ended` : undefined} className="px-4 pt-4 sm:px-5" />
          {members.loading ? <SkeletonRows rows={3} /> : members.error ? <ErrorState error={members.error} onRetry={members.reload} /> : !members.data || members.data.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="Nobody is on this program yet" description="Assign it to one member, several, or everyone on a membership plan." action={manage && !data.archived && data.days.length > 0 && !dirty ? <Button variant="primary" onClick={() => setAssigning(true)}>Assign program</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-line/60 border-t border-line">
              {members.data.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 flex-1 basis-[14rem] items-center gap-3">
                    <Avatar name={m.member.name} src={m.member.photoUrl} size="sm" />
                    <div className="min-w-0">
                      <Link href={`/members/${m.member.id}?tab=workouts`} className="ui-focus block truncate rounded text-sm font-medium text-fg-heading hover:underline">{m.member.name}</Link>
                      <p className="truncate text-xs text-fg-muted">From {m.startDate}{m.coach ? ` · ${m.coach.name}` : ''}{m.status === 'active' ? ` · week ${m.week}` : ''}{m.lastCompletedAt ? ` · last trained ${date(m.lastCompletedAt)}` : ''}</p>
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="tabular text-xs text-fg-muted">{m.completed} of {m.total} done{m.dueSoFar != null && m.dueSoFar > m.completed && m.status === 'active' ? ` · ${m.dueSoFar - m.completed} behind` : ''}</span>
                    <TrainingStatus status={m.status} />
                    {manage && m.status === 'paused' && <Button size="sm" loading={busy} onClick={() => act(`/api/coaching/assignments/${m.id}`, { action: 'resume' }, 'Program resumed')}>Resume</Button>}
                    {manage && ['active', 'scheduled'].includes(m.status) && <Button size="sm" loading={busy} onClick={() => act(`/api/coaching/assignments/${m.id}`, { action: 'pause' }, 'Program paused')}>Pause</Button>}
                    {manage && ['active', 'scheduled', 'paused'].includes(m.status) && <Button size="sm" variant="ghost" className="text-red-600" loading={busy} onClick={() => act(`/api/coaching/assignments/${m.id}`, { action: 'cancel' }, 'Assignment ended')}>End</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <AssignProgram open={assigning} programId={id} name={data.name} weeks={data.weeks} onClose={() => setAssigning(false)} onDone={() => { members.reload(); router.refresh() }} />
    </Page>
  )
}

function AssignProgram({ open, programId, name, weeks, onClose, onDone }: { open: boolean; programId: string; name: string; weeks: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { plans, coaches } = useLookups()
  const [mode, setMode] = useState<'members' | 'plan'>('members')
  const [q, setQ] = useState('')
  const debounced = useDebounced(q.trim(), 250)
  const found = useApi<Found[]>(open && mode === 'members' && debounced.length >= 2 ? `/api/members?pageSize=6&search=${encodeURIComponent(debounced)}` : null)
  const [picked, setPicked] = useState<Found[]>([])
  const [planId, setPlanId] = useState('')
  const [startDate, setStartDate] = useState(nextMonday)
  const [endDate, setEndDate] = useState('')
  const [coachId, setCoachId] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (open) { setPicked([]); setQ(''); setPlanId(''); setMode('members'); setProblem(null); setStartDate(nextMonday()); setEndDate('') } }, [open])
  const ready = mode === 'members' ? picked.length > 0 : !!planId
  const send = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ assigned: number; alreadyOn: string[] }>(`/api/coaching/programs/${programId}`, { body: { action: 'assign', assignment: { ...(mode === 'members' ? { memberIds: picked.map((p) => p.id) } : { planId }), startDate, endDate: endDate || null, coachId: coachId || null } } })
      toast.success(`Assigned to ${r.assigned} member${r.assigned === 1 ? '' : 's'}${r.alreadyOn.length ? `. Already on it: ${r.alreadyOn.join(', ')}` : ''}`)
      onDone()
      onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Assign ${name}`} description={`${weeks} week${weeks === 1 ? '' : 's'}. Each member is told, and sees it in their app.`} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ready} onClick={send}>Assign program</Button></>}>
      <div className="space-y-4">
        <Field label="Assign to">
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'members' | 'plan')}>
            <option value="members">Members I choose</option>
            <option value="plan">Everyone on a membership plan</option>
          </Select>
        </Field>
        {mode === 'members' ? (
          <div className="space-y-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search members by name" />
            {debounced.length >= 2 && (
              <ul className="max-h-44 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
                {found.loading ? <li className="px-3 py-2 text-sm text-fg-muted">Searching…</li> : (found.data || []).filter((m) => !picked.some((p) => p.id === m.id)).length === 0 ? <li className="px-3 py-2 text-sm text-fg-muted">No members match.</li> : (found.data || []).filter((m) => !picked.some((p) => p.id === m.id)).map((m) => (
                  <li key={m.id}><button type="button" onClick={() => { setPicked([...picked, m]); setQ('') }} className="ui-focus flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle/60"><Avatar name={m.name} size="sm" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-fg-heading">{m.name}</span><span className="block truncate text-xs text-fg-muted">{m.email}</span></span></button></li>
                ))}
              </ul>
            )}
            {picked.length > 0 ? <ul className="flex flex-wrap gap-2">{picked.map((p) => <li key={p.id}><button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="ui-focus rounded-full border border-line px-2.5 py-1 text-xs text-fg hover:bg-subtle" aria-label={`Remove ${p.name}`}>{p.name} ×</button></li>)}</ul> : <p className="text-xs text-fg-subtle">Search and add one or more members.</p>}
          </div>
        ) : (
          <Field label="Membership plan" hint="Everyone with a live membership on it today. People who join the plan later are not added automatically.">
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Choose…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start date" hint="Week 1 is the week this falls in."><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></Field>
          <Field label="End date" hint="Optional."><Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          <Field label="Coach" hint="Told when workouts are completed."><Select value={coachId} onChange={(e) => setCoachId(e.target.value)}><option value="">No coach</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        </div>
        <FormError message={problem} />
      </div>
    </Modal>
  )
}
