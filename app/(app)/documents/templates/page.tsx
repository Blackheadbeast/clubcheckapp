'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, FileText } from 'lucide-react'
import { useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Page, PageHeader, SearchInput, SkeletonRows } from '@/components/ui'
import { typeLabel } from '@/components/documents/DocumentDetail'

interface Template { id: string; name: string; description: string | null; type: string; status: string; version: number | null; hasDraft: boolean; versions: number; requiredFor: string[]; signed: number; waiting: number; validForDays: number | null; updatedAt: string }
const TRIGGERS: Record<string, string> = { member_signup: 'new members', membership_purchase: 'memberships', class_booking: 'classes', appointment_booking: 'appointments' }

export default function TemplatesPage() {
  const { can, date } = useSession()
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const debounced = useDebounced(search.trim(), 250)
  const { data, error, loading, reload } = useApi<Template[]>(`/api/documents/templates?search=${encodeURIComponent(debounced)}${archived ? '&archived=1' : ''}`)
  const manage = can('documents.manage')
  return (
    <Page>
      <PageHeader back={<Link href="/documents" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Documents</Link>} title="Document templates" description="The waivers, agreements and forms you send. A published version never changes; editing it starts the next version."
        actions={manage ? <Link href="/documents/templates/new"><Button variant="primary">New template</Button></Link> : undefined} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 p-4 sm:px-5"><div className="min-w-0 flex-1 basis-56"><SearchInput value={search} onChange={setSearch} placeholder="Search templates" /></div><Checkbox checked={archived} onChange={() => setArchived((v) => !v)} label="Archived" /></div>
        {loading ? <SkeletonRows rows={5} /> : error || !data ? <ErrorState error={error || 'Could not load templates'} onRetry={reload} /> : data.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title={debounced || archived ? 'Nothing matches' : 'No templates yet'} description={debounced || archived ? undefined : 'Start with your liability waiver or membership agreement.'} action={manage && !debounced && !archived ? <Link href="/documents/templates/new"><Button variant="primary">Create your first template</Button></Link> : undefined} />
        ) : (
          <ul className="divide-y divide-line/60 border-t border-line" aria-label="Templates">
            {data.map((t) => (
              <li key={t.id}>
                <Link href={`/documents/templates/${t.id}`} className="ui-focus flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-subtle/60 sm:px-5">
                  <span className="min-w-0 flex-1 basis-64"><span className="block truncate text-sm font-medium text-fg-heading">{t.name}</span><span className="block truncate text-xs text-fg-muted">{typeLabel(t.type)}{t.requiredFor.length ? ` · required for ${t.requiredFor.map((r) => TRIGGERS[r] || r).join(', ')}` : ''}{t.validForDays ? ` · valid ${t.validForDays} days` : ''}</span></span>
                  <span className="w-40 shrink-0 text-xs text-fg-muted">{t.signed} signed · {t.waiting} waiting</span>
                  <span className="w-28 shrink-0 text-xs text-fg-muted">Updated {date(t.updatedAt)}</span>
                  <span className="flex shrink-0 items-center gap-1.5">{t.status === 'published' ? <Badge tone="green">Published v{t.version}</Badge> : t.status === 'archived' ? <Badge>Archived</Badge> : <Badge tone="amber">Draft</Badge>}{t.hasDraft && t.status === 'published' && <Badge tone="amber">Unpublished changes</Badge>}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  )
}
