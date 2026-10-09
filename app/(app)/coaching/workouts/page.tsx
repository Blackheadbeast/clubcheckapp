'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardList, Plus } from 'lucide-react'
import { qs, useApi, useDebounced } from '@/lib/client'
import { BLOCK_LABELS, WORKOUT_TYPES, type BlockType } from '@/lib/workouts/content'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Page, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Table, Td, Th } from '@/components/ui'
import { titleCase } from '@/components/coaching/shared'

interface Row { id: string; name: string; type: string; difficulty: string; estimatedMinutes: number | null; version: number; description: string | null; blocks: BlockType[]; exercises: number; createdByName: string | null; archived: boolean; timesCompleted: number; canEdit: boolean }

export default function WorkoutsPage() {
  const router = useRouter()
  const { can } = useSession()
  const manage = can('workouts.manage')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)
  useEffect(() => setPage(1), [debounced, type, archived])
  const { data, meta, error, loading, reload } = useApi<Row[]>(`/api/coaching/workouts${qs({ search: debounced, type, archived: archived ? '1' : '', page, pageSize: 25 })}`)
  return (
    <Page>
      <PageHeader title="Workouts" description="Reusable workouts. Put them in programs, attach them to classes, or assign one for a day." actions={manage ? <Link href="/coaching/workouts/new"><Button variant="primary" icon={<Plus className="h-4 w-4" />}>New workout</Button></Link> : undefined} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search workouts" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-auto"><option value="">All types</option>{WORKOUT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>
        <Checkbox checked={archived} onChange={(e) => setArchived(e.target.checked)} label="Archived" />
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={6} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={debounced || type ? 'No workouts match' : archived ? 'No archived workouts' : 'No workouts yet'} description={debounced || type || archived ? undefined : 'Build a workout once, then reuse it in programs and classes.'} action={manage && !archived ? <Link href="/coaching/workouts/new"><Button variant="primary">Build your first workout</Button></Link> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Workout</Th><Th>Type</Th><Th>Structure</Th><Th align="right">Exercises</Th><Th align="right">Minutes</Th><Th align="right">Times completed</Th><Th>Built by</Th></tr></thead>
              <tbody>
                {data.map((w) => (
                  <tr key={w.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => router.push(`/coaching/workouts/${w.id}`)}>
                    <Td className="max-w-[20rem]"><Link href={`/coaching/workouts/${w.id}`} onClick={(e) => e.stopPropagation()} className="ui-focus block truncate rounded font-medium text-fg-heading hover:underline">{w.name}</Link>{w.description && <span className="block truncate text-xs text-fg-muted">{w.description}</span>}</Td>
                    <Td className="text-fg-muted">{titleCase(w.type)} · {titleCase(w.difficulty)}</Td>
                    <Td><span className="flex flex-wrap gap-1">{Array.from(new Set(w.blocks)).map((b) => <Badge key={b}>{BLOCK_LABELS[b]}</Badge>)}</span></Td>
                    <Td align="right">{w.exercises}</Td>
                    <Td align="right">{w.estimatedMinutes ?? '—'}</Td>
                    <Td align="right">{w.timesCompleted}</Td>
                    <Td className="text-fg-muted">{w.createdByName || '—'}{w.version > 1 ? ` · v${w.version}` : ''}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="workouts" />}
          </>
        )}
      </Card>
    </Page>
  )
}
