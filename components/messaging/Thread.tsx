'use client'

// One text conversation: the messages both ways, whether this person may be texted, and a reply box.
// Used by the inbox, the member profile and the "Text" button on the quick profile and leads.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Ban, Check, CheckCheck, Clock, MessageSquare, Send } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, ErrorState, Modal, Select, SkeletonRows, Textarea, cn, useToast } from '@/components/ui'

export interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  error: string | null
  errorCode: string | null
  kind: string
  sender: string | null
  at: string
  deliveredAt: string | null
}

export interface ThreadData {
  id: string | null
  phone: string | null
  unreadCount: number
  needsResponse: boolean
  member: { id: string; name: string; phone: string | null; status: string } | null
  lead: { id: string; name: string; phone: string | null } | null
  possibleMembers: { id: string; name: string }[]
  consent: { stopped: boolean; validPhone: boolean; operational: boolean; marketing: boolean; canReply: boolean; reason: string | null }
  messages: ThreadMessage[]
}

export type ThreadSource = { conversationId: string } | { memberId: string } | { leadId: string }

const urlFor = (source: ThreadSource) =>
  'conversationId' in source ? `/api/conversations/${source.conversationId}` : 'memberId' in source ? `/api/members/${source.memberId}/sms` : `/api/leads/${source.leadId}/messages`

