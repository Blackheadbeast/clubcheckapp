'use client'

// Settings → Developer: API keys for outside software, and webhooks that tell it what happened.
// A key or a signing secret is shown exactly once, in the dialog that follows making it; nothing
// on this page can bring one back.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw, Send, Webhook } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, Pagination, Select, SkeletonRows, Tabs, cn, useToast } from '@/components/ui'

interface ApiKey { id: string; name: string; description: string | null; prefix: string; scopes: string[]; createdByName: string | null; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; revokedByName: string | null; status: 'active' | 'revoked' | 'expired' }
interface ScopeInfo { key: string; label: string; allowed: boolean }
interface KeysData { keys: ApiKey[]; scopes: ScopeInfo[]; limits: { perKeyPerMinute: number; perGymPerMinute: number } }
interface Endpoint { id: string; url: string; description: string | null; isActive: boolean; secretHint: string; events: string[]; createdByName: string | null; createdAt: string; disabledAt: string | null; disabledReason: string | null; lastWeek: { succeeded: number; pending: number; failed: number; dead: number } }
interface HooksData { endpoints: Endpoint[]; events: { type: string; description: string }[]; retries: { attempts: number; afterSeconds: number[] } }
interface Delivery { id: string; status: string; attempts: number; lastStatusCode: number | null; lastError: string | null; lastAttemptAt: string | null; nextAttemptAt: string | null; deliveredAt: string | null; createdAt: string; event: { id: string; type: string; createdAt: string; payload?: unknown }; endpoint: { id: string; url: string }; tries?: { attempt: number; statusCode: number | null; error: string | null; response: string | null; durationMs: number; manual: boolean; at: string }[] }
interface RequestRow { requestId: string; method: string; path: string; status: number; errorCode: string | null; durationMs: number; at: string; key: { id: string; name: string; prefix: string } | null }
interface Paged<T> { data: T[]; meta: { page: number; totalPages: number; total: number } }

type Tab = 'keys' | 'webhooks' | 'deliveries' | 'requests'
const TONE: Record<string, 'green' | 'red' | 'amber' | 'neutral' | 'blue'> = { active: 'green', revoked: 'red', expired: 'amber', succeeded: 'green', pending: 'blue', failed: 'amber', dead: 'red' }
const LABEL: Record<string, string> = { active: 'Active', revoked: 'Revoked', expired: 'Expired', succeeded: 'Delivered', pending: 'Waiting', failed: 'Retrying', dead: 'Failed' }
const resourceOf = (key: string) => key.split(/[:.]/)[0]
const titled = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

export default function DeveloperSettingsPage() {
  const { can } = useSession()
  const [tab, setTab] = useState<Tab>('keys')
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  if (!can('developer.manage')) {
    return <Page width="narrow"><PageHeader title="Developer" /><Card><EmptyState icon={<KeyRound className="h-5 w-5" />} title="Not available for your role" description="API keys and webhooks are managed by the owner, admins and managers." /></Card></Page>
  }
  return (
    <Page>
      <PageHeader title="Developer" description="Connect other software to this gym: API keys let it read and change data, webhooks tell it when something happens." />
      <Card className="mb-5">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-fg-muted">Base URL</dt><dd className="min-w-0 break-all font-mono text-fg-heading">{origin}/api/v1</dd>
          <dt className="text-fg-muted">Authentication</dt><dd className="min-w-0 break-words font-mono text-fg-heading">Authorization: Bearer &lt;API key&gt;</dd>
          <dt className="text-fg-muted">Reference</dt><dd className="text-fg">docs/PUBLIC-API.md and docs/openapi.yaml in the ClubCheck repository.</dd>
        </dl>
      </Card>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'keys', label: 'API keys' }, { key: 'webhooks', label: 'Webhooks' }, { key: 'deliveries', label: 'Deliveries' }, { key: 'requests', label: 'Request log' }]} />
      {tab === 'keys' && <Keys />}
      {tab === 'webhooks' && <Webhooks onSeeDeliveries={() => setTab('deliveries')} />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'requests' && <Requests />}
    </Page>
  )
}

