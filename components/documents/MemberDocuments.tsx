'use client'

// The Documents tab of a member's profile: what they still have to sign, and everything they have
// been sent before.

import { useState } from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, EmptyState, ErrorState, Select, SkeletonRows, useToast } from '@/components/ui'
import { DocStatus, DocumentDetail, typeLabel } from './DocumentDetail'

interface Row { id: string; name: string; type: string; version: number; status: string; assignedAt: string; signedAt: string | null; signBy: string | null; validUntil: string | null; lastActivityAt: string; source: string }
interface Data { documents: Row[]; templates: { id: string; name: string; type: string }[]; can: { send: boolean; download: boolean; manage: boolean } }

export function MemberDocuments({ memberId }: { memberId: string }) {
  const toast = useToast()
  const { date } = useSession()
  const { data, error, loading, reload } = useApi<Data>(`/api/members/${memberId}/documents`)
  const [open, setOpen] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (again = false) => {
    if (!templateId) return
    setBusy(true)
    try {
      const r = await api<{ sent: number; alreadyHad: number }>(`/api/documents/templates/${templateId}`, { body: { action: 'send', memberIds: [memberId], again } })
      toast.success(r.sent ? 'Document sent' : 'They already have this document')
      setTemplateId('')
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Card padded={false}><SkeletonRows rows={4} /></Card>
  if (error || !data) return <Card><ErrorState error={error || 'Could not load documents'} onRetry={reload} /></Card>
  const waiting = data.documents.filter((d) => ['sent', 'viewed', 'partially_completed'].includes(d.status))
  const rest = data.documents.filter((d) => !waiting.includes(d))
  const hasSigned = (id: string) => data.documents.some((d) => d.status === 'signed' && data.templates.find((t) => t.id === id)?.name === d.name)
  const row = (d: Row) => (
    <li key={d.id}>
      <button type="button" onClick={() => setOpen(d.id)} className="ui-focus flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-subtle/60 sm:px-5">
        <span className="min-w-0 flex-1 basis-56"><span className="block truncate text-sm font-medium text-fg-heading">{d.name}</span><span className="block truncate text-xs text-fg-muted">{typeLabel(d.type)} · v{d.version} · {d.status === 'signed' && d.signedAt ? `signed ${date(d.signedAt)}${d.validUntil ? `, valid until ${date(d.validUntil)}` : ''}` : `sent ${date(d.assignedAt)}${d.signBy ? `, sign by ${date(d.signBy)}` : ''}`}</span></span>
        <DocStatus status={d.status} />
      </button>
    </li>
  )
  return (
    <div className="space-y-5">
      {data.can.send && (
        <Card>
          <CardHeader title="Send a document" description="They are emailed a link to sign, and it appears in their member app." />
          {data.templates.length === 0 ? <p className="mt-3 text-sm text-fg-muted">No published templates yet. <Link href="/documents/templates" className="text-accent-text underline">Create one</Link>.</p> : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Select aria-label="Document to send" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="min-w-0 flex-1 basis-56"><option value="">Choose a document…</option>{data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
              <Button variant="primary" loading={busy} disabled={!templateId} onClick={() => send(false)}>Send</Button>
              {templateId && hasSigned(templateId) && <Button loading={busy} onClick={() => send(true)}>Ask them to sign again</Button>}
            </div>
          )}
        </Card>
      )}
      <Card padded={false}>
        <CardHeader title="Waiting for signature" className="px-4 pt-4 sm:px-5" />
        {waiting.length === 0 ? <p className="px-4 pb-4 text-sm text-fg-muted sm:px-5">Nothing waiting.</p> : <ul className="divide-y divide-line/60 border-t border-line" aria-label="Waiting for signature">{waiting.map(row)}</ul>}
      </Card>
      <Card padded={false}>
        <CardHeader title="History" description="Signed, expired, declined and voided documents. Signed records are never changed." className="px-4 pt-4 sm:px-5" />
        {rest.length === 0 ? <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents yet" description="Waivers and agreements sent to this member appear here with who signed and when." /> : <ul className="divide-y divide-line/60 border-t border-line" aria-label="Document history">{rest.map(row)}</ul>}
      </Card>
      <DocumentDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  )
}
