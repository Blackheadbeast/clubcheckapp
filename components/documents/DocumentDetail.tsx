'use client'

// One member's document, for staff: where it has got to, its audit trail, and what can be done
// with it. The wording and the signature are in the PDF, which needs its own permission.

import { useState } from 'react'
import Link from 'next/link'
import { Download, RefreshCw } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { DOCUMENT_TYPES, STATUS_LABELS, type DocumentStatus, type DocumentType } from '@/lib/documents/content'
import { Badge, Button, ErrorState, Field, FormError, Modal, SkeletonRows, Textarea, useToast } from '@/components/ui'

export const STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'neutral' | 'blue'> = { draft: 'neutral', sent: 'blue', viewed: 'blue', partially_completed: 'amber', signed: 'green', declined: 'red', expired: 'amber', voided: 'neutral' }
export const DocStatus = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] || 'neutral'}>{STATUS_LABELS[status as DocumentStatus] || status}</Badge>
export const typeLabel = (type: string) => DOCUMENT_TYPES[type as DocumentType] || 'Document'

const EVENT_LABELS: Record<string, string> = {
  assigned: 'Assigned', sent: 'Sent', resent: 'Sent again', viewed: 'Opened', fields_saved: 'Answers saved', signature_started: 'Started signing', consent_given: 'Agreed to sign electronically',
  signed: 'Signed', declined: 'Declined', voided: 'Voided', expired: 'Expired', reminded: 'Reminder sent', downloaded: 'Signed copy downloaded',
}

interface Detail {
  id: string; name: string; type: string; version: number; status: string; source: string; assignedByName: string | null
  assignedAt: string; sentAt: string | null; viewedAt: string | null; signedAt: string | null; signBy: string | null; validUntil: string | null; lastActivityAt: string
  member: { id: string; name: string; email: string }; signerName: string | null; signatureMethod: string | null; snapshotHash: string | null; hasSignedCopy: boolean
  declineReason: string | null; voidReason: string | null; voidedByName: string | null
  canDownload: boolean; canSend: boolean; canManage: boolean
  events: { id: string; type: string; at: string; actorType: string; actorName: string | null; ip: string | null; userAgent: string | null; metadata: Record<string, unknown> | null }[]
}

