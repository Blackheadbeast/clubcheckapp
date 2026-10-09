'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Zap } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, Select, SkeletonRows, StatusBadge, Textarea, cn, useToast } from '@/components/ui'
import { DeliveryNotice } from '@/components/DeliveryNotice'

interface Trigger { key: string; category?: 'operational' | 'marketing'; label: string; description: string; audience: 'member' | 'lead'; kind: 'event' | 'scheduled'; condition?: { key: string; label: string; default: number }; defaultSubject: string; defaultBody: string }
interface Automation { id: string; name: string; trigger: string; conditions: Record<string, number> | null; delayMinutes: number; channel: string; subject: string | null; body: string; isActive: boolean; last30: { sent: number; pending: number; skipped: number; failed: number } }
interface Payload { automations: Automation[]; triggers: Trigger[]; mergeTags: { tag: string; label: string }[]; delivery: { email: boolean; sms: boolean } }
interface Run { id: string; status: string; runAt: string; executedAt: string | null; error: string | null; recipient: string }

const DELAYS = [[0, 'Immediately'], [60, '1 hour later'], [180, '3 hours later'], [1440, '1 day later'], [2880, '2 days later'], [4320, '3 days later'], [10080, '1 week later']] as const
const unit = (key: string) => (key === 'hoursBefore' ? 'hours before' : key === 'minutesBefore' ? 'minutes before' : 'days')
const delayLabel = (minutes: number) => DELAYS.find(([m]) => m === minutes)?.[1] || `${Math.round(minutes / 60)} hours later`

