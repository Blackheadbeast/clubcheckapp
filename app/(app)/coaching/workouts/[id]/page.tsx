'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, Info } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, SearchInput, SkeletonRows, useToast } from '@/components/ui'
import { WorkoutBuilder, emptyDraft, fromDraft, toDraft, type Draft } from '@/components/coaching/WorkoutBuilder'

interface Detail {
  id: string; name: string; description: string | null; instructions: string | null; type: string; difficulty: string; estimatedMinutes: number | null; equipment: string[]; content: { blocks: unknown[] }
  version: number; isCurrent: boolean; archived: boolean; inUse: boolean; canEdit: boolean; createdByName: string | null
  versions: { version: number; createdAt: string; createdByName: string | null; sessions: number; current: boolean }[]
  programs: { id: string; name: string }[]
}
interface Found { id: string; name: string; email: string }

export default function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const { can, date } = useSession()
  const isNew = id === 'new'
  const [version, setVersion] = useState<number | null>(null)
  const { data, error, loading, reload } = useApi<Detail>(isNew ? null : `/api/coaching/workouts/${id}${version ? `?version=${version}` : ''}`)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  useEffect(() => { if (data) { setDraft(toDraft(data as never)); setDirty(false); setProblem(null) } }, [data])
  const manage = can('workouts.manage')
  const readOnly = !manage || (!isNew && (!data?.canEdit || !data?.isCurrent || data?.archived))

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      if (isNew) {
        const made = await api<{ id: string }>('/api/coaching/workouts', { body: fromDraft(draft) })
        toast.success('Workout created')
        router.replace(`/coaching/workouts/${made.id}`)
      } else {
        const saved = await api<{ version: number; newVersion: boolean }>(`/api/coaching/workouts/${id}`, { method: 'PATCH', body: fromDraft(draft) })
        toast.success(saved.newVersion ? `Saved as version ${saved.version}. Finished workouts keep the version they were done from.` : 'Workout saved')
        setVersion(null)
        reload()
      }
    } catch (err) {
      setProblem((err as ClientError).message)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setBusy(false)
    }
  }
  const act = async (body: unknown, done: string, then?: (r: { id?: string }) => void, method = 'POST') => {
    setBusy(true)
    try {
      const r = await api<{ id?: string }>(`/api/coaching/workouts/${id}`, { method, ...(body !== undefined && { body }) })
      toast.success(done)
      if (then) then(r); else reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (!isNew && loading) return <Page><Card padded={false}><SkeletonRows rows={8} /></Card></Page>
  if (!isNew && (error || !data)) return <Page><Card><ErrorState error={error || 'Workout not found'} onRetry={reload} /></Card></Page>

  return (
    <Page>
      <PageHeader
        back={<Link href="/coaching/workouts" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Workouts</Link>}
        title={isNew ? 'New workout' : data!.name}
        description={isNew ? 'Add blocks, then the exercises in each.' : `Version ${data!.version}${data!.createdByName ? ` · built by ${data!.createdByName}` : ''}${data!.archived ? ' · archived' : ''}`}
        actions={
          <>
            {!isNew && manage && !data!.archived && data!.isCurrent && <Button onClick={() => setAssigning(true)}>Assign for a day</Button>}
            {!isNew && manage && <Button loading={busy} onClick={() => act({ action: 'duplicate' }, 'Copy made', (r) => router.push(`/coaching/workouts/${r.id}`))}>Duplicate</Button>}
            {!isNew && manage && data!.canEdit && (data!.archived ? <Button loading={busy} onClick={() => act({ action: 'restore' }, 'Workout restored')}>Restore</Button> : <Button variant="ghost" className="text-red-600" loading={busy} onClick={() => act(undefined, 'Workout archived', () => router.push('/coaching/workouts'), 'DELETE')}>Archive</Button>)}
            {!readOnly && <Button variant="primary" loading={busy} disabled={!isNew && !dirty} onClick={save}>{isNew ? 'Create workout' : 'Save changes'}</Button>}
          </>
        }
      />
      <div className="space-y-4">
        <FormError message={problem} />
        {!isNew && data!.inUse && data!.isCurrent && !readOnly && (
          <p className="flex items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Members have already trained from this version. Saving changes starts version {data!.version + 1} for future sessions; what they did stays exactly as it was.</p>
        )}
        {!isNew && !data!.isCurrent && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">This is version {data!.version}, kept as members did it. It cannot be changed.<Button size="sm" onClick={() => setVersion(null)}>Back to the current version</Button></p>
        )}
        {!isNew && manage && !data!.canEdit && <p className="rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">Built by {data!.createdByName || 'someone else'}. You can duplicate it and change your copy.</p>}
        <WorkoutBuilder draft={draft} readOnly={readOnly} onChange={(d) => { setDraft(d); setDirty(true) }} />
        {!isNew && (data!.versions.length > 1 || data!.programs.length > 0) && (
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-semibold text-fg-heading">Versions</p>
                <ul className="space-y-1 text-sm">
                  {data!.versions.map((v) => (
                    <li key={v.version} className="flex items-center gap-2">
                      <button type="button" onClick={() => setVersion(v.current ? null : v.version)} className="ui-focus rounded font-medium text-accent-text hover:underline">Version {v.version}</button>
                      <span className="text-fg-muted">{date(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ''} · done {v.sessions} time{v.sessions === 1 ? '' : 's'}{v.current ? ' · current' : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {data!.programs.length > 0 && <div><p className="mb-1 text-sm font-semibold text-fg-heading">Used in programs</p><ul className="space-y-1 text-sm">{data!.programs.map((p) => <li key={p.id}><Link href={`/coaching/programs/${p.id}`} className="ui-focus rounded text-accent-text hover:underline">{p.name}</Link></li>)}</ul></div>}
            </div>
          </Card>
        )}
      </div>
      {!isNew && <AssignWorkout open={assigning} workoutId={id} name={data!.name} onClose={() => setAssigning(false)} />}
    </Page>
  )
}

function AssignWorkout({ open, workoutId, name, onClose }: { open: boolean; workoutId: string; name: string; onClose: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const debounced = useDebounced(q.trim(), 250)
  const found = useApi<Found[]>(open && debounced.length >= 2 ? `/api/members?pageSize=6&search=${encodeURIComponent(debounced)}` : null)
  const [picked, setPicked] = useState<Found[]>([])
  const [day, setDay] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (open) { setPicked([]); setQ(''); setProblem(null) } }, [open])
  const send = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ assigned: number; alreadyAssigned: number }>(`/api/coaching/workouts/${workoutId}`, { body: { action: 'assign', memberIds: picked.map((p) => p.id), date: day } })
      toast.success(`Assigned to ${r.assigned} member${r.assigned === 1 ? '' : 's'}${r.alreadyAssigned ? `, ${r.alreadyAssigned} already had it` : ''}`)
      onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Assign ${name}`} description="A single workout for one day, outside any program." footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={picked.length === 0} onClick={send}>Assign to {picked.length || ''} member{picked.length === 1 ? '' : 's'}</Button></>}>
      <div className="space-y-3">
        <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <SearchInput value={q} onChange={setQ} placeholder="Search members by name" />
        {debounced.length >= 2 && (
          <ul className="max-h-44 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
            {found.loading ? <li className="px-3 py-2 text-sm text-fg-muted">Searching…</li> : (found.data || []).filter((m) => !picked.some((p) => p.id === m.id)).length === 0 ? <li className="px-3 py-2 text-sm text-fg-muted">No members match.</li> : (found.data || []).filter((m) => !picked.some((p) => p.id === m.id)).map((m) => (
              <li key={m.id}><button type="button" onClick={() => { setPicked([...picked, m]); setQ('') }} className="ui-focus flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle/60"><Avatar name={m.name} size="sm" /><span className="truncate text-sm font-medium text-fg-heading">{m.name}</span></button></li>
            ))}
          </ul>
        )}
        {picked.length > 0 && <ul className="flex flex-wrap gap-2">{picked.map((p) => <li key={p.id}><button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="ui-focus rounded-full border border-line px-2.5 py-1 text-xs text-fg hover:bg-subtle" aria-label={`Remove ${p.name}`}>{p.name} ×</button></li>)}</ul>}
        <FormError message={problem} />
      </div>
    </Modal>
  )
}