export function DocumentDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast()
  const { dateTime, date } = useSession()
  const { data, error, loading, reload } = useApi<Detail>(id ? `/api/documents/${id}` : null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const close = () => { setVoiding(false); setReason(''); setProblem(null); onClose() }

  const act = async (action: 'resend' | 'void') => {
    setBusy(action)
    setProblem(null)
    try {
      const r = await api<{ resent?: boolean }>(`/api/documents/${id}`, { body: action === 'void' ? { action, reason } : { action } })
      toast.success(action === 'void' ? 'Document voided' : r.resent === false ? 'Already sent a moment ago' : 'Sent again')
      setVoiding(false); setReason('')
      reload(); onChanged?.()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const open = data && ['sent', 'viewed', 'partially_completed'].includes(data.status)

  return (
    <Modal open={!!id} onClose={close} size="lg" title={data ? data.name : 'Document'} description={data ? `${typeLabel(data.type)} · version ${data.version}` : undefined} footer={<Button onClick={close}>Close</Button>}>
      {loading ? <SkeletonRows rows={6} /> : error || !data ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <DocStatus status={data.status} />
            <Link href={`/members/${data.member.id}?tab=documents`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{data.member.name}</Link>
            <span className="text-fg-muted">{data.member.email}</span>
          </div>
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <div><dt className="text-xs text-fg-muted">Assigned</dt><dd className="text-fg">{dateTime(data.assignedAt)}{data.assignedByName ? ` by ${data.assignedByName}` : ''}</dd></div>
            <div><dt className="text-xs text-fg-muted">Last sent</dt><dd className="text-fg">{data.sentAt ? dateTime(data.sentAt) : 'Not sent'}</dd></div>
            <div><dt className="text-xs text-fg-muted">Opened</dt><dd className="text-fg">{data.viewedAt ? dateTime(data.viewedAt) : 'Not yet'}</dd></div>
            <div><dt className="text-xs text-fg-muted">Signed</dt><dd className="text-fg">{data.signedAt ? `${dateTime(data.signedAt)}${data.signerName ? ` by ${data.signerName}` : ''}${data.signatureMethod ? ` (${data.signatureMethod === 'drawn' ? 'drawn' : data.signatureMethod === 'typed' ? 'typed' : 'accepted'})` : ''}` : 'Not signed'}</dd></div>
            {data.signBy && <div><dt className="text-xs text-fg-muted">Sign by</dt><dd className="text-fg">{date(data.signBy)}</dd></div>}
            {data.validUntil && <div><dt className="text-xs text-fg-muted">Valid until</dt><dd className="text-fg">{date(data.validUntil)}</dd></div>}
            {data.declineReason && <div className="sm:col-span-2"><dt className="text-xs text-fg-muted">Reason for declining</dt><dd className="text-fg">{data.declineReason}</dd></div>}
            {data.voidReason && <div className="sm:col-span-2"><dt className="text-xs text-fg-muted">Voided{data.voidedByName ? ` by ${data.voidedByName}` : ''}</dt><dd className="text-fg">{data.voidReason}</dd></div>}
            {data.snapshotHash && <div className="sm:col-span-2"><dt className="text-xs text-fg-muted">Record fingerprint</dt><dd className="break-all font-mono text-xs text-fg-muted">{data.snapshotHash}</dd></div>}
          </dl>

          <div className="flex flex-wrap gap-2">
            {data.hasSignedCopy && data.canDownload && <a href={`/api/documents/${data.id}/pdf`} className="ui-focus inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3.5 text-sm font-medium text-fg hover:bg-subtle"><Download className="h-4 w-4" aria-hidden />Download signed PDF</a>}
            {data.hasSignedCopy && !data.canDownload && <span className="text-xs text-fg-muted">Your role can see that this was signed, but not open the document.</span>}
            {open && data.canSend && <Button loading={busy === 'resend'} icon={<RefreshCw className="h-4 w-4" />} onClick={() => act('resend')}>Send again</Button>}
            {data.status !== 'voided' && data.canManage && !voiding && <Button variant="ghost" className="text-red-600" onClick={() => setVoiding(true)}>Void</Button>}
          </div>
          {problem && <FormError message={problem} />}
          {voiding && (
            <div className="space-y-3 rounded-lg border border-line bg-subtle/60 p-3">
              <p className="font-medium text-fg-heading">Void this document?</p>
              <p className="text-fg-muted">{data.hasSignedCopy ? 'It will no longer count as signed. The signed record and this history are kept; nothing is deleted.' : 'It can no longer be signed. This history is kept.'}</p>
              <Field label="Reason" required><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sent to the wrong member" /></Field>
              <div className="flex gap-2"><Button variant="danger" loading={busy === 'void'} disabled={reason.trim().length < 3} onClick={() => act('void')}>Void document</Button><Button onClick={() => setVoiding(false)}>Cancel</Button></div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Audit trail</p>
            <ol className="divide-y divide-line/60 rounded-lg border border-line" aria-label="Audit trail">
              {data.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="font-medium text-fg-heading">{EVENT_LABELS[e.type] || e.type}</span>
                  <span className="text-xs text-fg-muted">{dateTime(e.at)} · {e.actorName || (e.actorType === 'system' ? 'System' : e.actorType)}{e.metadata?.via ? ` · ${String(e.metadata.via)}` : ''}{e.ip ? ` · ${e.ip}` : ''}</span>
                  {typeof e.metadata?.reason === 'string' && e.metadata.reason && <span className="basis-full text-xs text-fg-muted">Reason: {e.metadata.reason}</span>}
                </li>
              ))}
            </ol>
            <p className="mt-1 text-xs text-fg-subtle">This record is added to as things happen and cannot be edited.</p>
          </div>
        </div>
      )}
    </Modal>
  )
}
