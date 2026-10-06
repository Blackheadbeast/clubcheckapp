'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Plus, SlidersHorizontal, Upload, Users } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { timeAgo } from '@/lib/format'
import { useSession } from '@/components/Session'
import {
  Avatar, Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, FormError, Modal, Page, PageHeader, Pagination,
  SearchInput, Select, SkeletonRows, StatusBadge, Table, Tabs, Td, Th, useToast,
} from '@/components/ui'
import { AddMemberModal } from '@/components/members/MemberForm'
import { ComposeModal } from '@/components/members/ComposeModal'

interface Row {
  id: string
  name: string
  email: string
  phone: string | null
  photoUrl: string | null
  status: string
  createdAt: string
  lastCheckInAt: string | null
  archivedAt: string | null
  tags: { id: string; name: string; color: string }[]
  membership: string | null
  balanceCents: number | null
  assignedStaff: { id: string; name: string } | null
}

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trial', label: 'Trial' },
  { key: 'past_due', label: 'Past due' },
  { key: 'frozen', label: 'Frozen' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'archived', label: 'Archived' },
] as const

type SortKey = 'name' | 'status' | 'createdAt' | 'lastCheckInAt'

function MembersDirectory() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { can, money, date, locationId } = useSession()
  const lookups = useLookups()

  const status = params.get('status') || 'all'
  const [search, setSearch] = useState(params.get('search') || '')
  const [planId, setPlanId] = useState(params.get('planId') || '')
  const [tagId, setTagId] = useState(params.get('tagId') || '')
  const [attendance, setAttendance] = useState('')
  const [payment, setPayment] = useState('')
  const [coachId, setCoachId] = useState('')
  const [joinedFrom, setJoinedFrom] = useState('')
  const [sort, setSort] = useState<SortKey>('createdAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const debouncedSearch = useDebounced(search)

  const filters = { status, search: debouncedSearch, planId, tagId, attendance, payment, coachId, joinedFrom, locationId, sort, order }
  const filterKey = JSON.stringify(filters)
  useEffect(() => setPage(1), [filterKey])

  const { data, meta, error, loading, refreshing, reload } = useApi<Row[]>(`/api/members${qs({ ...filters, page })}`)
  const counts = (meta?.counts || {}) as Record<string, number>
  const activeFilters = [planId, tagId, attendance, payment, coachId, joinedFrom].filter(Boolean).length

  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => setSelected(new Set()), [filterKey, page])
  const rows = data || []
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [composing, setComposing] = useState(false)
  const [bulk, setBulk] = useState<null | { action: 'archive' | 'restore' | 'delete' | 'tag' | 'untag' | 'assign_coach' }>(null)
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const setStatus = (key: string) => router.replace(`/members${qs({ status: key })}`)
  const sortBy = (key: SortKey) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc')
    else {
      setSort(key)
      setOrder(key === 'name' ? 'asc' : 'desc')
    }
  }
  const arrow = (key: SortKey) => (sort === key ? (order === 'asc' ? ' ↑' : ' ↓') : '')

  const runBulk = async () => {
    if (!bulk) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      const result = await api<{ affected: number }>('/api/members/bulk', {
        body: {
          action: bulk.action,
          ids: Array.from(selected),
          ...(bulk.action === 'tag' || bulk.action === 'untag' ? { tagId: bulkValue } : {}),
          ...(bulk.action === 'assign_coach' ? { staffId: bulkValue || null } : {}),
        },
      })
      toast.success(`Updated ${result.affected} member${result.affected === 1 ? '' : 's'}`)
      setBulk(null)
      setBulkValue('')
      setSelected(new Set())
      reload()
    } catch (err) {
      setBulkError((err as ClientError).message)
    } finally {
      setBulkBusy(false)
    }
  }

  const tabs = useMemo(() => STATUS_TABS.map((t) => ({ ...t, count: counts[t.key] ?? (meta ? 0 : null) })).filter((t) => !['inactive', 'archived'].includes(t.key) || t.count || status === t.key), [counts, meta, status])

  return (
    <Page>
      <PageHeader
        title="Members"
        description={meta ? `${(counts.all || 0).toLocaleString()} members, ${(counts.active || 0).toLocaleString()} active` : undefined}
        actions={
          <>
            {can('members.delete') && (
              <>
                <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>Import</Button>
                <a href={`/api/members/export${qs(filters)}`}>
                  <Button icon={<Download className="h-4 w-4" />}>Export</Button>
                </a>
              </>
            )}
            {can('members.manage') && (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add member</Button>
            )}
          </>
        }
      />

      <Tabs tabs={tabs} value={status as (typeof STATUS_TABS)[number]['key']} onChange={setStatus} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or phone" className="min-w-[14rem] flex-1 sm:max-w-sm" />
        <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
        {activeFilters > 0 && (
          <Button variant="ghost" onClick={() => { setPlanId(''); setTagId(''); setAttendance(''); setPayment(''); setCoachId(''); setJoinedFrom('') }}>Clear</Button>
        )}
      </div>

      {showFilters && (
        <Card className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-medium text-fg-muted">Membership
            <Select className="mt-1" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Any</option>
              <option value="none">No membership</option>
              {lookups.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
          <label className="text-xs font-medium text-fg-muted">Tag
            <Select className="mt-1" value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Any</option>
              {lookups.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>
          <label className="text-xs font-medium text-fg-muted">Attendance
            <Select className="mt-1" value={attendance} onChange={(e) => setAttendance(e.target.value)}>
              <option value="">Any</option>
              <option value="week">Visited this week</option>
              <option value="inactive14">No visit in 14+ days</option>
              <option value="inactive30">No visit in 30+ days</option>
              <option value="never">Never visited</option>
            </Select>
          </label>
          {can('billing.view') && (
            <label className="text-xs font-medium text-fg-muted">Payment
              <Select className="mt-1" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="">Any</option>
                <option value="balance">Has a balance</option>
                <option value="overdue">Overdue</option>
              </Select>
            </label>
          )}
          <label className="text-xs font-medium text-fg-muted">Coach
            <Select className="mt-1" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
              <option value="">Any</option>
              {lookups.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
          <label className="text-xs font-medium text-fg-muted">Joined on or after
            <input type="date" className="ui-input mt-1 h-9" value={joinedFrom} onChange={(e) => setJoinedFrom(e.target.value)} />
          </label>
        </Card>
      )}

      {selected.size > 0 && (
        <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-surface px-3 py-2 shadow-pop">
          <span className="mr-1 text-sm font-medium text-fg-heading">{selected.size} selected</span>
          {can('communication.send') && <Button size="sm" onClick={() => setComposing(true)}>Message</Button>}
          <Button size="sm" onClick={() => setBulk({ action: 'tag' })}>Add tag</Button>
          <Button size="sm" onClick={() => setBulk({ action: 'untag' })}>Remove tag</Button>
          <Button size="sm" onClick={() => setBulk({ action: 'assign_coach' })}>Assign coach</Button>
          {can('members.delete') && (
            <>
              <Button size="sm" onClick={() => setBulk({ action: status === 'archived' ? 'restore' : 'archive' })}>{status === 'archived' ? 'Restore' : 'Archive'}</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setBulk({ action: 'delete' })}>Delete</Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Card padded={false} className={refreshing ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
        {loading ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={debouncedSearch || activeFilters || status !== 'all' ? 'No members match these filters' : 'No members yet'}
            description={debouncedSearch || activeFilters || status !== 'all' ? 'Try a different search or clear the filters.' : 'Add your first member, or import a list from a spreadsheet.'}
            action={!debouncedSearch && !activeFilters && status === 'all' && can('members.manage') ? <Button variant="primary" onClick={() => setAdding(true)}>Add member</Button> : undefined}
          />
        ) : (
          <>
            {/* Phones: a tappable list instead of a squeezed table */}
            <ul className="divide-y divide-line/60 sm:hidden">
              {rows.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <Checkbox aria-label={`Select ${m.name}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                  <Link href={`/members/${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={m.name} src={m.photoUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg-heading">{m.name}</span>
                      <span className="block truncate text-xs text-fg-muted">{m.membership || 'No membership'} · {m.lastCheckInAt ? timeAgo(m.lastCheckInAt) : 'No visits'}</span>
                    </span>
                    <StatusBadge status={m.archivedAt ? 'archived' : m.status} />
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block">
              <thead>
                <tr>
                  <Th className="w-8">
                    <Checkbox aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </Th>
                  <Th><button type="button" className="ui-focus rounded" onClick={() => sortBy('name')}>Member{arrow('name')}</button></Th>
                  <Th><button type="button" className="ui-focus rounded" onClick={() => sortBy('status')}>Status{arrow('status')}</button></Th>
                  <Th>Membership</Th>
                  <Th>Tags</Th>
                  <Th><button type="button" className="ui-focus rounded" onClick={() => sortBy('lastCheckInAt')}>Last visit{arrow('lastCheckInAt')}</button></Th>
                  <Th><button type="button" className="ui-focus rounded" onClick={() => sortBy('createdAt')}>Joined{arrow('createdAt')}</button></Th>
                  {can('billing.view') && <Th align="right">Balance</Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="group hover:bg-subtle/50">
                    <Td><Checkbox aria-label={`Select ${m.name}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} /></Td>
                    <Td>
                      <Link href={`/members/${m.id}`} className="ui-focus flex items-center gap-3 rounded">
                        <Avatar name={m.name} src={m.photoUrl} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg-heading group-hover:underline">{m.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{m.email}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td><StatusBadge status={m.archivedAt ? 'archived' : m.status} /></Td>
                    <Td className="text-fg-muted">{m.membership || '—'}</Td>
                    <Td>
                      <div className="flex max-w-[14rem] flex-wrap gap-1">
                        {m.tags.slice(0, 3).map((t) => <Badge key={t.id}><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />{t.name}</Badge>)}
                        {m.tags.length > 3 && <Badge>+{m.tags.length - 3}</Badge>}
                      </div>
                    </Td>
                    <Td className="text-fg-muted">{timeAgo(m.lastCheckInAt)}</Td>
                    <Td className="text-fg-muted">{date(m.createdAt)}</Td>
                    {can('billing.view') && <Td align="right" className={m.balanceCents ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-subtle'}>{m.balanceCents ? money(m.balanceCents) : '—'}</Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="members" />}
          </>
        )}
      </Card>

      <AddMemberModal open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); router.push(`/members/${id}`) }} />
      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={reload} />
      <ComposeModal open={composing} onClose={() => setComposing(false)} audience={{ type: 'members', ids: Array.from(selected) }} label={`${selected.size} selected member${selected.size === 1 ? '' : 's'}`} onSent={() => setSelected(new Set())} />

      <ConfirmModal
        open={!!bulk}
        onClose={() => { setBulk(null); setBulkError(null); setBulkValue('') }}
        onConfirm={runBulk}
        loading={bulkBusy}
        error={bulkError}
        danger={bulk?.action === 'delete'}
        title={bulk ? { archive: 'Archive members', restore: 'Restore members', delete: 'Delete members permanently', tag: 'Add a tag', untag: 'Remove a tag', assign_coach: 'Assign a coach' }[bulk.action] : ''}
        confirmLabel={bulk?.action === 'delete' ? `Delete ${selected.size}` : 'Apply'}
      >
        {bulk?.action === 'delete' && <p>This permanently removes {selected.size} member{selected.size === 1 ? '' : 's'} with their check-ins, bookings and memberships. Payment records are kept. Archiving is usually the better choice.</p>}
        {bulk?.action === 'archive' && <p>Archived members are hidden from the directory, can't check in or book, and can be restored at any time.</p>}
        {bulk?.action === 'restore' && <p>Restore {selected.size} member{selected.size === 1 ? '' : 's'} to the directory.</p>}
        {(bulk?.action === 'tag' || bulk?.action === 'untag') && (
          lookups.tags.length === 0 ? <p>No tags yet. Create one from any member's profile.</p> : (
            <Select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Tag">
              <option value="">Choose a tag…</option>
              {lookups.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )
        )}
        {bulk?.action === 'assign_coach' && (
          <Select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Coach">
            <option value="">No coach</option>
            {lookups.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
      </ConfirmModal>
    </Page>
  )
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ message?: string; errors?: string[] } | null>(null)

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/members/import', { method: 'POST', body: form, credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Import failed')
      setResult(json)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { setResult(null); setFile(null); setError(null); onClose() }}
      title="Import members"
      description="Upload a CSV with the columns name, email and (optionally) phone."
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={!file}>Import</Button></>}
    >
      <div className="space-y-3">
        {!result && <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-fg file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg" />}
        <FormError message={error} />
        {result && (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-fg-heading">{result.message}</p>
            {result.errors && result.errors.length > 0 && (
              <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-fg-muted">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function MembersPage() {
  return (
    <Suspense>
      <MembersDirectory />
    </Suspense>
  )
}
