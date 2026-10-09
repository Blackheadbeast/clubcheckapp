'use client'

// Documents: everything that has been sent to members for signature, and where each one has got to.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { ClientError } from '@/lib/client'
import { useSession } from '@/components/Session'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, STATUS_LABELS } from '@/lib/documents/content'
import { Button, Card, EmptyState, ErrorState, Page, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Stat } from '@/components/ui'
import { DocStatus, DocumentDetail, typeLabel } from '@/components/documents/DocumentDetail'

interface Row { id: string; name: string; type: string; version: number; status: string; assignedAt: string; signedAt: string | null; signBy: string | null; validUntil: string | null; lastActivityAt: string; member: { id: string; name: string; email: string; archived: boolean } }
interface Result { data: Row[]; meta: { page: number; totalPages: number; total: number; counts: Record<string, number> } }

export default function DocumentsPage() {
  const { can, date, dateTime } = useSession()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [signed, setSigned] = useState('')
  const [expiring, setExpiring] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Result | null>(null)
  const [error, setError] = useState<ClientError | null>(null)
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t) }, [search])
  useEffect(() => { setPage(1) }, [debounced, status, type, signed, expiring])
  useEffect(() => {
    let live = true
    setError(null)
    const q = new URLSearchParams({ page: String(page), ...(debounced && { search: debounced }), ...(status && { status }), ...(type && { type }), ...(signed && { signed }), ...(expiring && { expiringDays: '30' }) })
    fetch(`/api/documents?${q}`, { credentials: 'same-origin' })
      .then(async (res) => { const json = await res.json(); if (!res.ok) throw new ClientError(json?.error || 'Could not load documents', res.status); if (live) setRows(json) })
      .catch((err) => { if (live) setError(err instanceof ClientError ? err : new ClientError('Could not load documents', 0)) })
    return () => { live = false }
  }, [page, debounced, status, type, signed, expiring, tick])
  const reload = () => setTick((t) => t + 1)

  if (!can('documents.view')) return <Page width="narrow"><PageHeader title="Documents" /><Card><EmptyState icon={<FileText className="h-5 w-5" />} title="Not available for your role" description="Documents are handled by the front desk, sales and management." /></Card></Page>
  const counts = rows?.meta.counts || {}
  const waiting = (counts.sent || 0) + (counts.viewed || 0) + (counts.partially_completed || 0)
  const filtered = !!(debounced || status || type || signed || expiring)
  return (
    <Page>
      <PageHeader title="Documents" description="Waivers, agreements and forms sent to members, and whether they have been signed." actions={<Link href="/documents/templates"><Button variant={can('documents.manage') ? 'primary' : 'secondary'}>Templates</Button></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for signature" value={String(waiting)} />
        <Stat label="Signed" value={String(counts.signed || 0)} />
        <Stat label="Declined" value={String(counts.declined || 0)} />
        <Stat label="Expired" value={String(counts.expired || 0)} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 p-4 sm:px-5">
          <div className="min-w-0 flex-1 basis-56"><SearchInput value={search} onChange={setSearch} placeholder="Search by member or document" /></div>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">Any status</option>{DOCUMENT_STATUSES.filter((s) => s !== 'draft').map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>
          <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-52"><option value="">Any type</option>{Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Signed or not" value={expiring ? 'expiring' : signed} onChange={(e) => { setExpiring(e.target.value === 'expiring'); setSigned(e.target.value === 'expiring' ? '' : e.target.value) }} className="w-48"><option value="">Signed or not</option><option value="yes">Signed</option><option value="no">Not signed</option><option value="expiring">Expiring in 30 days</option></Select>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : !rows ? <SkeletonRows rows={6} /> : rows.data.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title={filtered ? 'Nothing matches' : 'No documents sent yet'} description={filtered ? 'Try different filters.' : 'Create a template, publish it, and send it to a member. It will show here.'} action={!filtered ? <Link href="/documents/templates"><Button variant="primary">Go to templates</Button></Link> : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-line/60 border-t border-line" aria-label="Documents">
              {rows.data.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setOpen(d.id)} className="ui-focus flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-subtle/60 sm:px-5">
                    <span className="min-w-0 flex-1 basis-56"><span className="block truncate text-sm font-medium text-fg-heading">{d.member.name}{d.member.archived ? ' (archived)' : ''}</span><span className="block truncate text-xs text-fg-muted">{d.member.email}</span></span>
                    <span className="min-w-0 flex-1 basis-56"><span className="block truncate text-sm text-fg">{d.name}</span><span className="block truncate text-xs text-fg-muted">{typeLabel(d.type)} · v{d.version}</span></span>
                    <span className="w-44 shrink-0 text-xs text-fg-muted">{d.status === 'signed' && d.signedAt ? `Signed ${date(d.signedAt)}${d.validUntil ? ` · until ${date(d.validUntil)}` : ''}` : `Last activity ${dateTime(d.lastActivityAt)}`}</span>
                    <DocStatus status={d.status} />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={rows.meta.page} totalPages={rows.meta.totalPages} total={rows.meta.total} onPage={setPage} noun="documents" />
          </>
        )}
      </Card>
      <DocumentDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </Page>
  )
}
