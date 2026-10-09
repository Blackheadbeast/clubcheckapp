'use client'

// Documents in the member app: what needs signing, what has been signed, and the signing screen.

import { useState } from 'react'
import { ChevronLeft, ChevronRight, FileSignature, FileText } from 'lucide-react'
import { useApi } from '@/lib/client'
import { DOCUMENT_TYPES, type DocumentType } from '@/lib/documents/content'
import { SignDocument } from '@/components/documents/SignDocument'
import { Card, EmptyState, ErrorState, Skeleton, cn } from '@/components/ui'

interface Row { id: string; name: string; type: string; version: number; status: string; assignedAt: string; signedAt: string | null; declinedAt: string | null; expiredAt: string | null; signBy: string | null; validUntil: string | null; hasSignedCopy: boolean }
interface Center { actionRequired: Row[]; signed: Row[]; expired: Row[]; declined: Row[]; voided: Row[] }
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')
const typeLabel = (type: string) => DOCUMENT_TYPES[type as DocumentType] || 'Document'

/** On the home screen: a nudge when something is waiting to be signed. Shows nothing otherwise. */
export function DocumentsBanner({ base, onOpen }: { base: string; onOpen: () => void }) {
  const { data } = useApi<Center>(`${base}/documents`)
  const n = data?.actionRequired.length || 0
  if (!n) return null
  return (
    <button type="button" onClick={onOpen} className="ui-focus flex w-full items-center gap-3 rounded-xl border border-accent/60 bg-accent/10 p-3 text-left">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg"><FileSignature className="h-5 w-5" aria-hidden /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">{n === 1 ? `Please sign: ${data!.actionRequired[0].name}` : `${n} documents need your signature`}</span><span className="block text-xs text-fg-muted">It takes a couple of minutes.</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
    </button>
  )
}

/** On the profile screen: the way in to the document centre. */
export function DocumentsLink({ base, onOpen }: { base: string; onOpen: () => void }) {
  const { data } = useApi<Center>(`${base}/documents`)
  const waiting = data?.actionRequired.length || 0
  return (
    <button type="button" onClick={onOpen} className="ui-focus flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left shadow-card">
      <FileText className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg-heading">Documents</span><span className="block text-xs text-fg-muted">{waiting ? `${waiting} waiting for your signature` : 'Waivers and agreements you have signed'}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
    </button>
  )
}

export function DocumentsTab({ base, onBack }: { base: string; onBack: () => void }) {
  const { data, error, loading, reload } = useApi<Center>(`${base}/documents`)
  const [open, setOpen] = useState<string | null>(null)
  const back = (label: string, fn: () => void) => <button type="button" onClick={fn} className="ui-focus -ml-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-fg-muted"><ChevronLeft className="h-4 w-4" aria-hidden />{label}</button>

  if (open) {
    return (
      <>
        {back('Documents', () => { setOpen(null); reload(); window.scrollTo(0, 0) })}
        <SignDocument url={`${base}/documents/${open}`} closeLabel="Back to documents" onClose={() => { setOpen(null); reload(); window.scrollTo(0, 0) }} />
      </>
    )
  }
  const section = (title: string, rows: Row[], line: (d: Row) => string, action: string | null, tone: string) => rows.length > 0 && (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold text-fg-heading">{title}</h2>
      <Card padded={false}>
        <ul className="divide-y divide-line/60">
          {rows.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => { setOpen(d.id); window.scrollTo(0, 0) }} className="ui-focus flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold leading-snug text-fg-heading">{d.name}</span><span className="block truncate text-xs text-fg-muted">{typeLabel(d.type)}</span><span className={cn('mt-0.5 block text-xs font-medium', tone)}>{line(d)}</span></span>
                {action && <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">{action}</span>}
                <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
  return (
    <>
      {back('Profile', onBack)}
      <h1 className="text-xl font-semibold tracking-tight text-fg-heading">Documents</h1>
      {loading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div> : error || !data ? <Card><ErrorState error={error || 'Could not load your documents'} onRetry={reload} /></Card>
        : data.actionRequired.length + data.signed.length + data.expired.length + data.declined.length + data.voided.length === 0 ? <Card><EmptyState icon={<FileText className="h-5 w-5" />} title="No documents" description="Waivers and agreements from your gym appear here to read, sign and download." /></Card> : (
          <>
            {section('Action required', data.actionRequired, (d) => `Action required${d.signBy ? ` · sign by ${day(d.signBy)}` : ''}`, 'Review and sign', 'text-amber-700 dark:text-amber-400')}
            {section('Signed', data.signed, (d) => `Signed — ${day(d.signedAt)}${d.validUntil ? ` · valid until ${day(d.validUntil)}` : ''}`, null, 'text-emerald-700 dark:text-emerald-400')}
            {section('Expired', data.expired, (d) => (d.signedAt ? `Signed ${day(d.signedAt)} · expired ${day(d.expiredAt)}` : `Not signed in time · expired ${day(d.expiredAt)}`), null, 'text-fg-muted')}
            {section('Declined', data.declined, (d) => `Declined — ${day(d.declinedAt)}`, null, 'text-fg-muted')}
            {section('Withdrawn by the gym', data.voided, (d) => `Signed ${day(d.signedAt)} · no longer in effect`, null, 'text-fg-muted')}
          </>
        )}
    </>
  )
}