export default function AutomationsPage() {
  const toast = useToast()
  const { dateTime } = useSession()
  const { data, error, loading, reload } = useApi<Payload>('/api/automations')
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)
  const [f, setF] = useState({ name: '', trigger: 'lead_created', delayMinutes: 0, channel: 'email', subject: '', body: '', isActive: true, condition: 0 })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const runs = useApi<{ runs: Run[] }>(editing && editing !== 'new' ? `/api/automations/${editing.id}` : null)
  const triggers = data?.triggers || []
  const trigger = triggers.find((t) => t.key === f.trigger)

  useEffect(() => {
    if (!editing) return
    setProblem(null)
    if (editing === 'new') {
      const t = triggers[0]
      setF({ name: '', trigger: t?.key || 'lead_created', delayMinutes: 0, channel: 'email', subject: t?.defaultSubject || '', body: t?.defaultBody || '', isActive: true, condition: t?.condition?.default || 0 })
    } else {
      const t = triggers.find((x) => x.key === editing.trigger)
      setF({ name: editing.name, trigger: editing.trigger, delayMinutes: editing.delayMinutes, channel: editing.channel, subject: editing.subject || '', body: editing.body, isActive: editing.isActive, condition: (t?.condition && editing.conditions?.[t.condition.key]) || t?.condition?.default || 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const pickTrigger = (key: string) => {
    const t = triggers.find((x) => x.key === key)!
    setF((prev) => ({ ...prev, trigger: key, condition: t.condition?.default || 0, ...(editing === 'new' ? { subject: t.defaultSubject, body: t.defaultBody, name: prev.name || t.label } : {}) }))
  }
  const toggle = async (a: Automation) => {
    try {
      await api(`/api/automations/${a.id}`, { method: 'PATCH', body: { isActive: !a.isActive } })
      toast.success(`${a.name} turned ${a.isActive ? 'off' : 'on'}`)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const body = { name: f.name || trigger?.label || 'Automation', trigger: f.trigger, delayMinutes: f.delayMinutes, channel: f.channel, subject: f.channel !== 'sms' ? f.subject : null, body: f.body, isActive: f.isActive, conditions: trigger?.condition ? { [trigger.condition.key]: f.condition || trigger.condition.default } : null }
      if (editing === 'new') await api('/api/automations', { body })
      else await api(`/api/automations/${(editing as Automation).id}`, { method: 'PATCH', body })
      toast.success('Automation saved')
      setEditing(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api(`/api/automations/${(editing as Automation).id}`, { method: 'DELETE' })
      toast.success('Automation deleted')
      setRemoving(false)
      setEditing(null)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Automations" description="Messages that send themselves when something happens." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New automation</Button>} />
      <DeliveryNotice delivery={data?.delivery} />
      {loading ? <Card padded={false}><SkeletonRows /></Card> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.automations.length === 0 ? (
        <Card><EmptyState icon={<Zap className="h-5 w-5" />} title="No automations yet" description="An automation sends a message by itself when something happens: a welcome when someone joins, a nudge after two weeks away, a reminder before a renewal." action={<Button variant="primary" onClick={() => setEditing('new')}>New automation</Button>} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.automations.map((a) => {
            const t = triggers.find((x) => x.key === a.trigger)
            return (
              <Card key={a.id} className={cn(!a.isActive && 'opacity-75')}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setEditing(a)} className="ui-focus min-w-0 rounded text-left">
                    <p className="font-semibold text-fg-heading hover:underline">{a.name}</p>
                    <p className="mt-0.5 text-sm text-fg-muted">When: {t?.description || a.trigger}{t?.condition && a.conditions?.[t.condition.key] ? ` (${a.conditions[t.condition.key]} ${unit(t.condition.key)})` : ''}</p>
                    <p className="text-sm text-fg-muted">Then: {a.channel === 'sms' ? 'text' : a.channel === 'both' ? 'email and text' : 'email'} the {t?.audience || 'member'} {delayLabel(a.delayMinutes).toLowerCase()}</p>
                  </button>
                  <button type="button" role="switch" aria-checked={a.isActive} aria-label={`${a.name} is ${a.isActive ? 'on' : 'off'}`} onClick={() => toggle(a)} className={cn('ui-hit ui-focus relative h-6 w-11 shrink-0 rounded-full transition', a.isActive ? 'bg-emerald-500' : 'bg-line')}>
                    <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', a.isActive ? 'left-[22px]' : 'left-0.5')} />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-fg-muted">
                  <Badge tone={a.isActive ? 'green' : 'neutral'}>{a.isActive ? 'On' : 'Off'}</Badge>
                  <span>Last 30 days: {a.last30.sent} sent</span>
                  {a.last30.pending > 0 && <span>· {a.last30.pending} waiting</span>}
                  {a.last30.skipped > 0 && <span>· {a.last30.skipped} skipped</span>}
                  {a.last30.failed > 0 && <span className="text-red-600 dark:text-red-400">· {a.last30.failed} failed</span>}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={!!editing && !removing} onClose={() => setEditing(null)} size="lg" title={editing === 'new' ? 'New automation' : 'Edit automation'} footer={<>{editing !== 'new' && <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(true)}>Delete</Button>}<Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="automation" loading={busy}>Save</Button></>}>
        <form id="automation" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="When this happens" hint={trigger?.description} className="sm:col-span-2">
            <Select value={f.trigger} onChange={(e) => pickTrigger(e.target.value)}>
              <optgroup label="Leads">{triggers.filter((t) => t.audience === 'lead').map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>
              <optgroup label="Members">{triggers.filter((t) => t.audience === 'member').map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>
            </Select>
          </Field>
          {trigger?.condition && <Field label={trigger.condition.label}><Input type="number" min={1} max={trigger.condition.key === 'minutesBefore' ? 1440 : trigger.condition.key === 'hoursBefore' ? 720 : 365} value={f.condition} onChange={(e) => setF({ ...f, condition: Number(e.target.value) })} /></Field>}
          <Field label="Send"><Select value={f.delayMinutes} onChange={(e) => setF({ ...f, delayMinutes: Number(e.target.value) })}>{DELAYS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}{!DELAYS.some(([m]) => m === f.delayMinutes) && <option value={f.delayMinutes}>{delayLabel(f.delayMinutes)}</option>}</Select></Field>
          <Field label="By"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="email">Email</option><option value="sms">Text message (SMS)</option><option value="both">Email and text</option></Select></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder={trigger?.label} /></Field>
          {f.channel !== 'sms' && <Field label="Subject" required className="sm:col-span-2"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required maxLength={200} /></Field>}
          <Field label="Message" required className="sm:col-span-2" hint={<span>Merge tags: {(data?.mergeTags || []).map((t) => `{{${t.tag}}}`).join(' ')}</span>}><Textarea rows={7} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required maxLength={5000} /></Field>
          {f.channel !== 'email' && <p className="text-xs text-fg-subtle sm:col-span-2">{trigger?.category === 'operational' ? 'Texts from this automation go to members who agreed to reminders by text.' : 'This counts as marketing: texts only go to people who agreed to offers and news by text.'} Anyone who replied STOP is skipped. Keep texts short; over 160 characters is sent as several.</p>}
          {(trigger?.key === 'appointment_reminder' || trigger?.key === 'appointment_soon') && <p className="text-xs text-fg-subtle sm:col-span-2">Timed from the appointment's start. If the appointment moves the reminder moves with it, if it is cancelled the reminder is dropped, and a reminder that could not go out in time is never sent late.</p>}
          {trigger?.kind === 'scheduled' && <p className="text-xs text-fg-subtle sm:col-span-2">This trigger is checked by the scheduled job (daily by default), so messages go out at the next run after the condition becomes true. Each person gets it once per occurrence.</p>}
          <div className="sm:col-span-2"><FormError message={problem} /></div>
          {editing !== 'new' && runs.data && runs.data.runs.length > 0 && (
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-medium text-fg-muted">Recent runs</p>
              <ul className="max-h-44 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line text-sm">
                {runs.data.runs.map((r) => <li key={r.id} className="flex items-center gap-3 px-3 py-1.5"><span className="min-w-0 flex-1 truncate">{r.recipient}</span>{r.error && <span className="truncate text-xs text-fg-subtle">{r.error}</span>}<span className="text-xs text-fg-subtle">{dateTime(r.executedAt || r.runAt)}</span><StatusBadge status={r.status} /></li>)}
              </ul>
            </div>
          )}
        </form>
      </Modal>
      <ConfirmModal open={removing} onClose={() => setRemoving(false)} onConfirm={remove} loading={busy} danger title="Delete this automation?" confirmLabel="Delete"><p>Messages it already sent stay in each member's history.</p></ConfirmModal>
    </Page>
  )
}
