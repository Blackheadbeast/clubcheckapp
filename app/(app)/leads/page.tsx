'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarClock, LayoutGrid, List, Mail, Phone, Plus, Target, UserCheck } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { LEAD_STAGES, timeAgo, type LeadStage } from '@/lib/format'
import { PAYMENT_METHOD_LABELS, planPriceLabel, useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import {
  Avatar, Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, MoneyInput, Page, PageHeader, SearchInput, Select,
  SkeletonRows, StatusBadge, Table, Td, Textarea, Th, cn, useToast,
} from '@/components/ui'

interface Lead {
  id: string
  name: string
  email: string
  phone: string | null
  status: LeadStage
  source: string | null
  interest: string | null
  createdAt: string
  updatedAt: string
  trialDate: string | null
  nextFollowUpAt: string | null
  estimatedValueCents: number | null
  convertedMemberId: string | null
  lostReason: string | null
  assignedStaff: { id: string; name: string } | null
}

interface LeadDetail extends Lead {
  notes: string | null
  activities: { id: string; type: string; title: string; detail: string | null; actorName: string | null; createdAt: string }[]
  messages: { id: string; channel: string; subject: string | null; body: string; status: string; error: string | null; createdAt: string }[]
}

const OPEN_STAGES = LEAD_STAGES.filter((s) => !['converted', 'lost'].includes(s.key))
const localInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')

function Pipeline() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { can, money, date, locationId } = useSession()
  const lookups = useLookups()
  const [search, setSearch] = useState('')
  const [assignedStaffId, setAssignedStaffId] = useState('')
  const [view, setView] = useState<'board' | 'list'>('board')
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useApi<{ leads: Lead[]; counts: Record<string, number> }>(`/api/leads${qs({ search: debounced, assignedStaffId, locationId })}`)
  const [openId, setOpenId] = useState<string | null>(params.get('lead'))
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [losing, setLosing] = useState<Lead | null>(null)
  const [lostReason, setLostReason] = useState('')
  const [converting, setConverting] = useState<Lead | null>(null)
  const manage = can('leads.manage')

  useEffect(() => { if (window.innerWidth < 768) setView('list') }, [])
  const leads = data?.leads || []
  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>()
    for (const l of leads) map.set(l.status, [...(map.get(l.status) || []), l])
    return map
  }, [leads])
  const pipelineValue = leads.filter((l) => !['converted', 'lost'].includes(l.status)).reduce((s, l) => s + (l.estimatedValueCents || 0), 0)

  const moveTo = async (lead: Lead, status: LeadStage, extra: Record<string, unknown> = {}) => {
    if (lead.status === status) return
    if (status === 'converted') return setConverting(lead)
    if (status === 'lost' && !('lostReason' in extra)) { setLostReason(''); return setLosing(lead) }
    try {
      await api(`/api/leads/${lead.id}`, { method: 'PATCH', body: { status, ...extra } })
      toast.success(`${lead.name} moved to ${LEAD_STAGES.find((s) => s.key === status)!.label}`)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }
  const closeDrawer = () => {
    setOpenId(null)
    if (params.get('lead')) router.replace('/leads')
  }

  const card = (l: Lead) => {
    const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date()
    return (
      <button
        key={l.id}
        type="button"
        draggable={manage && l.status !== 'converted'}
        onDragStart={(e) => { setDragging(l.id); e.dataTransfer.effectAllowed = 'move' }}
        onDragEnd={() => { setDragging(null); setOver(null) }}
        onClick={() => setOpenId(l.id)}
        className={cn('ui-focus block w-full rounded-lg border border-line bg-surface p-3 text-left shadow-card transition hover:border-fg-subtle/40', dragging === l.id && 'opacity-40', manage && l.status !== 'converted' && 'cursor-grab active:cursor-grabbing')}
      >
        <p className="truncate text-sm font-medium text-fg-heading">{l.name}</p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">{[l.interest, l.source].filter(Boolean).join(' · ') || l.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {l.status === 'trial_scheduled' && l.trialDate && <Badge tone="violet"><CalendarClock className="h-3 w-3" />{date(l.trialDate)}</Badge>}
          {l.nextFollowUpAt && !['converted', 'lost'].includes(l.status) && <Badge tone={overdue ? 'red' : 'neutral'}>{overdue ? 'Follow-up overdue' : `Follow up ${date(l.nextFollowUpAt)}`}</Badge>}
          {l.status === 'lost' && l.lostReason && <span className="truncate text-fg-subtle">{l.lostReason}</span>}
          <span className="ml-auto text-fg-subtle">{l.assignedStaff ? l.assignedStaff.name.split(' ')[0] : 'Unassigned'}</span>
        </div>
      </button>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Sales pipeline"
        description={data ? `${leads.filter((l) => !['converted', 'lost'].includes(l.status)).length} open leads${pipelineValue ? ` · ${money(pipelineValue)} potential annual value` : ''}` : undefined}
        actions={manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add lead</Button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search leads" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Select aria-label="Assigned to" value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)} className="w-auto">
          <option value="">Everyone's leads</option>
          {lookups.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <div className="ml-auto flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="View">
          {([['board', LayoutGrid, 'Board'], ['list', List, 'List']] as const).map(([key, Icon, label]) => (
            <button key={key} role="tab" type="button" aria-selected={view === key} onClick={() => setView(key)} className={cn('ui-focus flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium', view === key ? 'bg-subtle text-fg-heading' : 'text-fg-muted hover:text-fg')}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <Card padded={false}><SkeletonRows /></Card> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : leads.length === 0 ? (
        <Card><EmptyState icon={<Target className="h-5 w-5" />} title={debounced ? 'No leads match' : 'No leads yet'} description={debounced ? 'Try a different search.' : 'Add everyone who enquires, books a tour or drops in. Move them through the pipeline as you follow up.'} action={!debounced && manage ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first lead</Button> : undefined} /></Card>
      ) : view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
          <div className="flex gap-3" style={{ minWidth: LEAD_STAGES.length * 236 }}>
            {LEAD_STAGES.map((stage) => {
              const items = byStage.get(stage.key) || []
              return (
                <section
                  key={stage.key}
                  aria-label={stage.label}
                  onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage.key) } }}
                  onDragLeave={() => setOver((o) => (o === stage.key ? null : o))}
                  onDrop={(e) => { e.preventDefault(); const lead = leads.find((l) => l.id === dragging); setDragging(null); setOver(null); if (lead) moveTo(lead, stage.key) }}
                  className={cn('flex w-56 shrink-0 flex-col rounded-xl border border-transparent bg-subtle/60 p-2 transition', over === stage.key && 'border-accent bg-accent/10')}
                >
                  <header className="mb-2 flex items-center justify-between px-1">
                    <h2 className="text-xs font-semibold text-fg-heading">{stage.label}</h2>
                    <span className="tabular text-xs text-fg-subtle">{items.length}</span>
                  </header>
                  <div className="flex-1 space-y-2">
                    {items.map(card)}
                    {items.length === 0 && <p className="rounded-lg border border-dashed border-line px-2 py-6 text-center text-xs text-fg-subtle">{['converted', 'lost'].includes(stage.key) ? 'None in the last 60 days' : 'Drop a lead here'}</p>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      ) : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Lead</Th><Th>Stage</Th><Th>Source</Th><Th>Assigned to</Th><Th>Next step</Th><Th>Added</Th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpenId(l.id)}>
                  <Td><button type="button" className="ui-focus flex items-center gap-2.5 rounded text-left"><Avatar name={l.name} size="sm" /><span><span className="block font-medium text-fg-heading">{l.name}</span><span className="block text-xs text-fg-muted">{l.email}</span></span></button></Td>
                  <Td><StatusBadge status={l.status} /></Td>
                  <Td className="text-fg-muted">{l.source || '—'}</Td>
                  <Td className="text-fg-muted">{l.assignedStaff?.name || 'Unassigned'}</Td>
                  <Td className={l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date() && !['converted', 'lost'].includes(l.status) ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-muted'}>{l.status === 'trial_scheduled' && l.trialDate ? `Trial ${date(l.trialDate)}` : l.nextFollowUpAt && !['converted', 'lost'].includes(l.status) ? `Follow up ${date(l.nextFollowUpAt)}` : '—'}</Td>
                  <Td className="text-fg-muted">{timeAgo(l.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <LeadDrawer id={openId} onClose={closeDrawer} onChanged={reload} onConvert={(l) => { setOpenId(null); setConverting(l) }} onLose={(l) => { setLostReason(''); setLosing(l) }} />
      <AddLeadModal open={adding} onClose={() => setAdding(false)} onCreated={(id) => { reload(); setOpenId(id) }} />
      <ConvertModal lead={converting} onClose={() => setConverting(null)} onDone={(memberId) => { reload(); setOpenId(null); router.push(`/members/${memberId}`) }} />
      <ConfirmModal open={!!losing} onClose={() => setLosing(null)} onConfirm={() => { const l = losing!; setLosing(null); setOpenId(null); moveTo(l, 'lost', { lostReason: lostReason || null }) }} title={`Mark ${losing?.name} as lost?`} confirmLabel="Mark as lost">
        <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Why? Price, joined elsewhere, no response…" aria-label="Reason" maxLength={300} />
      </ConfirmModal>
    </Page>
  )
}

function LeadDrawer({ id, onClose, onChanged, onConvert, onLose }: { id: string | null; onClose: () => void; onChanged: () => void; onConvert: (lead: Lead) => void; onLose: (lead: Lead) => void }) {
  const toast = useToast()
  const { can, dateTime, money } = useSession()
  const { staff } = useLookups()
  const { data: lead, error, loading, reload } = useApi<LeadDetail>(id ? `/api/leads/${id}` : null)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<'note' | 'call' | 'message'>('note')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [trialDate, setTrialDate] = useState('')
  const [followUp, setFollowUp] = useState('')
  const manage = can('leads.manage')

  useEffect(() => {
    setNote('')
    setSubject('')
    setMode('note')
  }, [id])
  useEffect(() => {
    setTrialDate(localInput(lead?.trialDate || null))
    setFollowUp(lead?.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 10) : '')
  }, [lead?.trialDate, lead?.nextFollowUpAt])

  if (!id) return null
  const changed = () => { reload(); onChanged() }
  const patch = async (body: Record<string, unknown>, message: string) => {
    try {
      await api(`/api/leads/${id}`, { method: 'PATCH', body })
      toast.success(message)
      changed()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }
  const log = async () => {
    setBusy(true)
    try {
      const body = mode === 'message' ? { type: 'message', channel: 'email', subject, body: note } : { type: mode, note }
      const result = await api<{ status?: string; error?: string | null }>(`/api/leads/${id}/activity`, { body })
      if (mode === 'message') result.status === 'sent' ? toast.success('Email sent') : toast.error(`Not delivered: ${result.error || result.status}`)
      setNote('')
      setSubject('')
      changed()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const closed = lead ? ['converted', 'lost'].includes(lead.status) : false

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={lead?.name || 'Lead'}
      description={lead ? [lead.interest, lead.source && `via ${lead.source}`, lead.estimatedValueCents && `${money(lead.estimatedValueCents)}/yr`].filter(Boolean).join(' · ') || undefined : undefined}
      footer={
        lead && manage ? (
          lead.status === 'converted' && lead.convertedMemberId ? <Link href={`/members/${lead.convertedMemberId}`}><Button variant="primary">Open member profile</Button></Link> : (
            <>
              {lead.status !== 'lost' && <Button variant="ghost" className="mr-auto text-red-600" onClick={() => onLose(lead)}>Mark as lost</Button>}
              {lead.status === 'lost' && <Button className="mr-auto" onClick={() => patch({ status: 'follow_up' }, 'Lead reopened')}>Reopen</Button>}
              <Button variant="primary" icon={<UserCheck className="h-4 w-4" />} onClick={() => onConvert(lead)}>Convert to member</Button>
            </>
          )
        ) : undefined
      }
    >
      {loading ? <SkeletonRows rows={5} /> : error || !lead ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
            <a href={`mailto:${lead.email}`} className="ui-focus inline-flex items-center gap-1.5 rounded hover:text-fg"><Mail className="h-3.5 w-3.5" />{lead.email}</a>
            {lead.phone && <a href={`tel:${lead.phone}`} className="ui-focus inline-flex items-center gap-1.5 rounded hover:text-fg"><Phone className="h-3.5 w-3.5" />{lead.phone}</a>}
            <StatusBadge status={lead.status} />
          </div>
          {lead.status === 'lost' && lead.lostReason && <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-fg-muted">Lost: {lead.lostReason}</p>}
          {lead.notes && <p className="whitespace-pre-wrap rounded-lg bg-subtle px-3 py-2 text-sm text-fg-muted">{lead.notes}</p>}

          {manage && !closed && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Stage">
                <Select value={lead.status} onChange={(e) => patch({ status: e.target.value }, 'Stage updated')}>
                  {OPEN_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Assigned to">
                <Select value={lead.assignedStaff?.id || ''} onChange={(e) => patch({ assignedStaffId: e.target.value || null }, 'Lead reassigned')}>
                  <option value="">Unassigned</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Trial visit" hint="Setting this moves the lead to Trial Scheduled.">
                <div className="flex gap-2">
                  <Input type="datetime-local" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} />
                  <Button disabled={!trialDate || localInput(lead.trialDate) === trialDate} onClick={() => patch({ trialDate: new Date(trialDate).toISOString(), status: 'trial_scheduled' }, 'Trial scheduled')}>Set</Button>
                </div>
              </Field>
              <Field label="Next follow-up">
                <div className="flex gap-2">
                  <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                  <Button disabled={(lead.nextFollowUpAt || '').slice(0, 10) === followUp} onClick={() => patch({ nextFollowUpAt: followUp ? new Date(`${followUp}T12:00:00`).toISOString() : null }, followUp ? 'Follow-up set' : 'Follow-up cleared')}>Set</Button>
                </div>
              </Field>
            </div>
          )}

          {manage && (
            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex gap-1" role="tablist" aria-label="Log activity">
                {([['note', 'Note'], ['call', 'Log a call'], ['message', 'Send email']] as const).map(([key, label]) => (
                  <button key={key} role="tab" type="button" aria-selected={mode === key} onClick={() => setMode(key)} className={cn('ui-focus rounded-md px-2.5 py-1 text-xs font-medium', mode === key ? 'bg-subtle text-fg-heading' : 'text-fg-muted hover:text-fg')}>{label}</button>
                ))}
              </div>
              {mode === 'message' && <Input className="mb-2" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" maxLength={200} />}
              <Textarea rows={mode === 'message' ? 5 : 2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={mode === 'message' ? 'Message' : 'Note'} placeholder={mode === 'message' ? 'Hi {{first_name}}, …' : mode === 'call' ? 'What did you talk about?' : 'Add a note'} maxLength={4000} />
              <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" loading={busy} disabled={(mode !== 'call' && !note.trim()) || (mode === 'message' && !subject.trim())} onClick={log}>{mode === 'message' ? 'Send email' : mode === 'call' ? 'Log call' : 'Save note'}</Button></div>
            </div>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg-heading">Activity</h3>
            {lead.activities.length === 0 ? <p className="text-sm text-fg-subtle">Nothing yet.</p> : (
              <ol className="relative space-y-3 pl-5 before:absolute before:bottom-1 before:left-[5px] before:top-1.5 before:w-px before:bg-line">
                {lead.activities.map((a) => (
                  <li key={a.id} className="relative">
                    <span className={cn('absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-surface', a.type === 'lead_converted' ? 'bg-emerald-500' : a.type === 'note' ? 'bg-amber-400' : a.type === 'message' ? 'bg-violet-400' : 'bg-sky-500')} />
                    {a.type !== 'note' && <p className="text-sm font-medium text-fg-heading">{a.title}</p>}
                    {a.detail && <p className="whitespace-pre-wrap text-sm text-fg-muted">{a.detail}</p>}
                    <p className="text-xs text-fg-subtle">{dateTime(a.createdAt)}{a.actorName && a.actorName !== 'System' ? ` · ${a.actorName}` : ''}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

function AddLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const { staff } = useLookups()
  const { locationId } = useSession()
  const empty = { name: '', email: '', phone: '', source: '', interest: '', notes: '', assignedStaffId: '', estimatedValueCents: 0 }
  const [f, setF] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setF(empty); setError(null) } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await api<{ id: string }>('/api/leads', { body: { ...f, assignedStaffId: f.assignedStaffId || null, estimatedValueCents: f.estimatedValueCents || null, locationId } })
      toast.success('Lead added')
      onClose()
      onCreated(created.id)
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add lead" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-lead" loading={busy}>Add lead</Button></>}>
      <form id="add-lead" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Email" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Source"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Referral, Instagram, walk-in…" list="lead-sources" /><datalist id="lead-sources">{['Referral', 'Instagram', 'Google search', 'Walk-in', 'Website', 'Facebook ad', 'Community event'].map((s) => <option key={s} value={s} />)}</datalist></Field>
        <Field label="Interested in"><Input value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} placeholder="CrossFit, weight loss…" /></Field>
        <Field label="Assigned to"><Select value={f.assignedStaffId} onChange={(e) => setF({ ...f, assignedStaffId: e.target.value })}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Potential annual value"><MoneyInput cents={f.estimatedValueCents} onChange={(c) => setF({ ...f, estimatedValueCents: c })} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2"><FormError message={error} /></div>
      </form>
    </Modal>
  )
}

function ConvertModal({ lead, onClose, onDone }: { lead: Lead | null; onClose: () => void; onDone: (memberId: string) => void }) {
  const toast = useToast()
  const { money, can } = useSession()
  const { plans } = useLookups()
  const [planId, setPlanId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [collectNow, setCollectNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setPlanId(''); setError(null); setCollectNow(true) }, [lead?.id])
  if (!lead) return null
  const plan = plans.find((p) => p.id === planId)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ memberId: string }>(`/api/leads/${lead.id}/convert`, { body: { planId: planId || null, paymentMethod, collectNow: !!plan && plan.priceCents > 0 && paymentMethod !== 'card' && collectNow } })
      toast.success(`${lead.name} is now a member`)
      onClose()
      onDone(result.memberId)
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Convert ${lead.name}`} description="Creates their member profile and carries over their details." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Convert to member</Button></>}>
      <div className="space-y-4">
        {can('memberships.manage') && (
          <Field label="Membership" hint="You can also sell one later from their profile.">
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">No membership yet</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {planPriceLabel(p, money)}</option>)}
            </Select>
          </Field>
        )}
        {plan && plan.priceCents > 0 && (
          <>
            <Field label="Paid by"><Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== 'account_credit').map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select></Field>
            {paymentMethod !== 'card' && plan.trialDays === 0 && <Checkbox checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} label="First payment received now" />}
          </>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  )
}

export default function LeadsPage() {
  return <Suspense><Pipeline /></Suspense>
}