/** Something secret, shown once, with a copy button. Closing the dialog forgets it. */
function RevealOnce({ open, title, label, value, note, onClose }: { open: boolean; title: string; label: string; value: string; note: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!open) setCopied(false) }, [open])
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<Button variant="primary" onClick={onClose}>I have saved it</Button>}>
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-fg dark:border-amber-800/50 dark:bg-amber-950/30"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden /><span>{note}</span></p>
        <div>
          <p className="mb-1 text-xs font-medium text-fg-muted">{label}</p>
          <div className="flex items-stretch gap-2">
            <code data-testid="secret-value" className="min-w-0 flex-1 select-all break-all rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-xs text-fg-heading">{value}</code>
            <Button onClick={copy} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} aria-label={`Copy ${label.toLowerCase()}`}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

function Keys() {
  const toast = useToast()
  const { dateTime, date } = useSession()
  const { data, error, loading, reload } = useApi<KeysData>('/api/developer/keys')
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null)
  const [viewing, setViewing] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const revoke = async () => {
    if (!revoking) return
    setBusy(true)
    setProblem(null)
    try {
      await api(`/api/developer/keys/${revoking.id}`, { method: 'DELETE' })
      toast.success('API key revoked')
      setRevoking(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader title="API keys" description={data ? `Each key works for this gym only. Limit: ${data.limits.perKeyPerMinute} requests a minute per key, ${data.limits.perGymPerMinute} for the gym.` : undefined} className="px-4 pt-4 sm:px-5" action={<Button variant="primary" onClick={() => setCreating(true)}>Create API key</Button>} />
        {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error || 'Could not load API keys'} onRetry={reload} /> : data.keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No API keys yet" description="Create one for each piece of software that connects, with only the access it needs." action={<Button variant="primary" onClick={() => setCreating(true)}>Create API key</Button>} />
        ) : (
          <ul className="divide-y divide-line/60 border-t border-line" aria-label="API keys">
            {data.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1 basis-[16rem]">
                  <p className="flex flex-wrap items-center gap-2"><span className="break-words text-sm font-semibold text-fg-heading">{k.name}</span><Badge tone={TONE[k.status]}>{LABEL[k.status]}</Badge></p>
                  <p className="mt-0.5 font-mono text-xs text-fg-muted">{k.prefix}…</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {k.scopes.length} scope{k.scopes.length === 1 ? '' : 's'} · created {date(k.createdAt)}{k.createdByName ? ` by ${k.createdByName}` : ''} · {k.lastUsedAt ? `last used ${dateTime(k.lastUsedAt)}` : 'never used'}
                    {k.status === 'revoked' && k.revokedAt ? ` · revoked ${date(k.revokedAt)}` : k.expiresAt ? ` · ${k.status === 'expired' ? 'expired' : 'expires'} ${date(k.expiresAt)}` : ''}
                  </p>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => setViewing(k)}>View scopes</Button>
                  {k.status === 'active' && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setProblem(null); setRevoking(k) }}>Revoke</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && <CreateKey open={creating} scopes={data.scopes} onClose={() => setCreating(false)} onCreated={(made) => { setCreating(false); setRevealed(made); reload() }} />}
      <RevealOnce open={!!revealed} title={`API key created${revealed ? `: ${revealed.name}` : ''}`} label="API key" value={revealed?.key || ''} note="Copy this key now and keep it somewhere safe. It is not stored here and cannot be shown again. If it is lost, revoke it and create another." onClose={() => setRevealed(null)} />
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name || 'API key'} description={viewing ? `${viewing.prefix}… · ${LABEL[viewing.status]}` : undefined} footer={<Button onClick={() => setViewing(null)}>Close</Button>}>
        {viewing && data && (
          <div className="space-y-3 text-sm">
            {viewing.description && <p className="text-fg">{viewing.description}</p>}
            <ul className="divide-y divide-line/60 rounded-lg border border-line">
              {viewing.scopes.map((s) => <li key={s} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2"><code className="font-mono text-xs text-fg-heading">{s}</code><span className="text-xs text-fg-muted">{data.scopes.find((x) => x.key === s)?.label}</span></li>)}
            </ul>
            <p className="text-xs text-fg-muted">A key&apos;s scopes cannot be changed. To change access, create a new key and revoke this one.</p>
          </div>
        )}
      </Modal>
      <ConfirmModal open={!!revoking} onClose={() => setRevoking(null)} onConfirm={revoke} title="Revoke this API key?" confirmLabel="Revoke key" danger loading={busy} error={problem}>
        <p className="text-sm text-fg-muted">{revoking?.name} ({revoking?.prefix}…) stops working immediately. Anything still using it will get an error. This cannot be undone.</p>
      </ConfirmModal>
    </>
  )
}