/** How a text will be billed and split: 160 characters (153 each when joined), or 70 (67) once it has an emoji or accent outside the basic set. */
export function smsLength(text: string) {
  const basic = /^[\w\s@£$¥èéùìòÇØøÅåÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text)
  const single = basic ? 160 : 70
  const joined = basic ? 153 : 67
  const length = text.length
  return { length, parts: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / joined), basic }
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-key`
}

function Receipt({ message }: { message: ThreadMessage }) {
  const failed = ['failed', 'undelivered'].includes(message.status)
  const blocked = ['skipped', 'expired'].includes(message.status)
  const Icon = failed ? AlertTriangle : blocked ? Ban : message.status === 'delivered' ? CheckCheck : message.status === 'sent' ? Check : Clock
  const label = failed ? 'Not delivered' : blocked ? 'Not sent' : message.status === 'delivered' ? 'Delivered' : message.status === 'sent' ? 'Sent' : 'Sending'
  return (
    <span className={cn('inline-flex items-center gap-1', (failed || blocked) && 'font-medium text-red-600 dark:text-red-400')}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}{(failed || blocked) && message.error ? `: ${message.error}` : ''}
    </span>
  )
}

export function Thread({ source, onChanged, onData, className, autoFocus }: { source: ThreadSource; onChanged?: () => void; /** Told who the thread is with once it has loaded. */ onData?: (data: ThreadData) => void; className?: string; autoFocus?: boolean }) {
  const toast = useToast()
  const { dateTime, can } = useSession()
  const url = urlFor(source)
  const { data, error, loading, reload } = useApi<ThreadData>(`${url}?read=1`)
  const templates = useApi<{ id: string; name: string; channel: string; body: string }[]>(can('communication.text') || can('communication.send') ? '/api/templates' : null)
  const [body, setBody] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One key per composed message: a second click, or a retry after a dropped connection, is the same text.
  const key = useRef(newKey())
  const end = useRef<HTMLDivElement>(null)
  const count = useMemo(() => smsLength(body), [body])
  const smsTemplates = (templates.data || []).filter((t) => t.channel === 'sms')

  // New replies show up without a refresh.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload() }, 10_000)
    return () => clearInterval(timer)
  }, [reload])
  const last = data?.messages[data.messages.length - 1]?.id
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [last])
  useEffect(() => { setBody(''); setProblem(null); key.current = newKey() }, [url])
  const tell = useRef(onData)
  tell.current = onData
  useEffect(() => { if (data) tell.current?.(data) }, [data])

  const send = async () => {
    const text = body.trim()
    if (!text || busy || !data) return
    setBusy(true)
    setProblem(null)
    try {
      const target = data.member ? { url: `/api/members/${data.member.id}/messages`, body: { channel: 'sms', body: text, templateId, clientKey: key.current } }
        : data.id ? { url: `/api/conversations/${data.id}`, body: { action: 'reply', body: text, templateId, clientKey: key.current } }
        : { url: `/api/leads/${data.lead!.id}/messages`, body: { channel: 'sms', body: text, clientKey: key.current } }
      const result = await api<{ status: string; error: string | null }>(target.url, { body: target.body })
      if (['skipped', 'failed'].includes(result.status)) setProblem(`Not sent: ${result.error || 'the message could not be sent'}`)
      else { setBody(''); setTemplateId(null) }
      key.current = newKey()
      reload()
      onChanged?.()
    } catch (err) {
      // Keep the text and the key: pressing Send again cannot produce a second message.
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const link = async (memberId: string) => {
    try {
      await api(`/api/conversations/${data!.id}`, { body: { action: 'link', memberId } })
      toast.success('Conversation attached to the member')
      reload()
      onChanged?.()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  if (loading) return <div className={className}><SkeletonRows rows={4} /></div>
  if (error || !data) return <div className={className}><ErrorState error={error || 'Not found'} onRetry={reload} /></div>

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {!data.member && !data.lead && data.possibleMembers.length > 0 && (
        <div className="border-b border-line bg-subtle/60 px-4 py-2 text-sm text-fg-muted">
          <p>More than one member has this number. Who is this?</p>
          <div className="mt-1 flex flex-wrap gap-2">{data.possibleMembers.map((m) => <Button key={m.id} size="sm" onClick={() => link(m.id)}>{m.name}</Button>)}</div>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {data.messages.length === 0 ? (
          <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 text-center text-sm text-fg-muted">
            <MessageSquare className="h-5 w-5" aria-hidden />
            <p>No texts yet.</p>
          </div>
        ) : data.messages.map((m) => (
          <div key={m.id} className={cn('flex flex-col', m.direction === 'outbound' ? 'items-end' : 'items-start')}>
            <div className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm', m.direction === 'outbound' ? 'rounded-br-md bg-accent text-accent-fg' : 'rounded-bl-md bg-subtle text-fg', ['skipped', 'expired', 'failed', 'undelivered'].includes(m.status) && 'opacity-70')}>
              {m.body}
            </div>
            <p className="mt-1 flex max-w-[85%] flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
              {m.direction === 'outbound' ? <><span>{m.sender}</span><span>{dateTime(m.at)}</span><Receipt message={m} /></> : <span>{dateTime(m.at)}</span>}
            </p>
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="border-t border-line p-3">
        {!data.consent.canReply ? (
          <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted" role="status">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {data.consent.reason}
              {data.member && !data.consent.stopped && data.consent.validPhone && <> You can record their consent on <Link href={`/members/${data.member.id}?tab=details`} className="ui-focus rounded font-medium text-fg-heading underline">their profile</Link>.</>}
            </span>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); send() }} className="space-y-2">
            <Textarea
              rows={2}
              autoFocus={autoFocus}
              value={body}
              maxLength={1600}
              aria-label="Text message"
              placeholder={`Text ${data.member?.name.split(' ')[0] || data.lead?.name.split(' ')[0] || data.phone || ''}`}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            />
            {problem && <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">{problem}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {smsTemplates.length > 0 && (
                <Select aria-label="Use a template" value="" className="h-9 w-auto max-w-[11rem] text-xs" onChange={(e) => { const t = smsTemplates.find((x) => x.id === e.target.value); if (t) { setBody(t.body); setTemplateId(t.id) } }}>
                  <option value="">Template…</option>
                  {smsTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              )}
              <span className={cn('text-xs text-fg-subtle', count.parts > 3 && 'text-amber-600 dark:text-amber-400')}>
                {count.length} character{count.length === 1 ? '' : 's'}{count.parts > 1 ? ` · sent as ${count.parts} texts` : ''}
              </span>
              <Button type="submit" variant="primary" size="sm" className="ml-auto" loading={busy} disabled={!body.trim()} icon={<Send className="h-4 w-4" />}>Send</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/** The conversation in a dialog, for texting someone without leaving the screen you are on. */
export function TextModal({ open, onClose, source, name, onChanged }: { open: boolean; onClose: () => void; source: ThreadSource | null; name: string; onChanged?: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={`Text ${name}`} size="lg">
      {open && source && <Thread source={source} onChanged={onChanged} autoFocus className="-mx-5 -my-4 h-[min(28rem,60vh)] sm:-mx-6" />}
    </Modal>
  )
}

interface ConsentView {
  phone: string | null
  validPhone: boolean
  operational: boolean
  marketing: boolean
  stopped: boolean
  consentAt: string | null
  stoppedAt: string | null
  history: { id: string; scope: string; status: string; source: string; method: string | null; actorName: string | null; createdAt: string }[]
}

const SOURCES: Record<string, string> = { staff: 'Recorded by staff', member_portal: 'Set by the member in the app', keyword: 'Texted by the member', import: 'Imported', website_form: 'Website form', lead_form: 'Enquiry form', carrier: 'Reported by the carrier' }

/** Where a member stands on texts, with the record of how they got there, and (for staff allowed to) a way to change it. */
export function SmsConsent({ memberId, onChanged }: { memberId: string; onChanged?: () => void }) {
  const toast = useToast()
  const { can, dateTime } = useSession()
  const { data, error, loading, reload } = useApi<ConsentView>(`/api/sms/consent?memberId=${memberId}`)
  const [change, setChange] = useState<{ scope: 'operational' | 'marketing'; optedIn: boolean } | null>(null)
  const [method, setMethod] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const canEdit = can('members.manage')

  const save = async () => {
    if (!change) return
    setBusy(true)
    setProblem(null)
    try {
      await api('/api/sms/consent', { body: { memberId, scope: change.scope, optedIn: change.optedIn, method: method.trim() || undefined } })
      toast.success('Text preferences updated')
      setChange(null)
      setMethod('')
      reload()
      onChanged?.()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <SkeletonRows rows={2} />
  if (error || !data) return <ErrorState error={error || 'Not found'} onRetry={reload} />
  const rows = [
    { scope: 'operational' as const, label: 'Reminders and updates', hint: 'Booking confirmations, appointment and waitlist reminders, billing notices, and replies from staff.', on: data.operational },
    { scope: 'marketing' as const, label: 'Offers and news', hint: 'Campaigns and promotional automations. Needs its own agreement.', on: data.marketing },
  ]
  return (
    <div className="space-y-3">
      {data.stopped && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="status">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>They replied STOP{data.stoppedAt ? ` on ${dateTime(data.stoppedAt)}` : ''}. No texts of any kind will be sent. Only they can undo this, by texting START to the gym's number.</span>
        </div>
      )}
      {!data.validPhone && <p className="text-sm text-fg-muted">{data.phone ? `“${data.phone}” is not a number that can be texted.` : 'No mobile number on file.'} Add one before recording consent.</p>}
      <ul className="divide-y divide-line/60 rounded-lg border border-line">
        {rows.map((r) => (
          <li key={r.scope} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg-heading">{r.label}</p>
              <p className="text-xs text-fg-muted">{r.hint}</p>
            </div>
            <span className={cn('shrink-0 text-sm font-medium', r.on ? 'text-emerald-700 dark:text-emerald-400' : 'text-fg-muted')}>{r.on ? 'Agreed' : data.stopped ? 'Stopped' : 'Not agreed'}</span>
            {canEdit && !data.stopped && data.validPhone && <Button size="sm" onClick={() => { setChange({ scope: r.scope, optedIn: !r.on }); setMethod(''); setProblem(null) }}>{r.on ? 'Opt out' : 'Record consent'}</Button>}
          </li>
        ))}
      </ul>
      {data.history.length > 0 && (
        <details className="text-sm">
          <summary className="ui-focus cursor-pointer rounded text-fg-muted">History ({data.history.length})</summary>
          <ul className="mt-2 space-y-1.5 text-xs text-fg-muted">
            {data.history.map((h) => (
              <li key={h.id}>
                <span className="font-medium text-fg">{h.status === 'opted_in' ? 'Opted in' : 'Opted out'}{h.scope === 'all' ? ' (everything)' : h.scope === 'marketing' ? ' (offers and news)' : ' (reminders)'}</span>
                {' · '}{dateTime(h.createdAt)} · {SOURCES[h.source] || h.source}{h.actorName ? ` (${h.actorName})` : ''}{h.method ? ` · ${h.method}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal
        open={!!change}
        onClose={() => setChange(null)}
        title={change?.optedIn ? 'Record consent to texts' : 'Opt out of texts'}
        footer={<><Button onClick={() => setChange(null)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!change?.optedIn && !method.trim()} onClick={save}>{change?.optedIn ? 'Record consent' : 'Opt out'}</Button></>}
      >
        {change && (
          <div className="space-y-3 text-sm">
            <p className="text-fg">
              {change.optedIn
                ? `Only record this if the member has clearly agreed to receive ${change.scope === 'marketing' ? 'offers and news' : 'reminders and updates'} by text. Having their number is not agreement.`
                : change.scope === 'operational' ? 'They will stop getting reminders and updates by text, and offers and news too.' : 'They will stop getting offers and news by text. Reminders are not affected.'}
            </p>
            <label className="block">
              <span className="mb-1 block font-medium text-fg-heading">{change.optedIn ? 'How did they agree?' : 'Note (optional)'}</span>
              <Textarea rows={2} value={method} maxLength={200} onChange={(e) => setMethod(e.target.value)} placeholder={change.optedIn ? 'For example: asked at the front desk on joining' : 'For example: asked by phone'} />
            </label>
            <p className="text-xs text-fg-subtle">This is kept on their record with your name and the time.</p>
            {problem && <p className="font-medium text-red-600 dark:text-red-400" role="alert">{problem}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
