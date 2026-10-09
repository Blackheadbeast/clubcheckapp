'use client'

// One document template: its wording, the fields a signer fills in, when it is required, and its
// versions. The editor works in a small plain markup (shown in the toolbar's hints) with a live
// preview beside it; nothing here is HTML.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Bold, ChevronLeft, Heading1, Heading2, Info, Italic, Link2, List, ListOrdered, Plus, SeparatorHorizontal, Trash2 } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { DOCUMENT_TYPES, FIELD_TYPES, MERGE_FIELDS, parseBody, previewBlocks, unknownMergeFields, type DocumentField } from '@/lib/documents/content'
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, SearchInput, Select, SkeletonRows, Textarea, cn, useToast } from '@/components/ui'
import { DocumentBody } from '@/components/documents/SignDocument'

interface VersionOut { id: string; version: number; status: string; title: string; body: string; fields: DocumentField[]; requireSignature: boolean; publishedAt: string | null; timesUsed: number }
interface Rule { trigger: string; planIds: string[]; classTypeIds: string[]; appointmentTypeIds: string[]; blocking: boolean }
interface Detail {
  id: string; name: string; description: string | null; type: string; status: string; archived: boolean
  validForDays: number | null; signWithinDays: number | null; allowDecline: boolean; declineReasonRequired: boolean
  draft: VersionOut | null; published: VersionOut | null; editing: VersionOut
  versions: { id: string; version: number; status: string; title: string; publishedAt: string | null; createdByName: string | null; timesUsed: number }[]
  requirements: Rule[]; canManage: boolean; canSend: boolean
  options: { plans: { id: string; name: string }[]; classTypes: { id: string; name: string }[]; appointmentTypes: { id: string; name: string }[] }
}
interface Form { name: string; description: string; type: string; validForDays: string; signWithinDays: string; allowDecline: boolean; declineReasonRequired: boolean; title: string; body: string; fields: DocumentField[]; requireSignature: boolean }

