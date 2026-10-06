'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { planPriceLabel, useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, MoneyInput, Page, PageHeader, Select, SkeletonRows, Textarea, useToast } from '@/components/ui'

interface Plan {
  id: string; name: string; description: string | null; type: string; priceCents: number; billingInterval: string; intervalCount: number; trialDays: number
  contractMonths: number; enrollmentFeeCents: number; classLimit: number | null; classLimitPeriod: string; credits: number | null; expiresAfterDays: number | null
  freezeAllowed: boolean; maxFreezeDays: number; cancellationNoticeDays: number; autoRenew: boolean; taxRateBps: number; locationIds: string[]; classTypeIds: string[]
  isActive: boolean; isPublic: boolean; activeMembers: number
}

const TYPES: { key: string; label: string; blurb: string }[] = [
  { key: 'recurring', label: 'Recurring membership', blurb: 'Billed every week, month or year until cancelled.' },
  { key: 'class_pack', label: 'Class pack / punch card', blurb: 'A set number of classes, paid once.' },
  { key: 'drop_in', label: 'Drop-in', blurb: 'A single visit.' },
  { key: 'trial', label: 'Trial', blurb: 'A short introductory period, free or paid.' },
  { key: 'pt_package', label: 'Personal training package', blurb: 'A set number of 1:1 sessions.' },
  { key: 'free', label: 'Free / complimentary', blurb: 'Staff, family or sponsored members.' },
]
const GROUPS = [['recurring', 'Memberships'], ['class_pack', 'Class packs'], ['pt_package', 'Personal training'], ['drop_in', 'Drop-ins'], ['trial', 'Trials'], ['free', 'Complimentary']] as const

const EMPTY: Omit<Plan, 'id' | 'activeMembers'> = {
  name: '', description: '', type: 'recurring', priceCents: 0, billingInterval: 'month', intervalCount: 1, trialDays: 0, contractMonths: 0, enrollmentFeeCents: 0,
  classLimit: null, classLimitPeriod: 'month', credits: null, expiresAfterDays: null, freezeAllowed: true, maxFreezeDays: 90, cancellationNoticeDays: 0, autoRenew: true,
  taxRateBps: 0, locationIds: [], classTypeIds: [], isActive: true, isPublic: true,
}
const num = (v: string) => (v === '' ? null : Math.max(0, parseInt(v, 10) || 0))

