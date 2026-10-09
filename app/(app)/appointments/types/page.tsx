'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ClipboardList, Plus } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, Input, Modal, MoneyInput, Page, PageHeader, Select, SkeletonRows, Table, Td, Textarea, Th, useToast } from '@/components/ui'
import { costLabel, type TypeOption } from '@/components/appointments/AppointmentModals'

interface Full extends TypeOption { taxRateBps: number; requiredPlanIds: string[]; locationIds: string[]; slotIntervalMin: number; memberReschedule: boolean }
const blank = { name: '', description: '', color: '#8b5cf6', durationMin: 60, paymentMode: 'credit' as 'included' | 'credit' | 'paid', priceCents: 0, taxRateBps: 0, creditsRequired: 1, requiredPlanIds: [] as string[], locationIds: [] as string[], cancelWindowHours: 12, minNoticeMinutes: 120, maxAdvanceDays: 30, slotIntervalMin: 30, memberBookable: true, memberReschedule: true, isActive: true, staffIds: [] as string[] }
type Draft = typeof blank & { id?: string }
const PRESETS = [{ name: '60 Minute Personal Training', durationMin: 60, paymentMode: 'credit' as const }, { name: '30 Minute Personal Training', durationMin: 30, paymentMode: 'credit' as const }, { name: 'Free Consultation', durationMin: 30, paymentMode: 'included' as const }, { name: 'Fitness Assessment', durationMin: 45, paymentMode: 'included' as const }, { name: 'Nutrition Consultation', durationMin: 45, paymentMode: 'paid' as const }]

