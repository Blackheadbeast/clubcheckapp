'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Megaphone, Plus } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { LEAD_STAGES } from '@/lib/format'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, Select, SkeletonRows, StatusBadge, Table, Td, Textarea, Th, useToast } from '@/components/ui'

interface Stats { sent: number; delivered: number; opened: number; clicked: number; failed: number; skipped: number }
interface Campaign { id: string; name: string; channel: string; subject: string | null; body: string; status: string; recipientCount: number; sentAt: string | null; createdAt: string; createdByName: string | null; audienceLabel: string; stats: Stats }
interface Detail extends Campaign { messages: { id: string; status: string; error: string | null; toAddress: string | null; member: { name: string } | null; prospect: { name: string } | null }[] }
interface Template { id: string; name: string; channel: string; subject: string | null; body: string }

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')

function Campaigns() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { date } = useSession()
  const lookups = useLookups()
  const { data, error, loading, reload } = useApi<Campaign[]>('/api/campaigns')
  const { data: templates } = useApi<Template[]>('/api/templates')
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [openId, setOpenId] = useState<string | null>(null)
  const detail = useApi<Detail>(openId ? `/api/campaigns/${openId}` : null)

  const [f, setF] = useState({ name: '', channel: 'email', subject: '', body: '', segment: 'status:active', value: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { if (creating) { setF({ name: '', channel: 'email', subject: '', body: '', segment: 'status:active', value: '' }); setProblem(null); setConfirm(false) } }, [creating])

  const audience = useMemo(() => {
    const [type, arg] = f.segment.split(':')
    if (type === 'all') return { type: 'all_members' }
    if (type === 'status') return { type: 'status', status: arg }
    if (type === 'inactive') return { type: 'inactive', days: Number(arg) }
    if (type === 'leads') return arg ? { type: 'leads', stage: arg } : { type: 'leads' }
    if (!f.value) return null
    if (type === 'plan') return { type: 'plan', planId: f.value }
    if (type === 'tag') return { type: 'tag', tagId: f.value }
    if (type === 'class') return { type: 'class_type', classTypeId: f.value }
    if (type === 'coach') return { type: 'coach', staffId: f.value }
    return null
  }, [f.segment, f.value])
  const audienceKey = useDebounced(audience ? JSON.stringify(audience) : '', 200)
  const preview = useApi<{ count: number }>(creating && audienceKey ? `/api/campaigns?count=${encodeURIComponent(audienceKey)}` : null)
  const needsValue = ['plan', 'tag', 'class', 'coach'].includes(f.segment.split(':')[0])
  const options = { plan: lookups.plans, tag: lookups.tags, class: lookups.classTypes, coach: lookups.coaches }[f.segment.split(':')[0] as 'plan'] || []

  const send = async (sendNow: boolean) => {
    if (!audience) return setProblem('Choose who should receive this.')
    setBusy(true)
    setProblem(null)
    try {
      const result = await api<{ sent?: number; skipped?: number; failed?: number }>('/api/campaigns', { body: { name: f.name || f.subject || 'Untitled campaign', channel: f.channel, subject: f.channel === 'email' ? f.subject : null, body: f.body, audience, send: sendNow } })
      if (!sendNow) toast.success('Draft saved')
      else if ((result.sent || 0) > 0) toast.success(`Sent to ${result.sent}${(result.skipped || 0) + (result.failed || 0) ? ` · ${(result.skipped || 0) + (result.failed || 0)} not delivered` : ''}`)
      else toast.error(`Nothing was delivered: ${result.skipped || 0} skipped, ${result.failed || 0} failed. Open the campaign to see why.`)
      setCreating(false)
      if (params.get('new')) router.replace('/communication/campaigns')
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }
  const sendDraft = async (id: string) => {
    setBusy(true)
    try {
      const result = await api<{ sent: number; recipients: number }>(`/api/campaigns/${id}`, { body: { action: 'send' } })
      toast.success(`Sent to ${result.sent} of ${result.recipients}`)
      reload()
      detail.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Campaigns" description="One message to a whole segment of members or leads." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New campaign</Button>} />
      <Card padded={false}>
        {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<Megaphone className="h-5 w-5" />} title="No campaigns yet" description="Announce a schedule change, promote an offer, or win back members who've stopped coming." action={<Button variant="primary" onClick={() => setCreating(true)}>New campaign</Button>} />
        ) : (
          <Table>
            <thead><tr><Th>Campaign</Th><Th>Audience</Th><Th>Status</Th><Th align="right">Recipients</Th><Th align="right">Delivered</Th><Th align="right">Opened</Th><Th align="right">Clicked</Th><Th align="right">Failed</Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpenId(c.id)}>
                  <Td><button type="button" className="ui-focus rounded text-left"><span className="block font-medium text-fg-heading">{c.name}</span><span className="block text-xs text-fg-muted">{c.channel === 'sms' ? 'SMS' : 'Email'} · {c.sentAt ? `sent ${date(c.sentAt)}` : `created ${date(c.createdAt)}`}{c.createdByName ? ` by ${c.createdByName}` : ''}</span></button></Td>
                  <Td className="capitalize text-fg-muted">{c.audienceLabel}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td align="right">{c.status === 'draft' ? '—' : c.recipientCount}</Td>
                  <Td align="right">{c.status === 'draft' ? '—' : `${c.stats.sent} (${pct(c.stats.sent, c.recipientCount)})`}</Td>
                  <Td align="right">{c.status === 'draft' ? '—' : pct(c.stats.opened, c.stats.sent)}</Td>
                  <Td align="right">{c.status === 'draft' ? '—' : pct(c.stats.clicked, c.stats.sent)}</Td>
                  <Td align="right" className={c.stats.failed ? 'text-red-600 dark:text-red-400' : ''}>{c.status === 'draft' ? '—' : c.stats.failed}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={creating}
        onClose={() => { setCreating(false); if (params.get('new')) router.replace('/communication/campaigns') }}
        size="lg"
        title="New campaign"
        footer={confirm
          ? <><Button onClick={() => setConfirm(false)} disabled={busy}>Back</Button><Button variant="primary" loading={busy} onClick={() => send(true)}>Send to {preview.data?.count ?? 0} now</Button></>
          : <><Button onClick={() => send(false)} disabled={busy || !f.body}>Save draft</Button><Button variant="primary" disabled={!f.body || !audience || (f.channel === 'email' && !f.subject)} onClick={() => setConfirm(true)}>Review & send</Button></>}
      >
        {confirm ? (
          <div className="space-y-3 text-sm">
            <p className="text-fg">You're about to send this {f.channel === 'sms' ? 'text' : 'email'} to <strong>{preview.data?.count ?? 0} {f.segment.startsWith('leads') ? 'leads' : 'members'}</strong>. This can't be undone.</p>
            <p className="text-fg-muted">People who have opted out, or have no {f.channel === 'sms' ? 'mobile number' : 'email address'}, are skipped automatically.</p>
            <div className="rounded-lg border border-line p-3">{f.channel === 'email' && <p className="font-medium text-fg-heading">{f.subject}</p>}<p className="mt-1 whitespace-pre-wrap text-fg-muted">{f.body}</p></div>
            <FormError message={problem} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send to">
              <Select value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value, value: '' })}>
                <optgroup label="Members">
                  <option value="all">All members</option><option value="status:active">Active members</option><option value="status:trial">Trial members</option><option value="status:past_due">Past-due members</option><option value="status:frozen">Frozen members</option><option value="status:cancelled">Cancelled members</option>
                  <option value="inactive:14">No visit in 14+ days</option><option value="inactive:30">No visit in 30+ days</option>
                  <option value="plan">On a membership plan…</option><option value="tag">With a tag…</option><option value="class">Who attend a class…</option><option value="coach">Of a coach…</option>
                </optgroup>
                <optgroup label="Leads"><option value="leads">All open leads</option>{LEAD_STAGES.filter((s) => !['converted'].includes(s.key)).map((s) => <option key={s.key} value={`leads:${s.key}`}>Leads: {s.label}</option>)}</optgroup>
              </Select>
            </Field>
            {needsValue ? (
              <Field label="Which one"><Select value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })}><option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
            ) : <div className="hidden sm:block" />}
            <p className="text-sm text-fg-muted sm:col-span-2" aria-live="polite">{audience ? (preview.loading ? 'Counting…' : `${preview.data?.count ?? 0} ${f.segment.startsWith('leads') ? 'lead' : 'member'}${preview.data?.count === 1 ? '' : 's'} match this audience.`) : 'Choose an option to see how many people this reaches.'}</p>
            <Field label="Channel"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="email">Email</option><option value="sms">Text message (SMS)</option></Select></Field>
            <Field label="Start from a template"><Select value="" onChange={(e) => { const t = templates?.find((x) => x.id === e.target.value); if (t) setF({ ...f, channel: t.channel, subject: t.subject || '', body: t.body, name: f.name || t.name }) }}><option value="">{templates?.length ? 'Choose…' : 'No templates yet'}</option>{templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label="Campaign name" hint="Only you see this." className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} placeholder="October schedule change" /></Field>
            {f.channel === 'email' && <Field label="Subject" required className="sm:col-span-2"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} /></Field>}
            <Field label="Message" required hint="Personalise with {{first_name}}, {{gym_name}} and {{portal_link}}." className="sm:col-span-2"><Textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={f.channel === 'sms' ? 480 : 5000} /></Field>
            <div className="sm:col-span-2"><FormError message={problem} /></div>
          </div>
        )}
      </Modal>

      <Modal open={!!openId} onClose={() => setOpenId(null)} size="lg" title={detail.data?.name || 'Campaign'} description={detail.data ? `${detail.data.channel === 'sms' ? 'SMS' : 'Email'} · ${detail.data.status}` : undefined} footer={detail.data?.status === 'draft' ? <Button variant="primary" loading={busy} onClick={() => sendDraft(detail.data!.id)}>Send now</Button> : undefined}>
        {detail.loading ? <SkeletonRows rows={4} /> : detail.error || !detail.data ? <ErrorState error={detail.error || 'Not found'} onRetry={detail.reload} /> : (
          <div className="space-y-4">
            {detail.data.status !== 'draft' && (
              <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {(['sent', 'delivered', 'opened', 'clicked', 'failed', 'skipped'] as const).map((k) => <div key={k} className="rounded-lg border border-line p-2"><dd className="tabular text-lg font-semibold text-fg-heading">{detail.data!.stats[k]}</dd><dt className="text-xs capitalize text-fg-muted">{k}</dt></div>)}
              </dl>
            )}
            <div className="rounded-lg border border-line p-3 text-sm">{detail.data.subject && <p className="font-medium text-fg-heading">{detail.data.subject}</p>}<p className="mt-1 whitespace-pre-wrap text-fg-muted">{detail.data.body}</p></div>
            {detail.data.messages.length > 0 && (
              <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line text-sm">
                {detail.data.messages.map((m) => <li key={m.id} className="flex items-center gap-3 px-3 py-1.5"><span className="min-w-0 flex-1 truncate">{m.member?.name || m.prospect?.name || m.toAddress}</span>{m.error && <span className="truncate text-xs text-fg-subtle">{m.error}</span>}<StatusBadge status={m.status} /></li>)}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </Page>
  )
}

export default function CampaignsPage() {
  return <Suspense><Campaigns /></Suspense>
}
