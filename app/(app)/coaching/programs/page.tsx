'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarRange, Plus } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { DIFFICULTIES } from '@/lib/workouts/content'
import { useSession } from '@/components/Session'
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, SearchInput, Select, SkeletonRows, Table, Td, Textarea, Th, useToast } from '@/components/ui'
import { titleCase } from '@/components/coaching/shared'

interface Row { id: string; name: string; description: string | null; goals: string | null; difficulty: string; audience: string | null; weeks: number; trainingDays: number; createdByName: string | null; activeMembers: number; completedMembers: number; archived: boolean }

export default function ProgramsPage() {
  const router = useRouter()
  const toast = useToast()
  const { can } = useSession()
  const manage = can('workouts.manage')
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useApi<Row[]>(`/api/coaching/programs${qs({ search: debounced, archived: archived ? '1' : '', pageSize: 100 })}`)
  const [creating, setCreating] = useState(false)
  const [f, setF] = useState({ name: '', description: '', goals: '', audience: '', difficulty: 'intermediate', weeks: 4 })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (creating) { setF({ name: '', description: '', goals: '', audience: '', difficulty: 'intermediate', weeks: 4 }); setProblem(null) } }, [creating])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const made = await api<{ id: string }>('/api/coaching/programs', { body: f })
      toast.success('Program created. Now add its training days.')
      router.push(`/coaching/programs/${made.id}`)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Programs" description="Weeks of training built from your workouts, assigned to members." actions={manage ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New program</Button> : undefined} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search programs" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Checkbox checked={archived} onChange={(e) => setArchived(e.target.checked)} label="Archived" />
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={5} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<CalendarRange className="h-5 w-5" />} title={debounced ? 'No programs match' : archived ? 'No archived programs' : 'No programs yet'} description={debounced || archived ? undefined : 'A program is a set of weeks, each with training days that point at your workouts.'} action={manage && !archived ? <Button variant="primary" onClick={() => setCreating(true)}>Create a program</Button> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Program</Th><Th>Length</Th><Th>Level</Th><Th align="right">Members on it</Th><Th align="right">Finished</Th><Th>Built by</Th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => router.push(`/coaching/programs/${p.id}`)}>
                  <Td className="max-w-[22rem]"><Link href={`/coaching/programs/${p.id}`} onClick={(e) => e.stopPropagation()} className="ui-focus block truncate rounded font-medium text-fg-heading hover:underline">{p.name}</Link>{(p.goals || p.audience) && <span className="block truncate text-xs text-fg-muted">{[p.goals, p.audience].filter(Boolean).join(' · ')}</span>}</Td>
                  <Td className="text-fg-muted">{p.weeks} week{p.weeks === 1 ? '' : 's'} · {p.trainingDays} training day{p.trainingDays === 1 ? '' : 's'}</Td>
                  <Td className="text-fg-muted">{titleCase(p.difficulty)}</Td>
                  <Td align="right">{p.activeMembers}</Td>
                  <Td align="right">{p.completedMembers}</Td>
                  <Td className="text-fg-muted">{p.createdByName || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New program" footer={<><Button onClick={() => setCreating(false)} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="program" loading={busy}>Create program</Button></>}>
        <form id="program" onSubmit={create} className="grid gap-4 sm:grid-cols-2">
          <Field label="Program name" required className="sm:col-span-2"><Input value={f.name} required maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="8 Week Strength" /></Field>
          <Field label="Weeks" required><Input type="number" min={1} max={52} required value={f.weeks} onChange={(e) => setF({ ...f, weeks: Number(e.target.value) })} /></Field>
          <Field label="Difficulty"><Select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{DIFFICULTIES.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}</Select></Field>
          <Field label="Goals" className="sm:col-span-2"><Input value={f.goals} maxLength={500} onChange={(e) => setF({ ...f, goals: e.target.value })} placeholder="Build squat, bench and deadlift strength" /></Field>
          <Field label="Who it is for" className="sm:col-span-2"><Input value={f.audience} maxLength={200} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="Members with six months of lifting behind them" /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>
    </Page>
  )
}
