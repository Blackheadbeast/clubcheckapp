'use client'

// Commission plans: named sets of rules ("10% of membership sales, $15 per class") that staff are put on.

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Percent, Plus, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, Input, Modal, MoneyInput, Page, PageHeader, Select, SkeletonRows, useToast } from '@/components/ui'

interface Rule { trigger: string; rateType: string; percentBps: number; flatCents: number; planIds: string[]; appointmentTypeIds: string[]; classTypeIds: string[]; includeNoShow: boolean; summary?: string }
interface Plan { id: string; name: string; description: string | null; isActive: boolean; rules: Rule[]; staff: { id: string; name: string; since: string }[] }
interface Options { plans: { id: string; name: string; type: string }[]; appointmentTypes: { id: string; name: string }[]; classTypes: { id: string; name: string }[] }
interface Data { plans: Plan[]; options: Options; can: { manage: boolean } }

const TRIGGERS: Record<string, { label: string; flat: string; percent: string | null }> = {
  membership_sale: { label: 'Membership sales', flat: 'per membership sold', percent: 'of the first payment' },
  membership_upgrade: { label: 'Membership upgrades', flat: 'per upgrade', percent: 'of the upgrade charge' },
  membership_renewal: { label: 'Membership renewals', flat: 'per renewal paid', percent: 'of each renewal' },
  package_sale: { label: 'Packages, class packs and drop-ins', flat: 'per package sold', percent: 'of the sale' },
  appointment: { label: 'Appointments delivered', flat: 'per completed appointment', percent: 'of what the member paid' },
  class: { label: 'Classes taught', flat: 'per class taught', percent: null },
}
const PACKAGES = ['class_pack', 'drop_in', 'pt_package']
const blankRule: Rule = { trigger: 'membership_sale', rateType: 'percent', percentBps: 1000, flatCents: 0, planIds: [], appointmentTypeIds: [], classTypeIds: [], includeNoShow: false }