export default function AppointmentTypesPage() {
  const { money, can } = useSession()
  const toast = useToast()
  const lookups = useLookups()
  const { data, error, loading, reload } = useApi<Full[]>('/api/appointments/types?all=1')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const manage = can('appointments.configure')
  const packages = lookups.plans.filter((p) => p.type === 'pt_package')
  const staffChoices = lookups.coaches.length ? lookups.coaches : lookups.staff

  useEffect(() => { setProblem(null) }, [draft?.id])
  const edit = (t: Full) => setDraft({ ...blank, ...t, description: t.description || '', staffIds: t.staff.map((s) => s.id) })
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft) return
    setBusy(true)
    setProblem(null)
    try {
      const { id, ...body } = draft
      await api(id ? `/api/appointments/types/${id}` : '/api/appointments/types', { method: id ? 'PATCH' : 'POST', body: { ...body, description: body.description || null } })
      toast.success(id ? 'Appointment type saved' : `${draft.name} created`)
      setDraft(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const setActive = async (t: Full, isActive: boolean) => {
    try {
      await api(`/api/appointments/types/${t.id}`, isActive ? { method: 'PATCH', body: { isActive: true } } : { method: 'DELETE' })
      toast.success(isActive ? `${t.name} is bookable again` : `${t.name} switched off`)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }
  const d = draft

  return (
    <Page>
      <Link href="/appointments" className="ui-focus mb-3 inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Appointments</Link>
      <PageHeader title="Appointment types" description="What can be booked one-to-one, who offers it, and the rules for booking and cancelling." actions={manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft({ ...blank })}>New type</Button>} />
      <Card padded={false}>
        {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No appointment types yet" description="Start from a common one and adjust it."
            action={manage ? <div className="flex flex-wrap justify-center gap-2">{PRESETS.map((p) => <Button key={p.name} onClick={() => setDraft({ ...blank, ...p })}>{p.name}</Button>)}</div> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Appointment</Th><Th>Length</Th><Th>Cost</Th><Th>Offered by</Th><Th>Cancel by</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                  <Td><span className="flex items-center gap-2 font-medium text-fg-heading"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />{t.name}</span>{t.description && <span className="block max-w-xs truncate pl-[1.125rem] text-xs text-fg-muted">{t.description}</span>}</Td>
                  <Td className="tabular text-fg-muted">{t.durationMin} min</Td>
                  <Td>{costLabel(t, money)}</Td>
                  <Td className="max-w-[14rem] truncate text-fg-muted">{t.staff.length ? t.staff.map((s) => s.name).join(', ') : <span className="text-amber-700 dark:text-amber-400">Nobody yet</span>}</Td>
                  <Td className="tabular text-fg-muted">{t.cancelWindowHours}h before</Td>
                  <Td>{t.isActive ? (t.memberBookable ? <Badge tone="green">Members can book</Badge> : <Badge>Staff only</Badge>) : <Badge>Off</Badge>}</Td>
                  <Td align="right">{manage && <span className="flex justify-end gap-2"><Button size="sm" onClick={() => edit(t)}>Edit</Button><Button size="sm" onClick={() => setActive(t, !t.isActive)}>{t.isActive ? 'Switch off' : 'Switch on'}</Button></span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {d && (
        <Modal open onClose={() => setDraft(null)} title={d.id ? 'Edit appointment type' : 'New appointment type'} size="lg" footer={<><Button onClick={() => setDraft(null)} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="appointment-type" loading={busy}>{d.id ? 'Save' : 'Create'}</Button></>}>
          <form id="appointment-type" onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" required className="sm:col-span-2"><Input value={d.name} onChange={(e) => setDraft({ ...d, name: e.target.value })} required maxLength={80} placeholder="60 Minute Personal Training" /></Field>
              <Field label="Colour"><input type="color" value={d.color} onChange={(e) => setDraft({ ...d, color: e.target.value })} className="ui-focus h-9 w-full cursor-pointer rounded-lg border border-line bg-surface p-1" /></Field>
              <Field label="Description" className="sm:col-span-3"><Textarea rows={2} value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} maxLength={1000} /></Field>
              <Field label="Length (minutes)"><Input type="number" min={10} max={480} step={5} value={d.durationMin} onChange={(e) => setDraft({ ...d, durationMin: Number(e.target.value) || 0 })} required /></Field>
              <Field label="Start times every"><Select value={d.slotIntervalMin} onChange={(e) => setDraft({ ...d, slotIntervalMin: Number(e.target.value) })}>{[15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}</Select></Field>
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold text-fg-heading">How it is paid for</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Payment"><Select value={d.paymentMode} onChange={(e) => setDraft({ ...d, paymentMode: e.target.value as Draft['paymentMode'] })}><option value="credit">Session credits (package)</option><option value="paid">Pay per appointment</option><option value="included">Included, no charge</option></Select></Field>
                {d.paymentMode === 'credit' && <Field label="Credits per appointment"><Input type="number" min={1} max={20} value={d.creditsRequired} onChange={(e) => setDraft({ ...d, creditsRequired: Number(e.target.value) || 1 })} /></Field>}
                {d.paymentMode === 'paid' && <Field label="Price"><MoneyInput cents={d.priceCents} onChange={(priceCents) => setDraft({ ...d, priceCents })} /></Field>}
                {d.paymentMode === 'paid' && <Field label="Tax rate (%)" hint="0 uses the gym default."><Input type="number" min={0} max={30} step={0.01} value={d.taxRateBps / 100} onChange={(e) => setDraft({ ...d, taxRateBps: Math.round((parseFloat(e.target.value) || 0) * 100) })} /></Field>}
              </div>
              {d.paymentMode === 'credit' ? (
                packages.length === 0 ? <p className="text-xs text-amber-700 dark:text-amber-400">You have no session packages yet. Create a plan of type "PT package" under Memberships so members have credits to spend.</p> : (
                  <div><p className="mb-1.5 text-xs font-medium text-fg-muted">Credits come from (leave all unticked to accept any PT package)</p><div className="flex flex-wrap gap-x-4 gap-y-2">{packages.map((p) => <Checkbox key={p.id} checked={d.requiredPlanIds.includes(p.id)} onChange={() => setDraft({ ...d, requiredPlanIds: toggle(d.requiredPlanIds, p.id) })} label={p.name} />)}</div></div>
                )
              ) : lookups.plans.length > 0 && (
                <div><p className="mb-1.5 text-xs font-medium text-fg-muted">Only for members on (leave all unticked for everyone)</p><div className="flex flex-wrap gap-x-4 gap-y-2">{lookups.plans.map((p) => <Checkbox key={p.id} checked={d.requiredPlanIds.includes(p.id)} onChange={() => setDraft({ ...d, requiredPlanIds: toggle(d.requiredPlanIds, p.id) })} label={p.name} />)}</div></div>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold text-fg-heading">Booking and cancelling</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Minimum notice (hours)" hint="How soon a member can book."><Input type="number" min={0} max={336} step={0.5} value={d.minNoticeMinutes / 60} onChange={(e) => setDraft({ ...d, minNoticeMinutes: Math.round((parseFloat(e.target.value) || 0) * 60) })} /></Field>
                <Field label="Book up to (days ahead)"><Input type="number" min={1} max={365} value={d.maxAdvanceDays} onChange={(e) => setDraft({ ...d, maxAdvanceDays: Number(e.target.value) || 1 })} /></Field>
                <Field label="Free cancellation until (hours before)" hint="Later than this the credit or payment is kept."><Input type="number" min={0} max={336} value={d.cancelWindowHours} onChange={(e) => setDraft({ ...d, cancelWindowHours: Number(e.target.value) || 0 })} /></Field>
              </div>
              <Checkbox checked={d.memberBookable} onChange={(e) => setDraft({ ...d, memberBookable: e.target.checked })} label="Members can book this themselves" />
              <Checkbox checked={d.memberReschedule} onChange={(e) => setDraft({ ...d, memberReschedule: e.target.checked })} label="Members can reschedule it themselves (up to the cancellation deadline)" />
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-fg-heading">Who offers it</legend>
              {staffChoices.length === 0 ? <p className="text-sm text-fg-muted">Add staff first.</p> : <div className="flex flex-wrap gap-x-4 gap-y-2">{staffChoices.map((s) => <Checkbox key={s.id} checked={d.staffIds.includes(s.id)} onChange={() => setDraft({ ...d, staffIds: toggle(d.staffIds, s.id) })} label={s.name} />)}</div>}
              <p className="mt-1.5 text-xs text-fg-subtle">Their bookable hours are set under <Link href="/appointments/availability" className="font-medium text-accent-text hover:underline">Availability</Link>.</p>
            </fieldset>
            {lookups.locations.length > 1 && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold text-fg-heading">Where (leave all unticked for any location)</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">{lookups.locations.map((l) => <Checkbox key={l.id} checked={d.locationIds.includes(l.id)} onChange={() => setDraft({ ...d, locationIds: toggle(d.locationIds, l.id) })} label={l.name} />)}</div>
              </fieldset>
            )}
            <FormError message={problem} />
          </form>
        </Modal>
      )}
    </Page>
  )
}
