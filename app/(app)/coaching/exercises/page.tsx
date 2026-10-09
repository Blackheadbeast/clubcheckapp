'use client'

import { useEffect, useState } from 'react'
import { Dumbbell, Plus } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { DIFFICULTIES, MEASURES } from '@/lib/workouts/content'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Table, Td, Textarea, Th, useToast } from '@/components/ui'
import { titleCase } from '@/components/coaching/shared'

interface Exercise {
  id: string; name: string; description: string | null; instructions: string | null; category: string; movementPattern: string | null; primaryMuscle: string | null
  secondaryMuscles: string[]; equipment: string[]; difficulty: string; measure: string; videoUrl: string | null; imageUrl: string | null; coachNotes: string | null; isActive: boolean; system: boolean
}
const MEASURE_LABELS: Record<string, string> = { weight_reps: 'Weight and reps', reps: 'Reps only', time: 'Time', distance: 'Distance' }
const blank = { name: '', description: '', instructions: '', category: '', movementPattern: '', primaryMuscle: '', secondaryMuscles: '', equipment: '', difficulty: 'intermediate', measure: 'weight_reps', videoUrl: '', imageUrl: '', coachNotes: '', isActive: true }

export default function ExercisesPage() {
  const toast = useToast()
  const { can } = useSession()
  const manage = can('workouts.manage')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [scope, setScope] = useState('')
  const [inactive, setInactive] = useState(false)
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  useEffect(() => setPage(1), [debounced, category, scope, inactive])
  const { data, meta, error, loading, reload } = useApi<Exercise[]>(`/api/coaching/exercises${qs({ search: debounced, category, scope, inactive: inactive ? '1' : '', page, pageSize: 25 })}`)
  const categories = ((meta?.categories || []) as { category: string; count: number }[])
  const suggested = ((meta?.suggestedCategories || []) as string[])
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null)
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const readOnly = editing !== 'new' && !!editing && (editing.system || !manage)

  useEffect(() => {
    if (!editing) return
    setProblem(null)
    setF(editing === 'new' ? blank : {
      name: editing.name, description: editing.description || '', instructions: editing.instructions || '', category: editing.category, movementPattern: editing.movementPattern || '', primaryMuscle: editing.primaryMuscle || '',
      secondaryMuscles: editing.secondaryMuscles.join(', '), equipment: editing.equipment.join(', '), difficulty: editing.difficulty, measure: editing.measure, videoUrl: editing.videoUrl || '', imageUrl: editing.imageUrl || '', coachNotes: editing.coachNotes || '', isActive: editing.isActive,
    })
  }, [editing])

  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const body = { ...f, secondaryMuscles: list(f.secondaryMuscles), equipment: list(f.equipment), videoUrl: f.videoUrl || null, imageUrl: f.imageUrl || null }
      if (editing === 'new') await api('/api/coaching/exercises', { body })
      else await api(`/api/coaching/exercises/${(editing as Exercise).id}`, { method: 'PATCH', body })
      toast.success(editing === 'new' ? 'Exercise added' : 'Exercise saved')
      setEditing(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try { await fn(); toast.success(done); setEditing(null); reload() } catch (err) { setProblem((err as ClientError).message) } finally { setBusy(false) }
  }

  return (
    <Page>
      <PageHeader title="Exercise library" description="Built-in movements plus your gym's own. Workouts are built from these." actions={manage ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New exercise</Button> : undefined} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search exercises" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto"><option value="">All categories</option>{categories.map((c) => <option key={c.category} value={c.category}>{titleCase(c.category)} ({c.count})</option>)}</Select>
        <Select aria-label="Source" value={scope} onChange={(e) => setScope(e.target.value)} className="w-auto"><option value="">Built-in and yours</option><option value="gym">Your gym&apos;s only</option><option value="system">Built-in only</option></Select>
        <Checkbox checked={inactive} onChange={(e) => setInactive(e.target.checked)} label="Show retired" />
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<Dumbbell className="h-5 w-5" />} title={debounced || category ? 'No exercises match' : 'No exercises yet'} description={debounced || category ? 'Try a different search or category.' : undefined} action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>New exercise</Button> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Exercise</Th><Th>Category</Th><Th>Primary muscle</Th><Th>Equipment</Th><Th>Difficulty</Th><Th>Logged as</Th></tr></thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setEditing(e)}>
                    <Td><button type="button" className="ui-focus rounded text-left font-medium text-fg-heading">{e.name}</button>{!e.system && <Badge tone="blue" className="ml-2">Yours</Badge>}{!e.isActive && <Badge className="ml-2">Retired</Badge>}</Td>
                    <Td className="text-fg-muted">{titleCase(e.category)}</Td>
                    <Td className="text-fg-muted">{e.primaryMuscle || '—'}</Td>
                    <Td className="max-w-[14rem] truncate text-fg-muted">{e.equipment.join(', ') || 'None'}</Td>
                    <Td className="text-fg-muted">{titleCase(e.difficulty)}</Td>
                    <Td className="text-fg-muted">{MEASURE_LABELS[e.measure]}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="exercises" />}
          </>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing === 'new' ? 'New exercise' : editing?.name || 'Exercise'}
        description={editing && editing !== 'new' && editing.system ? 'Built in. Make a copy to change it for your gym.' : undefined}
        footer={
          <>
            {manage && editing && editing !== 'new' && <Button className="mr-auto" loading={busy} onClick={() => act(() => api(`/api/coaching/exercises/${(editing as Exercise).id}`, { body: { action: 'copy' } }), 'Copied to your library')}>Make a copy</Button>}
            {manage && editing && editing !== 'new' && !editing.system && editing.isActive && <Button variant="ghost" className="text-red-600" loading={busy} onClick={() => act(() => api(`/api/coaching/exercises/${(editing as Exercise).id}`, { method: 'DELETE' }), 'Exercise retired')}>Retire</Button>}
            <Button onClick={() => setEditing(null)}>{readOnly ? 'Close' : 'Cancel'}</Button>
            {!readOnly && <Button variant="primary" type="submit" form="exercise" loading={busy}>Save</Button>}
          </>
        }
      >
        <form id="exercise" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          {problem && <div className="sm:col-span-2"><FormError message={problem} /></div>}
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} disabled={readOnly} required maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Category" required hint="Pick one or type your own.">
            <Input value={f.category} disabled={readOnly} required maxLength={40} list="exercise-categories" onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="squat, hinge, push…" />
            <datalist id="exercise-categories">{Array.from(new Set([...suggested, ...categories.map((c) => c.category)])).map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Movement pattern"><Input value={f.movementPattern} disabled={readOnly} maxLength={60} onChange={(e) => setF({ ...f, movementPattern: e.target.value })} placeholder="Hip hinge, vertical pull…" /></Field>
          <Field label="Primary muscle group"><Input value={f.primaryMuscle} disabled={readOnly} maxLength={60} onChange={(e) => setF({ ...f, primaryMuscle: e.target.value })} /></Field>
          <Field label="Secondary muscles" hint="Separate with commas"><Input value={f.secondaryMuscles} disabled={readOnly} onChange={(e) => setF({ ...f, secondaryMuscles: e.target.value })} /></Field>
          <Field label="Equipment" hint="Separate with commas"><Input value={f.equipment} disabled={readOnly} onChange={(e) => setF({ ...f, equipment: e.target.value })} placeholder="barbell, rack" /></Field>
          <Field label="Difficulty"><Select value={f.difficulty} disabled={readOnly} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{DIFFICULTIES.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}</Select></Field>
          <Field label="Logged as" hint="What a set of this is measured in. It decides which personal records apply."><Select value={f.measure} disabled={readOnly} onChange={(e) => setF({ ...f, measure: e.target.value })}>{MEASURES.map((m) => <option key={m} value={m}>{MEASURE_LABELS[m]}</option>)}</Select></Field>
          <Field label="Video link"><Input type="url" value={f.videoUrl} disabled={readOnly} maxLength={500} onChange={(e) => setF({ ...f, videoUrl: e.target.value })} placeholder="https://" /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description} disabled={readOnly} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Instructions for members" className="sm:col-span-2"><Textarea rows={3} value={f.instructions} disabled={readOnly} maxLength={4000} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
          <Field label="Image link"><Input type="url" value={f.imageUrl} disabled={readOnly} maxLength={500} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} placeholder="https://" /></Field>
          {!(editing && editing !== 'new' && editing.system) && <Field label="Coach notes (staff only)" className="sm:col-span-2" hint="Never shown to members."><Textarea rows={2} value={f.coachNotes} disabled={readOnly} maxLength={2000} onChange={(e) => setF({ ...f, coachNotes: e.target.value })} /></Field>}
          {editing !== 'new' && editing && !editing.system && !readOnly && <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Available for new workouts" />}
        </form>
      </Modal>
    </Page>
  )
}