export default function CommissionPlansPage() {
  const { can } = useSession()
  const { data, error, loading, reload } = useApi<Data>(can('payroll.view') ? '/api/payroll/commission-plans' : null)
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  if (!can('payroll.view')) return <Page width="narrow"><PageHeader title="Commission plans" /><Card><EmptyState icon={<Percent className="h-5 w-5" />} title="Not available for your role" /></Card></Page>
  const manage = !!data?.can.manage
  return (
    <Page>
      <PageHeader back={<Link href="/payroll" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Payroll</Link>} title="Commission plans" description="Commission is worked out on money actually received, before tax, and taken back in proportion if it is refunded."
        actions={<><Link href="/payroll/compensation"><Button>Compensation</Button></Link>{manage && <Button variant="primary" onClick={() => setEditing('new')}>New commission plan</Button>}</>} />
      {loading ? <Card padded={false}><SkeletonRows rows={4} /></Card> : error || !data ? <Card><ErrorState error={error || 'Could not load commission plans'} onRetry={reload} /></Card> : data.plans.length === 0 ? (
        <Card><EmptyState icon={<Percent className="h-5 w-5" />} title="No commission plans yet" description="For example: 10% of membership sales and $5 per renewal for the sales team, or $15 per class for coaches." action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Create a commission plan</Button> : undefined} /></Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Commission plans">
          {data.plans.map((p) => (
            <li key={p.id}>
              <Card className="h-full">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><h2 className="break-words text-base font-semibold text-fg-heading">{p.name}</h2>{p.description && <p className="mt-0.5 text-sm text-fg-muted">{p.description}</p>}</div>
                  <div className="flex shrink-0 items-center gap-2">{!p.isActive && <Badge>Archived</Badge>}<Button size="sm" onClick={() => setEditing(p)} aria-label={`${manage ? 'Edit' : 'View'} ${p.name}`}>{manage ? 'Edit' : 'View'}</Button></div>
                </div>
                {p.rules.length === 0 ? <p className="mt-3 text-sm text-fg-muted">No rules: nothing is earned on this plan.</p> : <ul className="mt-3 space-y-1 text-sm text-fg">{p.rules.map((r, i) => <li key={i} className="flex gap-2"><span className="text-fg-subtle" aria-hidden>•</span><span>{r.summary}{scope(r, data.options)}{r.includeNoShow ? ', including no-shows' : ''}</span></li>)}</ul>}
                <p className="mt-3 border-t border-line pt-3 text-xs text-fg-muted">{p.staff.length ? `On this plan: ${p.staff.map((s) => s.name).join(', ')}` : 'Nobody is on this plan. Put people on it under Compensation.'}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data && editing && <PlanModal key={editing === 'new' ? 'new' : editing.id} plan={editing} options={data.options} readOnly={!manage} onClose={() => setEditing(null)} onSaved={reload} />}
    </Page>
  )
}

function scope(r: Rule, o: Options) {
  const names = (ids: string[], from: { id: string; name: string }[]) => ids.map((id) => from.find((x) => x.id === id)?.name).filter(Boolean).join(', ')
  const only = r.planIds.length ? names(r.planIds, o.plans) : r.appointmentTypeIds.length ? names(r.appointmentTypeIds, o.appointmentTypes) : r.classTypeIds.length ? names(r.classTypeIds, o.classTypes) : ''
  return only ? ` (${only} only)` : ''
}

function PlanModal({ plan, options, readOnly, onClose, onSaved }: { plan: Plan | 'new'; options: Options; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const existing = plan === 'new' ? null : plan
  const [name, setName] = useState(existing?.name || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [isActive, setActive] = useState(existing ? existing.isActive : true)
  const [rules, setRules] = useState<Rule[]>(existing ? existing.rules.map((r) => ({ ...r })) : [{ ...blankRule }])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const setRule = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const invalid = rules.some((r) => (r.rateType === 'percent' ? r.percentBps <= 0 || r.percentBps > 10_000 : r.flatCents <= 0))
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const body = { name: name.trim(), description: description.trim() || null, isActive, rules: rules.map(({ summary: _s, ...r }) => r) }
      if (plan === 'new') await api('/api/payroll/commission-plans', { body })
      else await api(`/api/payroll/commission-plans/${plan.id}`, { method: 'PUT', body })
      toast.success(plan === 'new' ? 'Commission plan created' : 'Commission plan saved')
      onSaved(); onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={plan === 'new' ? 'New commission plan' : plan.name} description={plan !== 'new' ? 'Changes apply to what is earned from now on. Commission already on record keeps the rate it was worked out with.' : undefined}
      footer={readOnly ? <Button variant="primary" onClick={onClose}>Close</Button> : <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim() || invalid} onClick={save}>{plan === 'new' ? 'Create plan' : 'Save plan'}</Button></>}>
      <div className="space-y-4">
        {problem && <FormError message={problem} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan name" required><Input value={name} disabled={readOnly} maxLength={80} placeholder="Sales team" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description (optional)"><Input value={description} disabled={readOnly} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-fg-heading">Rules</p>{!readOnly && <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={rules.length >= 30} onClick={() => setRules([...rules, { ...blankRule }])}>Add rule</Button>}</div>
          {rules.length === 0 && <p className="text-sm text-fg-muted">No rules yet.</p>}
          {rules.map((r, i) => {
            const t = TRIGGERS[r.trigger]
            const membership = ['membership_sale', 'membership_upgrade', 'membership_renewal', 'package_sale'].includes(r.trigger)
            const plans = options.plans.filter((p) => (r.trigger === 'package_sale' ? PACKAGES.includes(p.type) : !PACKAGES.includes(p.type)))
            const key = membership ? 'planIds' : r.trigger === 'appointment' ? 'appointmentTypeIds' : 'classTypeIds'
            const items = membership ? plans : r.trigger === 'appointment' ? options.appointmentTypes : options.classTypes
            return (
              <div key={i} className="space-y-3 rounded-lg border border-line p-3" role="group" aria-label={`Rule ${i + 1}`}>
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem_8rem_auto] sm:items-end">
                  <Field label="Earned on"><Select value={r.trigger} disabled={readOnly} onChange={(e) => setRule(i, { trigger: e.target.value, planIds: [], appointmentTypeIds: [], classTypeIds: [], includeNoShow: false, ...(e.target.value === 'class' && r.rateType === 'percent' ? { rateType: 'flat', flatCents: r.flatCents || 1500 } : {}) })}>{Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
                  <Field label="Paid as"><Select value={r.rateType} disabled={readOnly || !t.percent} onChange={(e) => setRule(i, { rateType: e.target.value })}>{t.percent && <option value="percent">Percentage</option>}<option value="flat">Fixed amount</option></Select></Field>
                  {r.rateType === 'percent'
                    ? <Field label="Percent"><div className="relative"><Input inputMode="decimal" aria-label={`Rule ${i + 1} percent`} disabled={readOnly} value={r.percentBps ? String(r.percentBps / 100) : ''} onChange={(e) => { const n = parseFloat(e.target.value); setRule(i, { percentBps: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0 }) }} className="pr-7" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">%</span></div></Field>
                    : <Field label="Amount"><MoneyInput cents={r.flatCents} disabled={readOnly} onChange={(c) => setRule(i, { flatCents: c })} aria-label={`Rule ${i + 1} amount`} /></Field>}
                  {!readOnly && <Button size="sm" variant="ghost" className="mb-0.5 text-red-600" aria-label={`Remove rule ${i + 1}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                <p className="text-xs text-fg-muted">{r.rateType === 'percent' ? `${r.percentBps / 100}% ${t.percent}, before tax.` : `$${(r.flatCents / 100).toFixed(2)} ${t.flat}.`}{r.trigger === 'membership_renewal' ? ' Paid to whoever sold the membership.' : r.trigger === 'membership_upgrade' ? ' Paid to whoever made the change.' : ''}</p>
                {items.length > 0 && <Field label={membership ? 'Only for' : r.trigger === 'appointment' ? 'Only for' : 'Only for'}><Select value={(r[key] as string[])[0] || ''} disabled={readOnly} onChange={(e) => setRule(i, { [key]: e.target.value ? [e.target.value] : [] } as Partial<Rule>)}><option value="">{membership ? (r.trigger === 'package_sale' ? 'Any package' : 'Any membership') : r.trigger === 'appointment' ? 'Any appointment type' : 'Any class'}</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>}
                {r.trigger === 'appointment' && <Checkbox checked={r.includeNoShow} disabled={readOnly} onChange={() => setRule(i, { includeNoShow: !r.includeNoShow })} label="Also pay when the member does not show up" />}
              </div>
            )
          })}
        </div>
        {plan !== 'new' && !readOnly && <div className="border-t border-line pt-3"><Checkbox checked={!isActive} onChange={() => setActive(!isActive)} label={<span className="text-sm">Archived<span className="block text-xs text-fg-muted">Nothing new is earned on an archived plan, and nobody new can be put on it.</span></span>} /></div>}
      </div>
    </Modal>
  )
}