const STARTER = `# Assumption of risk

I, {{member.full_name}}, understand that physical exercise carries risk, including the risk of injury. I am taking part at {{gym.name}} voluntarily.

## What I agree to

- I will follow the instructions of staff and the rules of the gym.
- I will tell a coach about any injury or medical condition before I train.

Signed on {{today}}.`
const blank: Form = { name: '', description: '', type: 'waiver', validForDays: '', signWithinDays: '', allowDecline: true, declineReasonRequired: false, title: '', body: STARTER, fields: [], requireSignature: true }
const TRIGGER_LABELS: Record<string, string> = { member_signup: 'When someone becomes a member', membership_purchase: 'Before a member buys or changes to a membership', class_booking: 'Before a member books a class', appointment_booking: 'Before a member books an appointment' }
const keyOf = (label: string, taken: string[]) => {
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '') || 'field').slice(0, 30)
  let key = base
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`
  return key
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const router = useRouter()
  const toast = useToast()
  const { can, date } = useSession()
  const { data, error, loading, reload } = useApi<Detail>(isNew ? null : `/api/documents/templates/${id}`)
  const [f, setF] = useState<Form>(blank)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [rulesDirty, setRulesDirty] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!data) return
    const v = data.editing
    setF({ name: data.name, description: data.description || '', type: data.type, validForDays: data.validForDays ? String(data.validForDays) : '', signWithinDays: data.signWithinDays ? String(data.signWithinDays) : '', allowDecline: data.allowDecline, declineReasonRequired: data.declineReasonRequired, title: v.title, body: v.body, fields: v.fields, requireSignature: v.requireSignature })
    setRules(data.requirements)
    setDirty(false); setRulesDirty(false); setProblem(null)
  }, [data])

  const manage = isNew ? can('documents.manage') : !!data?.canManage
  const readOnly = !manage || !!data?.archived
  const set = (patch: Partial<Form>) => { setF((cur) => ({ ...cur, ...patch })); setDirty(true) }
  const preview = useMemo(() => previewBlocks(parseBody(f.body)), [f.body])
  const unknown = useMemo(() => unknownMergeFields(f.body), [f.body])

  /** Wrap the selection, or put something at the cursor, and keep the cursor where it makes sense. */
  const insert = (before: string, after = '', placeholder = '') => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const selected = value.slice(a, b) || placeholder
    const next = value.slice(0, a) + before + selected + after + value.slice(b)
    set({ body: next })
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + selected.length) })
  }
  const linePrefix = (prefix: string) => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, value } = el
    const start = value.lastIndexOf('\n', a - 1) + 1
    set({ body: value.slice(0, start) + prefix + value.slice(start) })
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + prefix.length, a + prefix.length) })
  }

  const metaBody = () => ({ name: f.name.trim(), description: f.description.trim() || null, type: f.type, validForDays: f.validForDays ? Number(f.validForDays) : null, signWithinDays: f.signWithinDays ? Number(f.signWithinDays) : null, allowDecline: f.allowDecline, declineReasonRequired: f.allowDecline && f.declineReasonRequired })
  const draftBody = () => ({ title: f.title.trim() || f.name.trim(), body: f.body, fields: f.fields, requireSignature: f.requireSignature })

  const save = async (then?: 'publish') => {
    setBusy(then || 'save')
    setProblem(null)
    try {
      if (isNew) {
        const made = await api<{ id: string }>('/api/documents/templates', { body: { ...metaBody(), ...draftBody() } })
        // The draft exists from here on: if publishing is refused, carry on to it rather than leave a form that would create it twice.
        let refused: string | null = null
        if (then === 'publish') await api(`/api/documents/templates/${made.id}`, { body: { action: 'publish' } }).catch((err: ClientError) => { refused = err.message })
        if (refused) toast.error(`Saved as a draft, not published. ${refused}`)
        else toast.success(then === 'publish' ? 'Template published' : 'Draft saved')
        router.replace(`/documents/templates/${made.id}`)
        return
      }
      if (dirty) {
        await api(`/api/documents/templates/${id}`, { method: 'PATCH', body: metaBody() })
        const v = data!.editing
        const wordingChanged = draftBody().title !== v.title || f.body !== v.body || f.requireSignature !== v.requireSignature || JSON.stringify(f.fields) !== JSON.stringify(v.fields)
        if (wordingChanged) {
          const r = await api<{ version: number; startedNewVersion: boolean }>(`/api/documents/templates/${id}`, { body: { action: 'save_draft', draft: draftBody() } })
          if (r.startedNewVersion && then !== 'publish') toast.success(`Saved as a draft of version ${r.version}. Version ${r.version - 1} stays in use until you publish.`)
          else if (then !== 'publish') toast.success('Draft saved')
        } else if (then !== 'publish') toast.success('Saved')
      }
      if (then === 'publish') {
        const r = await api<{ version: number }>(`/api/documents/templates/${id}`, { body: { action: 'publish' } })
        toast.success(`Version ${r.version} published. New copies use it; signed copies are unchanged.`)
      }
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setBusy(null)
    }
  }
  const act = async (action: string, done: string, after?: (r: { id?: string }) => void) => {
    setBusy(action)
    setProblem(null)
    try {
      const r = await api<{ id?: string }>(`/api/documents/templates/${id}`, { body: { action } })
      toast.success(done)
      if (after) after(r); else reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const saveRules = async () => {
    setBusy('rules')
    try {
      await api(`/api/documents/templates/${id}`, { body: { action: 'requirements', requirements: rules } })
      toast.success('Requirements saved')
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  if (!isNew && loading) return <Page><Card padded={false}><SkeletonRows rows={10} /></Card></Page>
  if (!isNew && (error || !data)) return <Page><Card><ErrorState error={error || 'Template not found'} onRetry={reload} /></Card></Page>

  const hasDraft = isNew || !!data?.draft
  const published = data?.published || null
  const setField = (i: number, patch: Partial<DocumentField>) => set({ fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setRule = (i: number, patch: Partial<Rule>) => { setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r))); setRulesDirty(true) }
  const TOOLS: { label: string; icon: typeof Bold; run: () => void }[] = [
    { label: 'Heading', icon: Heading1, run: () => linePrefix('# ') }, { label: 'Smaller heading', icon: Heading2, run: () => linePrefix('## ') },
    { label: 'Bold', icon: Bold, run: () => insert('**', '**', 'bold text') }, { label: 'Italic', icon: Italic, run: () => insert('*', '*', 'italic text') },
    { label: 'Bulleted list', icon: List, run: () => linePrefix('- ') }, { label: 'Numbered list', icon: ListOrdered, run: () => linePrefix('1. ') },
    { label: 'Link', icon: Link2, run: () => insert('[', '](https://)', 'link text') }, { label: 'Page break', icon: SeparatorHorizontal, run: () => insert('\n\n---\n\n') },
  ]

  return (
    <Page>
      <PageHeader
        back={<Link href="/documents/templates" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Templates</Link>}
        title={isNew ? 'New template' : data!.name}
        description={isNew ? 'Write it, then publish it to start sending it.' : data!.archived ? 'Archived' : published ? `Version ${published.version} is published${data!.draft ? `, with unpublished changes for version ${data!.draft.version}` : ''}` : 'Draft: not yet published'}
        actions={
          <>
            {!isNew && data!.canSend && published && !data!.archived && <Button onClick={() => setSending(true)}>Send to members</Button>}
            {!isNew && manage && <Button loading={busy === 'duplicate'} onClick={() => act('duplicate', 'Copy made', (r) => router.push(`/documents/templates/${r.id}`))}>Duplicate</Button>}
            {!isNew && manage && (data!.archived ? <Button loading={busy === 'restore'} onClick={() => act('restore', 'Template restored')}>Restore</Button> : <Button variant="ghost" className="text-red-600" loading={busy === 'archive'} onClick={() => act('archive', 'Template archived')}>Archive</Button>)}
            {!readOnly && <Button loading={busy === 'save'} disabled={!dirty || !f.name.trim()} onClick={() => save()}>Save draft</Button>}
            {!readOnly && <Button variant="primary" loading={busy === 'publish'} disabled={!f.name.trim() || (!dirty && !hasDraft)} onClick={() => save('publish')}>Publish{published ? ` version ${(data!.draft?.version ?? published.version + 1)}` : ''}</Button>}
          </>
        }
      />
      <div className="space-y-5">
        {problem && <FormError message={problem} />}
        {!isNew && published && !data!.draft && !readOnly && (
          <p className="flex items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Version {published.version} is published{published.timesUsed ? ` and has been sent ${published.timesUsed} time${published.timesUsed === 1 ? '' : 's'}` : ''}. It cannot be changed. Editing below starts version {published.version + 1}; anything already sent or signed keeps the version it was given.</p>
        )}
        {!isNew && data!.draft && published && manage && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-fg dark:border-amber-800/50 dark:bg-amber-950/30">You are editing a draft of version {data!.draft.version}. Members are still sent version {published.version} until you publish.<Button size="sm" loading={busy === 'discard_draft'} onClick={() => act('discard_draft', 'Draft discarded')}>Discard draft</Button></p>
        )}

        <Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" required className="lg:col-span-2"><Input value={f.name} disabled={readOnly} maxLength={120} placeholder="Liability waiver" onChange={(e) => set({ name: e.target.value, ...(isNew && (!f.title || f.title === f.name) && { title: e.target.value }) })} /></Field>
            <Field label="Type"><Select value={f.type} disabled={readOnly} onChange={(e) => set({ type: e.target.value })}>{Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Signature stays valid for" hint="After that it is marked expired and they are asked again.">
              <Select value={f.validForDays} disabled={readOnly} onChange={(e) => set({ validForDays: e.target.value })}><option value="">Always</option><option value="90">3 months</option><option value="180">6 months</option><option value="365">12 months</option><option value="730">2 years</option></Select>
            </Field>
            <Field label="Description (staff only)" className="sm:col-span-2"><Input value={f.description} disabled={readOnly} maxLength={500} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Must be signed within" hint="Unsigned after that: expired."><Select value={f.signWithinDays} disabled={readOnly} onChange={(e) => set({ signWithinDays: e.target.value })}><option value="">No deadline</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></Select></Field>
            <div className="space-y-1.5 self-end pb-1">
              <Checkbox checked={f.allowDecline} disabled={readOnly} onChange={() => set({ allowDecline: !f.allowDecline })} label="Members may decline" />
              {f.allowDecline && <Checkbox checked={f.declineReasonRequired} disabled={readOnly} onChange={() => set({ declineReasonRequired: !f.declineReasonRequired })} label="They must say why" />}
            </div>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="min-w-0">
            <Field label="Title shown to the signer" required><Input value={f.title} disabled={readOnly} maxLength={160} placeholder={f.name || 'Liability Waiver'} onChange={(e) => set({ title: e.target.value })} /></Field>
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium text-fg-muted">Document</p>
              {!readOnly && (
                <div className="mb-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
                  {TOOLS.map(({ label, icon: Icon, run }) => <Button key={label} size="sm" variant="ghost" aria-label={label} title={label} onClick={run}><Icon className="h-4 w-4" /></Button>)}
                  <Select aria-label="Insert a merge field" value="" onChange={(e) => { if (e.target.value) insert(`{{${e.target.value}}}`) }} className="ml-auto h-8 w-52 text-xs"><option value="">Insert member or gym detail…</option>{Object.entries(MERGE_FIELDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                </div>
              )}
              <Textarea ref={area} aria-label="Document text" rows={22} value={f.body} disabled={readOnly} spellCheck onChange={(e) => set({ body: e.target.value })} className="font-mono text-[13px] leading-relaxed" />
              <p className="mt-1 text-xs text-fg-subtle"># Heading · **bold** · *italic* · - list · 1. numbered list · [text](https://link) · --- on its own line for a new page</p>
              {unknown.length > 0 && <p className="mt-1 text-xs text-red-600">Not a merge field: {unknown.map((u) => `{{${u}}}`).join(', ')}. Pick one from the list.</p>}
            </div>
          </Card>
          <Card className="min-w-0">
            <p className="mb-2 flex items-center justify-between text-xs font-medium text-fg-muted"><span>Preview</span><span className="font-normal">Member and gym details are filled in when it is sent.</span></p>
            <div className="max-h-[44rem] overflow-y-auto rounded-lg border border-line bg-canvas p-4 sm:p-6" aria-label="Preview">
              <h2 className="mb-3 break-words text-2xl font-semibold text-fg-heading">{f.title || f.name || 'Untitled document'}</h2>
              {preview.length ? <DocumentBody blocks={preview} /> : <p className="text-sm text-fg-muted">Nothing written yet.</p>}
              {f.fields.length > 0 && <div className="mt-6 border-t border-line pt-4"><p className="mb-2 text-sm font-semibold text-fg-heading">Your details</p><ul className="space-y-1 text-sm text-fg-muted">{f.fields.map((x) => <li key={x.key}>{x.label}{x.required ? ' *' : ''} <span className="text-fg-subtle">({FIELD_TYPES[x.type].toLowerCase()})</span></li>)}</ul></div>}
              <div className="mt-6 border-t border-line pt-4 text-sm text-fg-muted">{f.requireSignature ? 'Signature (drawn or typed), full name, and consent to sign electronically.' : 'Full name and consent to sign electronically. No drawn or typed signature.'}</div>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Fields the signer fills in" description="Shown after the document, before the signature. Their answers become part of the signed record." action={!readOnly ? <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={f.fields.length >= 40} onClick={() => set({ fields: [...f.fields, { key: keyOf('field', f.fields.map((x) => x.key)), label: '', type: 'text', required: false }] })}>Add field</Button> : undefined} />
          {f.fields.length === 0 ? <p className="mt-3 text-sm text-fg-muted">None. For example: an emergency contact, a date of birth, a tick box for photo consent, or initials beside a clause.</p> : (
            <ul className="mt-3 space-y-3">
              {f.fields.map((x, i) => (
                <li key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_12rem_auto_auto] sm:items-end">
                  <Field label="Question or label"><Input value={x.label} disabled={readOnly} maxLength={200} placeholder="Emergency contact name" onChange={(e) => setField(i, { label: e.target.value, key: keyOf(e.target.value, f.fields.filter((_, j) => j !== i).map((y) => y.key)) })} /></Field>
                  <Field label="Answer type"><Select value={x.type} disabled={readOnly} onChange={(e) => setField(i, { type: e.target.value as DocumentField['type'], ...(e.target.value === 'select' ? { options: x.options?.length ? x.options : ['Yes', 'No'] } : { options: undefined }) })}>{Object.entries(FIELD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <div className="pb-2"><Checkbox checked={x.required} disabled={readOnly} onChange={() => setField(i, { required: !x.required })} label="Required" /></div>
                  {!readOnly && <Button size="sm" variant="ghost" className="mb-0.5 text-red-600" aria-label={`Remove field ${x.label || i + 1}`} onClick={() => set({ fields: f.fields.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
                  {x.type === 'select' && <Field label="Choices, separated by commas" className="sm:col-span-4"><Input value={(x.options || []).join(', ')} disabled={readOnly} onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} /></Field>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-line pt-3"><Checkbox checked={f.requireSignature} disabled={readOnly} onChange={() => set({ requireSignature: !f.requireSignature })} label={<span className="text-sm">Require a drawn or typed signature<span className="block text-xs text-fg-muted">Off: the signer types their name and agrees, which suits a policy they only need to acknowledge.</span></span>} /></div>
        </Card>

        {!isNew && (
          <Card>
            <CardHeader title="When it is required" description="A member doing these things for themselves (in the member app or on your booking page) is asked to sign first. Staff are not held up: the document is sent to the member instead." action={manage && !data!.archived ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setRules([...rules, { trigger: 'member_signup', planIds: [], classTypeIds: [], appointmentTypeIds: [], blocking: true }]); setRulesDirty(true) }}>Add rule</Button> : undefined} />
            {!published && <p className="mt-3 text-sm text-fg-muted">Rules take effect once the template is published.</p>}
            {rules.length === 0 ? <p className="mt-3 text-sm text-fg-muted">Not required for anything. It is only sent when staff choose to send it.</p> : (
              <ul className="mt-3 space-y-3">
                {rules.map((r, i) => {
                  const scope = r.trigger === 'membership_purchase' ? { key: 'planIds' as const, items: data!.options.plans, all: 'Any membership' } : r.trigger === 'class_booking' ? { key: 'classTypeIds' as const, items: data!.options.classTypes, all: 'Any class' } : r.trigger === 'appointment_booking' ? { key: 'appointmentTypeIds' as const, items: data!.options.appointmentTypes, all: 'Any appointment' } : null
                  return (
                    <li key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                      <Field label="Required when"><Select value={r.trigger} disabled={!manage} onChange={(e) => setRule(i, { trigger: e.target.value, planIds: [], classTypeIds: [], appointmentTypeIds: [] })}>{Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                      {scope ? <Field label="Which"><Select value={r[scope.key][0] || ''} disabled={!manage} onChange={(e) => setRule(i, { [scope.key]: e.target.value ? [e.target.value] : [] })}><option value="">{scope.all}</option>{scope.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field> : <span />}
                      <div className="pb-2">{r.trigger === 'member_signup' ? <span className="text-xs text-fg-muted">Sent automatically</span> : <Checkbox checked={r.blocking} disabled={!manage} onChange={() => setRule(i, { blocking: !r.blocking })} label="Hold it until signed" />}</div>
                      {manage && <Button size="sm" variant="ghost" className="mb-0.5 text-red-600" aria-label="Remove rule" onClick={() => { setRules(rules.filter((_, j) => j !== i)); setRulesDirty(true) }}><Trash2 className="h-4 w-4" /></Button>}
                    </li>
                  )
                })}
              </ul>
            )}
            {rulesDirty && manage && <div className="mt-3 flex justify-end"><Button variant="primary" loading={busy === 'rules'} onClick={saveRules}>Save requirements</Button></div>}
          </Card>
        )}

        {!isNew && (
          <Card padded={false}>
            <CardHeader title="Versions" description="Every version that has existed. Signed copies keep the version they were signed on." className="px-4 pt-4 sm:px-5" />
            <ul className="divide-y divide-line/60 border-t border-line" aria-label="Versions">
              {data!.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
                  <span className="w-24 shrink-0 text-sm font-medium text-fg-heading">Version {v.version}</span>
                  <span className="min-w-0 flex-1 basis-48 truncate text-sm text-fg-muted">{v.title}{v.createdByName ? ` · ${v.createdByName}` : ''}{v.publishedAt ? ` · published ${date(v.publishedAt)}` : ''}</span>
                  <span className="text-xs text-fg-muted">{v.timesUsed} sent</span>
                  {v.status === 'published' ? <Badge tone="green">Published</Badge> : v.status === 'draft' ? <Badge tone="amber">Draft</Badge> : <Badge>Replaced</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {!isNew && data && <SendModal open={sending} templateId={data.id} name={data.name} version={published?.version || 1} onClose={() => setSending(false)} />}
    </Page>
  )
}

interface Found { id: string; name: string; email: string }
function SendModal({ open, templateId, name, version, onClose }: { open: boolean; templateId: string; name: string; version: number; onClose: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Found[]>([])
  const [again, setAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const debounced = useDebounced(q.trim(), 250)
  const found = useApi<Found[]>(open && debounced.length >= 2 ? `/api/members?search=${encodeURIComponent(debounced)}&pageSize=8` : null)
  useEffect(() => { if (open) { setQ(''); setPicked([]); setAgain(false); setProblem(null) } }, [open])
  const send = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ sent: number; alreadyHad: number }>(`/api/documents/templates/${templateId}`, { body: { action: 'send', memberIds: picked.map((p) => p.id), again } })
      toast.success(`Sent to ${r.sent} member${r.sent === 1 ? '' : 's'}${r.alreadyHad ? `. ${r.alreadyHad} already had it.` : ''}`)
      onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const options = (found.data || []).filter((m) => !picked.some((p) => p.id === m.id))
  return (
    <Modal open={open} onClose={onClose} title={`Send ${name}`} description={`Version ${version}. Each member gets their own copy, an email with a link to sign, and sees it in their member app.`} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={picked.length === 0} onClick={send}>Send to {picked.length || ''} member{picked.length === 1 ? '' : 's'}</Button></>}>
      <div className="space-y-3">
        {problem && <FormError message={problem} />}
        <SearchInput value={q} onChange={setQ} placeholder="Search members by name" />
        {debounced.length >= 2 && (
          <ul className="max-h-48 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
            {found.loading ? <li className="px-3 py-2 text-sm text-fg-muted">Searching…</li> : options.length === 0 ? <li className="px-3 py-2 text-sm text-fg-muted">No members match.</li> : options.map((m) => (
              <li key={m.id}><button type="button" onClick={() => { setPicked([...picked, { id: m.id, name: m.name, email: m.email }]); setQ('') }} className="ui-focus flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle/60"><Avatar name={m.name} size="sm" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-fg-heading">{m.name}</span><span className="block truncate text-xs text-fg-muted">{m.email}</span></span></button></li>
            ))}
          </ul>
        )}
        {picked.length > 0 ? <ul className="flex flex-wrap gap-2">{picked.map((p) => <li key={p.id}><button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="ui-focus rounded-full border border-line px-2.5 py-1 text-xs text-fg hover:bg-subtle" aria-label={`Remove ${p.name}`}>{p.name} ×</button></li>)}</ul> : <p className="text-xs text-fg-muted">Search and pick one or more members.</p>}
        <Checkbox checked={again} onChange={() => setAgain((v) => !v)} label={<span className={cn('text-sm')}>Ask again even if they have already signed<span className="block text-xs text-fg-muted">Use this to get the current version signed. Their earlier signed copy is kept.</span></span>} />
      </div>
    </Modal>
  )
}