export default function MembershipsPage() {
  const toast = useToast()
  const { can, money } = useSession()
  const lookups = useLookups()
  const { data, error, loading, reload } = useApi<Plan[]>('/api/membership-plans')
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Plan | null>(null)
  const manage = can('settings.manage')

  useEffect(() => {
    if (!editing) return
    setProblem(null)
    if (editing === 'new') setF(EMPTY)
    else {
      const { id: _id, activeMembers: _n, ...rest } = editing
      setF({ ...rest, description: rest.description || '' })
    }
  }, [editing])
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }))
  const recurring = f.type === 'recurring'
  const creditBased = ['class_pack', 'drop_in', 'pt_package'].includes(f.type)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const body = { ...f, description: f.description || null, credits: f.type === 'drop_in' ? f.credits || 1 : f.credits }
      if (editing === 'new') await api('/api/membership-plans', { body })
      else await api(`/api/membership-plans/${(editing as Plan).id}`, { method: 'PATCH', body })
      toast.success('Plan saved')
      setEditing(null)
      reload()
      lookups.reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const result = await api<{ archived: boolean }>(`/api/membership-plans/${removing.id}`, { method: 'DELETE' })
      toast.success(result.archived ? `${removing.name} retired. Current members keep it.` : `${removing.name} deleted`)
      setRemoving(null)
      reload()
      lookups.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  const facts = (p: Plan) => {
    const out: string[] = []
    if (p.type === 'recurring') out.push(p.classLimit ? `${p.classLimit} classes / ${p.classLimitPeriod}` : 'Unlimited classes')
    if (p.credits && p.type !== 'recurring') out.push(`${p.credits} session${p.credits === 1 ? '' : 's'}`)
    if (p.expiresAfterDays) out.push(`valid ${p.expiresAfterDays} days`)
    if (p.trialDays) out.push(`${p.trialDays}-day ${p.type === 'trial' ? 'trial' : 'free trial'}`)
    if (p.contractMonths) out.push(`${p.contractMonths}-month contract`)
    if (p.enrollmentFeeCents) out.push(`${money(p.enrollmentFeeCents)} enrollment`)
    if (p.cancellationNoticeDays) out.push(`${p.cancellationNoticeDays} days notice`)
    if (p.classTypeIds.length) out.push(`${p.classTypeIds.length} class type${p.classTypeIds.length === 1 ? '' : 's'} only`)
    if (p.locationIds.length) out.push(`${p.locationIds.length} location${p.locationIds.length === 1 ? '' : 's'} only`)
    return out.join(' · ')
  }

  return (
    <Page>
      <PageHeader title="Memberships" description="The plans, packs and passes you sell." actions={manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New plan</Button>} />
      {loading ? <Card padded={false}><SkeletonRows /></Card> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.length === 0 ? (
        <Card><EmptyState title="No membership plans yet" description="Create the memberships, class packs, drop-ins and trials you offer. Then sell them from any member's profile." action={manage && <Button variant="primary" onClick={() => setEditing('new')}>Create your first plan</Button>} /></Card>
      ) : (
        <div className="space-y-6">
          {GROUPS.map(([type, label]) => {
            const plans = data.filter((p) => p.type === type)
            if (plans.length === 0) return null
            return (
              <section key={type}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{label}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {plans.map((p) => (
                    <Card key={p.id} className={p.isActive ? '' : 'opacity-60'}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-fg-heading">{p.name}</p>
                          <p className="tabular mt-0.5 text-lg font-semibold text-fg-heading">{planPriceLabel(p, money)}</p>
                        </div>
                        {manage && <span className="flex shrink-0"><IconButton label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></IconButton>{p.isActive && <IconButton label={`Remove ${p.name}`} onClick={() => setRemoving(p)}><Trash2 className="h-4 w-4" /></IconButton>}</span>}
                      </div>
                      {p.description && <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{p.description}</p>}
                      <p className="mt-2 text-xs text-fg-subtle">{facts(p) || 'No restrictions'}</p>
                      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs">
                        <Link href={`/members?planId=${p.id}`} className="ui-focus rounded font-medium text-fg hover:underline">{p.activeMembers} member{p.activeMembers === 1 ? '' : 's'}</Link>
                        {!p.isActive && <Badge>Retired</Badge>}
                        {!p.isPublic && p.isActive && <Badge>Staff only</Badge>}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === 'new' ? 'New plan' : `Edit ${(editing as Plan | null)?.name || 'plan'}`} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="plan-form" loading={busy}>Save plan</Button></>}>
        <form id="plan-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind" hint={TYPES.find((t) => t.key === f.type)?.blurb} className="sm:col-span-2">
            <Select value={f.type} onChange={(e) => set('type', e.target.value)} disabled={editing !== 'new' && (editing as Plan | null)?.activeMembers !== 0}>
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} placeholder="Unlimited Monthly, 10-Class Pack…" /></Field>
          {f.type !== 'free' && <Field label="Price"><MoneyInput cents={f.priceCents} onChange={(c) => set('priceCents', c)} /></Field>}
          {recurring && (
            <Field label="Billed every">
              <div className="flex gap-2">
                <Input type="number" min={1} max={24} value={f.intervalCount} onChange={(e) => set('intervalCount', Math.max(1, Number(e.target.value)))} className="w-20" aria-label="Interval count" />
                <Select value={f.billingInterval} onChange={(e) => set('billingInterval', e.target.value)} aria-label="Interval"><option value="week">week(s)</option><option value="month">month(s)</option><option value="year">year(s)</option></Select>
              </div>
            </Field>
          )}
          {(creditBased || f.type === 'trial') && f.type !== 'drop_in' && (
            <Field label={f.type === 'pt_package' ? 'Sessions included' : 'Classes included'} hint={f.type === 'trial' ? 'Leave blank for unlimited classes during the trial.' : undefined}>
              <Input type="number" min={1} value={f.credits ?? ''} onChange={(e) => set('credits', num(e.target.value))} required={creditBased} />
            </Field>
          )}
          {!recurring && f.type !== 'free' && (
            <Field label={f.type === 'trial' ? 'Trial length (days)' : 'Expires after (days)'} hint={f.type === 'trial' ? undefined : 'Leave blank if it never expires.'}>
              {f.type === 'trial'
                ? <Input type="number" min={1} max={365} value={f.trialDays || ''} onChange={(e) => set('trialDays', num(e.target.value) || 0)} placeholder="7" />
                : <Input type="number" min={1} value={f.expiresAfterDays ?? ''} onChange={(e) => set('expiresAfterDays', num(e.target.value))} />}
            </Field>
          )}
          {recurring && (
            <>
              <Field label="Class limit" hint="Leave blank for unlimited.">
                <div className="flex gap-2">
                  <Input type="number" min={1} value={f.classLimit ?? ''} onChange={(e) => set('classLimit', num(e.target.value))} placeholder="Unlimited" aria-label="Class limit" />
                  <Select value={f.classLimitPeriod} onChange={(e) => set('classLimitPeriod', e.target.value)} aria-label="Limit period"><option value="week">per week</option><option value="month">per month</option></Select>
                </div>
              </Field>
              <Field label="Free trial (days)"><Input type="number" min={0} max={365} value={f.trialDays || ''} onChange={(e) => set('trialDays', num(e.target.value) || 0)} placeholder="None" /></Field>
              <Field label="Enrollment fee"><MoneyInput cents={f.enrollmentFeeCents} onChange={(c) => set('enrollmentFeeCents', c)} /></Field>
              <Field label="Contract length (months)" hint="Early cancellation needs a staff override."><Input type="number" min={0} max={60} value={f.contractMonths || ''} onChange={(e) => set('contractMonths', num(e.target.value) || 0)} placeholder="No contract" /></Field>
              <Field label="Cancellation notice (days)"><Input type="number" min={0} max={180} value={f.cancellationNoticeDays || ''} onChange={(e) => set('cancellationNoticeDays', num(e.target.value) || 0)} placeholder="None" /></Field>
              <Field label="Longest freeze (days)"><Input type="number" min={1} max={365} value={f.maxFreezeDays} onChange={(e) => set('maxFreezeDays', Math.max(1, Number(e.target.value)))} disabled={!f.freezeAllowed} /></Field>
            </>
          )}
          {f.type !== 'free' && <Field label="Tax rate (%)" hint="Leave at 0 to use your default rate."><Input type="number" min={0} max={30} step={0.01} value={f.taxRateBps / 100 || ''} onChange={(e) => set('taxRateBps', Math.round((parseFloat(e.target.value) || 0) * 100))} placeholder="0" /></Field>}
          <Field label="Description" hint="Shown to members." className="sm:col-span-2"><Textarea rows={2} value={f.description || ''} onChange={(e) => set('description', e.target.value)} maxLength={500} /></Field>

          {lookups.classTypes.length > 0 && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-xs font-medium text-fg-muted">Valid for these classes <span className="font-normal text-fg-subtle">(none ticked = all classes)</span></legend>
              <div className="grid gap-1.5 rounded-lg border border-line p-3 sm:grid-cols-3">
                {lookups.classTypes.map((t) => <Checkbox key={t.id} label={t.name} checked={f.classTypeIds.includes(t.id)} onChange={(e) => set('classTypeIds', e.target.checked ? [...f.classTypeIds, t.id] : f.classTypeIds.filter((x) => x !== t.id))} />)}
              </div>
            </fieldset>
          )}
          {lookups.locations.length > 1 && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-xs font-medium text-fg-muted">Valid at these locations <span className="font-normal text-fg-subtle">(none ticked = all locations)</span></legend>
              <div className="grid gap-1.5 rounded-lg border border-line p-3 sm:grid-cols-3">
                {lookups.locations.map((l) => <Checkbox key={l.id} label={l.name} checked={f.locationIds.includes(l.id)} onChange={(e) => set('locationIds', e.target.checked ? [...f.locationIds, l.id] : f.locationIds.filter((x) => x !== l.id))} />)}
              </div>
            </fieldset>
          )}
          <div className="space-y-2 sm:col-span-2">
            {recurring && <Checkbox checked={f.autoRenew} onChange={(e) => set('autoRenew', e.target.checked)} label="Renews automatically" />}
            {recurring && <Checkbox checked={f.freezeAllowed} onChange={(e) => set('freezeAllowed', e.target.checked)} label="Members can freeze this membership" />}
            <Checkbox checked={f.isPublic} onChange={(e) => set('isPublic', e.target.checked)} label="Show to members in the portal" />
            {editing !== 'new' && <Checkbox checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} label="Available for sale" />}
          </div>
          {editing !== 'new' && (editing as Plan | null)?.activeMembers ? <p className="text-xs text-fg-subtle sm:col-span-2">A new price applies to new sales. The {(editing as Plan).activeMembers} current member{(editing as Plan).activeMembers === 1 ? '' : 's'} keep the price they signed up at.</p> : null}
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} loading={busy} danger title={`Remove ${removing?.name}?`} confirmLabel="Remove">
        <p>{removing?.activeMembers ? `${removing.activeMembers} member${removing.activeMembers === 1 ? ' is' : 's are'} on this plan. It will be retired: they keep it and keep being billed, but it can't be sold again.` : 'If this plan has ever been sold it is retired rather than deleted, so billing history stays intact.'}</p>
      </ConfirmModal>
    </Page>
  )
}