function CreateKey({ open, scopes, onClose, onCreated }: { open: boolean; scopes: ScopeInfo[]; onClose: () => void; onCreated: (made: { name: string; key: string }) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expires, setExpires] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (open) { setName(''); setDescription(''); setExpires(''); setChosen([]); setProblem(null) } }, [open])
  const groups = useMemo(() => Array.from(new Set(scopes.map((s) => resourceOf(s.key)))).map((resource) => ({ resource, scopes: scopes.filter((s) => resourceOf(s.key) === resource) })), [scopes])
  const toggle = (key: string) => setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const made = await api<{ name: string; key: string }>('/api/developer/keys', { body: { name, description: description || null, scopes: chosen, expiresInDays: expires ? Number(expires) : null } })
      onCreated({ name: made.name, key: made.key })
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Create API key" description="Give it only the access the software needs. The key is shown once, after you create it."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="api-key" loading={busy} disabled={!name.trim() || chosen.length === 0}>Create key</Button></>}>
      <form id="api-key" onSubmit={save} className="space-y-4">
        {problem && <FormError message={problem} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required hint="What uses it, e.g. Website lead form."><Input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Expires"><Select value={expires} onChange={(e) => setExpires(e.target.value)}><option value="">Never (until revoked)</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option></Select></Field>
        </div>
        <Field label="Description (optional)"><Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-heading">Scopes <span className="font-normal text-fg-muted">({chosen.length} chosen)</span></legend>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.resource} className="min-w-0">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{titled(g.resource)}</p>
                {g.scopes.map((s) => (
                  <Checkbox key={s.key} checked={chosen.includes(s.key)} disabled={!s.allowed} onChange={() => toggle(s.key)} className="py-1"
                    label={<span className={cn('text-sm', !s.allowed && 'text-fg-subtle')}><code className="font-mono text-xs">{s.key}</code><span className="block text-xs text-fg-muted">{s.allowed ? s.label : 'Your role does not have this access'}</span></span>} />
                ))}
              </div>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function Webhooks({ onSeeDeliveries }: { onSeeDeliveries: () => void }) {
  const toast = useToast()
  const { date } = useSession()
  const { data, error, loading, reload } = useApi<HooksData>('/api/developer/webhooks')
  const [editing, setEditing] = useState<Endpoint | 'new' | null>(null)
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'roll'; endpoint: Endpoint } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const act = async (endpoint: Endpoint, what: 'test' | 'toggle') => {
    setBusy(`${what}:${endpoint.id}`)
    try {
      if (what === 'test') {
        const r = await api<{ delivery: Delivery }>(`/api/developer/webhooks/${endpoint.id}`, { body: { action: 'test' } })
        if (r.delivery.status === 'succeeded') toast.success(`Test event delivered (${r.delivery.lastStatusCode})`)
        else toast.error(`Test event failed: ${r.delivery.lastError || 'no answer'}`)
      } else {
        await api(`/api/developer/webhooks/${endpoint.id}`, { method: 'PATCH', body: { isActive: !endpoint.isActive } })
        toast.success(endpoint.isActive ? 'Endpoint switched off' : 'Endpoint switched on')
      }
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const confirmed = async () => {
    if (!confirm) return
    setBusy('confirm')
    setProblem(null)
    try {
      if (confirm.kind === 'delete') {
        await api(`/api/developer/webhooks/${confirm.endpoint.id}`, { method: 'DELETE' })
        toast.success('Endpoint removed')
      } else {
        const rolled = await api<{ url: string; secret: string }>(`/api/developer/webhooks/${confirm.endpoint.id}`, { body: { action: 'roll_secret' } })
        setRevealed({ url: rolled.url, secret: rolled.secret })
      }
      setConfirm(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader title="Webhook endpoints" description={data ? `ClubCheck sends a signed POST to each endpoint when something it subscribes to happens. A failed delivery is retried up to ${data.retries.attempts - 1} more times over about a day.` : undefined} className="px-4 pt-4 sm:px-5" action={<Button variant="primary" onClick={() => setEditing('new')}>Add endpoint</Button>} />
        {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error || 'Could not load webhooks'} onRetry={reload} /> : data.endpoints.length === 0 ? (
          <EmptyState icon={<Webhook className="h-5 w-5" />} title="No webhook endpoints yet" description="Add the URL of the software that should be told about new members, bookings, payments and more." action={<Button variant="primary" onClick={() => setEditing('new')}>Add endpoint</Button>} />
        ) : (
          <ul className="divide-y divide-line/60 border-t border-line" aria-label="Webhook endpoints">
            {data.endpoints.map((e) => (
              <li key={e.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <p className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-all font-mono text-sm font-medium text-fg-heading">{e.url}</span><Badge tone={e.isActive ? 'green' : 'neutral'}>{e.isActive ? 'Active' : 'Off'}</Badge></p>
                    {e.description && <p className="mt-0.5 text-sm text-fg">{e.description}</p>}
                    <p className="mt-0.5 text-xs text-fg-muted">{e.events.includes('*') ? 'All events' : `${e.events.length} event${e.events.length === 1 ? '' : 's'}`} · secret ends in <span className="font-mono">{e.secretHint}</span> · added {date(e.createdAt)}{e.createdByName ? ` by ${e.createdByName}` : ''}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">Last 7 days: {e.lastWeek.succeeded} delivered{e.lastWeek.pending + e.lastWeek.failed > 0 ? `, ${e.lastWeek.pending + e.lastWeek.failed} waiting or retrying` : ''}{e.lastWeek.dead > 0 ? <span className="text-red-600 dark:text-red-400">, {e.lastWeek.dead} failed</span> : ''}</p>
                    {e.disabledReason && <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{e.disabledReason} Switch it back on when the receiver is fixed.</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={busy === `test:${e.id}`} icon={<Send className="h-3.5 w-3.5" />} onClick={() => act(e, 'test')}>Send test</Button>
                    <Button size="sm" onClick={() => setEditing(e)}>Edit</Button>
                    <Button size="sm" loading={busy === `toggle:${e.id}`} onClick={() => act(e, 'toggle')}>{e.isActive ? 'Switch off' : 'Switch on'}</Button>
                    <Button size="sm" onClick={() => { setProblem(null); setConfirm({ kind: 'roll', endpoint: e }) }}>New secret</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setProblem(null); setConfirm({ kind: 'delete', endpoint: e }) }}>Remove</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.endpoints.length > 0 && <p className="border-t border-line px-4 py-2.5 text-xs text-fg-muted sm:px-5">See what was sent, and retry anything that failed, under <button type="button" onClick={onSeeDeliveries} className="ui-focus rounded font-medium text-accent-text underline">Deliveries</button>.</p>}
      </Card>

      {data && <EndpointForm editing={editing} events={data.events} onClose={() => setEditing(null)} onSaved={(made) => { setEditing(null); if (made) setRevealed(made); reload() }} />}
      <RevealOnce open={!!revealed} title="Signing secret" label="Signing secret" value={revealed?.secret || ''} note="Copy this secret into the software that receives the webhooks: it is how that software checks a webhook really came from ClubCheck. It cannot be shown again. If it is lost, make a new one." onClose={() => setRevealed(null)} />
      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirmed} title={confirm?.kind === 'delete' ? 'Remove this endpoint?' : 'Make a new signing secret?'} confirmLabel={confirm?.kind === 'delete' ? 'Remove endpoint' : 'Make new secret'} danger loading={busy === 'confirm'} error={problem}>
        <p className="break-words text-sm text-fg-muted">{confirm?.kind === 'delete' ? `Nothing more will be sent to ${confirm.endpoint.url}, and its delivery history is removed.` : `The current secret for ${confirm?.endpoint.url} stops working at once. Webhooks will fail the receiver's signature check until it has the new one.`}</p>
      </ConfirmModal>
    </>
  )
}

function EndpointForm({ editing, events, onClose, onSaved }: { editing: Endpoint | 'new' | null; events: { type: string; description: string }[]; onClose: () => void; onSaved: (made: { url: string; secret: string } | null) => void }) {
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [all, setAll] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const isNew = editing === 'new'
  useEffect(() => {
    if (!editing) return
    setProblem(null)
    if (editing === 'new') { setUrl(''); setDescription(''); setAll(false); setChosen([]) } else { setUrl(editing.url); setDescription(editing.description || ''); setAll(editing.events.includes('*')); setChosen(editing.events.filter((e) => e !== '*')) }
  }, [editing])
  const groups = useMemo(() => Array.from(new Set(events.map((e) => resourceOf(e.type)))).map((resource) => ({ resource, events: events.filter((e) => resourceOf(e.type) === resource) })), [events])
  const toggle = (type: string) => setChosen((c) => (c.includes(type) ? c.filter((k) => k !== type) : [...c, type]))
  const setGroup = (types: string[], on: boolean) => setChosen((c) => (on ? Array.from(new Set([...c, ...types])) : c.filter((k) => !types.includes(k))))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const body = { url: url.trim(), description: description.trim() || null, events: all ? ['*'] : chosen }
      if (isNew) {
        const made = await api<{ url: string; secret: string }>('/api/developer/webhooks', { body })
        onSaved({ url: made.url, secret: made.secret })
      } else {
        await api(`/api/developer/webhooks/${(editing as Endpoint).id}`, { method: 'PATCH', body })
        onSaved(null)
      }
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={!!editing} onClose={onClose} size="lg" title={isNew ? 'Add webhook endpoint' : 'Edit webhook endpoint'} description={isNew ? 'Its signing secret is shown once, after you add it.' : undefined}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="webhook-endpoint" loading={busy} disabled={!url.trim() || (!all && chosen.length === 0)}>{isNew ? 'Add endpoint' : 'Save changes'}</Button></>}>
      <form id="webhook-endpoint" onSubmit={save} className="space-y-4">
        {problem && <FormError message={problem} />}
        <Field label="Endpoint URL" required hint="Must be https. It should answer with any 2xx status within 10 seconds."><Input type="url" inputMode="url" value={url} maxLength={500} required placeholder="https://example.com/webhooks/clubcheck" onChange={(e) => setUrl(e.target.value)} /></Field>
        <Field label="Description (optional)"><Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-heading">Events <span className="font-normal text-fg-muted">({all ? 'all' : `${chosen.length} chosen`})</span></legend>
          <Checkbox checked={all} onChange={() => setAll((v) => !v)} label={<span className="text-sm">All events, including ones added later</span>} className="mb-3" />
          {!all && (
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {groups.map((g) => {
                const types = g.events.map((e) => e.type)
                const every = types.every((t) => chosen.includes(t))
                return (
                  <div key={g.resource} className="min-w-0">
                    <p className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted"><span>{titled(g.resource)}</span><button type="button" onClick={() => setGroup(types, !every)} className="ui-focus rounded text-xs font-medium normal-case tracking-normal text-accent-text">{every ? 'None' : 'All'}</button></p>
                    {g.events.map((ev) => <Checkbox key={ev.type} checked={chosen.includes(ev.type)} onChange={() => toggle(ev.type)} className="py-1" label={<span className="text-sm"><code className="font-mono text-xs">{ev.type}</code><span className="block text-xs text-fg-muted">{ev.description}</span></span>} />)}
                  </div>
                )
              })}
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

function Deliveries() {
  const toast = useToast()
  const { dateTime } = useSession()
  const hooks = useApi<HooksData>('/api/developer/webhooks')
  const [endpointId, setEndpointId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [tick, setTick] = useState(0)
  const [rows, setRows] = useState<Paged<Delivery> | null>(null)
  const [error, setError] = useState<ClientError | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  useEffect(() => { setPage(1) }, [endpointId, status])
  useEffect(() => {
    let live = true
    setError(null)
    fetch(`/api/developer/deliveries?page=${page}${endpointId ? `&endpointId=${endpointId}` : ''}${status ? `&status=${status}` : ''}`, { credentials: 'same-origin' })
      .then(async (res) => { const json = await res.json(); if (!res.ok) throw new ClientError(json?.error || 'Could not load deliveries', res.status); if (live) setRows(json) })
      .catch((err) => { if (live) setError(err instanceof ClientError ? err : new ClientError('Could not load deliveries', 0)) })
    return () => { live = false }
  }, [page, endpointId, status, tick])
  const reload = () => setTick((t) => t + 1)

  const retry = async (id: string) => {
    setRetrying(id)
    try {
      const d = await api<Delivery>(`/api/developer/deliveries/${id}`, { method: 'POST' })
      if (d.status === 'succeeded') toast.success('Delivered')
      else toast.error(`Still failing: ${d.lastError || 'no answer'}`)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setRetrying(null)
    }
  }

  return (
    <>
      <Card padded={false}>
        <CardHeader title="Deliveries" description="Every event sent to an endpoint, newest first. A retry sends the same event with the same ID." className="px-4 pt-4 sm:px-5" action={<Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={reload}>Refresh</Button>} />
        <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-5">
          <Select aria-label="Endpoint" value={endpointId} onChange={(e) => setEndpointId(e.target.value)} className="h-9 min-w-0 max-w-full flex-1 basis-[12rem] sm:max-w-xs"><option value="">All endpoints</option>{(hooks.data?.endpoints || []).map((e) => <option key={e.id} value={e.id}>{e.url}</option>)}</Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-40"><option value="">Any status</option><option value="succeeded">Delivered</option><option value="pending">Waiting</option><option value="failed">Retrying</option><option value="dead">Failed</option></Select>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : !rows ? <SkeletonRows rows={5} /> : rows.data.length === 0 ? (
          <EmptyState icon={<Send className="h-5 w-5" />} title={endpointId || status ? 'Nothing matches' : 'Nothing has been sent yet'} description={endpointId || status ? 'Try a different endpoint or status.' : 'Deliveries appear here once an endpoint is subscribed to something that happens.'} />
        ) : (
          <>
            <ul className="divide-y divide-line/60 border-t border-line" aria-label="Deliveries">
              {rows.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <p className="flex flex-wrap items-center gap-2"><code className="font-mono text-sm font-medium text-fg-heading">{d.event.type}</code><Badge tone={TONE[d.status]}>{LABEL[d.status] || d.status}</Badge></p>
                    <p className="mt-0.5 truncate text-xs text-fg-muted">{d.endpoint.url}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{dateTime(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'}{d.lastStatusCode ? ` · answered ${d.lastStatusCode}` : ''}{d.status !== 'succeeded' && d.lastError ? ` · ${d.lastError}` : ''}{d.status === 'failed' && d.nextAttemptAt ? ` · next try ${dateTime(d.nextAttemptAt)}` : ''}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" onClick={() => setOpenId(d.id)}>View</Button>
                    {d.status !== 'succeeded' && <Button size="sm" variant="primary" loading={retrying === d.id} onClick={() => retry(d.id)}>Retry</Button>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={rows.meta.page} totalPages={rows.meta.totalPages} total={rows.meta.total} onPage={setPage} noun="deliveries" />
          </>
        )}
      </Card>
      <DeliveryDetail id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function DeliveryDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { dateTime } = useSession()
  const { data, error, loading, reload } = useApi<Delivery>(id ? `/api/developer/deliveries/${id}` : null)
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={data ? data.event.type : 'Delivery'} description={data ? data.endpoint.url : undefined} footer={<Button onClick={onClose}>Close</Button>}>
      {loading ? <SkeletonRows rows={5} /> : error || !data ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-4 text-sm">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-fg-muted">Status</dt><dd><Badge tone={TONE[data.status]}>{LABEL[data.status] || data.status}</Badge></dd>
            <dt className="text-fg-muted">Event ID</dt><dd className="min-w-0 break-all font-mono text-xs text-fg-heading">{data.event.id}</dd>
            <dt className="text-fg-muted">Happened</dt><dd className="text-fg">{dateTime(data.event.createdAt)}</dd>
          </dl>
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Attempts</p>
            {(data.tries || []).length === 0 ? <p className="text-fg-muted">Not sent yet.</p> : (
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {(data.tries || []).map((t) => <li key={t.attempt} className="px-3 py-2 text-xs"><span className="font-medium text-fg-heading">#{t.attempt}</span> · {dateTime(t.at)} · {t.statusCode ? `answered ${t.statusCode}` : t.error || 'no answer'} · {t.durationMs} ms{t.manual ? ' · by hand' : ''}{t.response && t.statusCode && t.statusCode >= 300 ? <span className="mt-1 block break-all font-mono text-fg-muted">{t.response.slice(0, 200)}</span> : null}</li>)}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Payload</p>
            <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs text-fg-heading">{JSON.stringify(data.event.payload, null, 2)}</pre>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Request log
// ---------------------------------------------------------------------------

function Requests() {
  const { dateTime } = useSession()
  const [requestId, setRequestId] = useState('')
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Paged<RequestRow> | null>(null)
  const [error, setError] = useState<ClientError | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { setPage(1) }, [requestId, failed])
  useEffect(() => {
    let live = true
    setError(null)
    const id = requestId.trim()
    fetch(`/api/developer/requests?page=${page}${id ? `&requestId=${encodeURIComponent(id)}` : ''}${failed ? '&failed=1' : ''}`, { credentials: 'same-origin' })
      .then(async (res) => { const json = await res.json(); if (!res.ok) throw new ClientError(json?.error || 'Could not load the request log', res.status); if (live) setRows(json) })
      .catch((err) => { if (live) setError(err instanceof ClientError ? err : new ClientError('Could not load the request log', 0)) })
    return () => { live = false }
  }, [page, requestId, failed, tick])
  return (
    <Card padded={false}>
      <CardHeader title="Request log" description="Every call made with this gym's API keys in the last 30 days. Every response carries a request ID in its X-Request-Id header: paste one here to find it." className="px-4 pt-4 sm:px-5" />
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3 sm:px-5">
        <Input aria-label="Request ID" value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="req_…" className="h-9 min-w-0 flex-1 basis-[12rem] font-mono sm:max-w-xs" />
        <Checkbox checked={failed} onChange={() => setFailed((v) => !v)} label="Errors only" />
      </div>
      {error ? <ErrorState error={error} onRetry={() => setTick((t) => t + 1)} /> : !rows ? <SkeletonRows rows={5} /> : rows.data.length === 0 ? (
        <EmptyState title={requestId.trim() || failed ? 'Nothing matches' : 'No API requests yet'} description={requestId.trim() ? 'Check the ID, or it may be older than 30 days.' : undefined} />
      ) : (
        <>
          <ul className="divide-y divide-line/60 border-t border-line" aria-label="API requests">
            {rows.data.map((r) => (
              <li key={r.requestId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1 basis-[16rem]">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-sm"><span className="font-semibold text-fg-heading">{r.method}</span><span className="min-w-0 break-all text-fg">{r.path}</span></p>
                  <p className="mt-0.5 break-all text-xs text-fg-muted">{dateTime(r.at)} · <span className="font-mono">{r.requestId}</span> · {r.key ? `${r.key.name} (${r.key.prefix}…)` : 'no valid key'} · {r.durationMs} ms</p>
                </div>
                <Badge tone={r.status < 300 ? 'green' : r.status < 500 ? 'amber' : 'red'}>{r.status}{r.errorCode ? ` ${r.errorCode}` : ''}</Badge>
              </li>
            ))}
          </ul>
          <Pagination page={rows.meta.page} totalPages={rows.meta.totalPages} total={rows.meta.total} onPage={setPage} noun="requests" />
        </>
      )}
    </Card>
  )
}
