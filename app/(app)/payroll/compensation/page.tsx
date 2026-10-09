'use client'

// How each person is paid: base pay, rates per appointment and class, a different rate at
// another location, and the commission plan they are on.

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Trash2, Wallet } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { ROLES, type Role } from '@/lib/permissions'
import { Button, Card, EmptyState, ErrorState, Field, FormError, Input, Modal, MoneyInput, Page, PageHeader, Select, SkeletonRows, Table, Td, Th, useToast } from '@/components/ui'
import { day } from '@/components/payroll/shared'

interface Rates { basePay: string; hourlyRateCents: number; annualSalaryCents: number; flatPerPeriodCents: number; perSessionCents: number; perClassCents: number }
interface StaffRow extends Rates { id: string; name: string; email: string; role: string; active: boolean; title: string | null; notes: string | null; configured: boolean; overrides: (Rates & { locationId: string })[]; commissionPlanId: string | null; commissionPlanName: string | null; commissionSince: string | null }
interface Data { staff: StaffRow[]; plans: { id: string; name: string; isActive: boolean }[]; locations: { id: string; name: string; isActive: boolean }[]; can: { manage: boolean } }

const BASE: Record<string, string> = { none: 'No base pay', hourly: 'Hourly', salary: 'Salary', flat: 'Flat amount each pay period' }
const blankRates: Rates = { basePay: 'none', hourlyRateCents: 0, annualSalaryCents: 0, flatPerPeriodCents: 0, perSessionCents: 0, perClassCents: 0 }

/** A kind of base pay chosen without its figure. */
const missing = (r: Rates) => (r.basePay === 'hourly' && r.hourlyRateCents <= 0) || (r.basePay === 'salary' && r.annualSalaryCents <= 0) || (r.basePay === 'flat' && r.flatPerPeriodCents <= 0)

function summary(r: Rates, money: (c: number) => string) {
  const parts = [
    r.basePay === 'hourly' ? `${money(r.hourlyRateCents)}/hr` : r.basePay === 'salary' ? `${money(r.annualSalaryCents)}/yr` : r.basePay === 'flat' ? `${money(r.flatPerPeriodCents)} per period` : null,
    r.perSessionCents ? `${money(r.perSessionCents)} per appointment` : null,
    r.perClassCents ? `${money(r.perClassCents)} per class` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' + ') : null
}

/** The rate fields for one set of rates: only the one that goes with the chosen base pay is shown. */
function RateFields({ value, onChange, disabled, idPrefix }: { value: Rates; onChange: (r: Rates) => void; disabled: boolean; idPrefix: string }) {
  const set = (patch: Partial<Rates>) => onChange({ ...value, ...patch })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Base pay"><Select value={value.basePay} disabled={disabled} onChange={(e) => set({ basePay: e.target.value })}>{Object.entries(BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      {value.basePay === 'hourly' && <Field label="Hourly rate" required><MoneyInput cents={value.hourlyRateCents} disabled={disabled} onChange={(c) => set({ hourlyRateCents: c })} aria-label={`${idPrefix} hourly rate`} /></Field>}
      {value.basePay === 'salary' && <Field label="Salary per year" required hint="Paid by the day: a 14-day period pays 14/365 of it."><MoneyInput cents={value.annualSalaryCents} disabled={disabled} onChange={(c) => set({ annualSalaryCents: c })} aria-label={`${idPrefix} salary per year`} /></Field>}
      {value.basePay === 'flat' && <Field label="Amount each pay period" required><MoneyInput cents={value.flatPerPeriodCents} disabled={disabled} onChange={(c) => set({ flatPerPeriodCents: c })} aria-label={`${idPrefix} amount each pay period`} /></Field>}
      {value.basePay === 'none' && <span className="hidden sm:block" />}
      <Field label="Per completed appointment" hint="On top of base pay. 0 for none."><MoneyInput cents={value.perSessionCents} disabled={disabled} onChange={(c) => set({ perSessionCents: c })} aria-label={`${idPrefix} per completed appointment`} /></Field>
      <Field label="Per class taught" hint="On top of base pay. 0 for none."><MoneyInput cents={value.perClassCents} disabled={disabled} onChange={(c) => set({ perClassCents: c })} aria-label={`${idPrefix} per class taught`} /></Field>
    </div>
  )
}

export default function CompensationPage() {
  const { can, money } = useSession()
  const { data, error, loading, reload } = useApi<Data>(can('payroll.view') ? '/api/payroll/compensation' : null)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  if (!can('payroll.view')) return <Page width="narrow"><PageHeader title="Compensation" /><Card><EmptyState icon={<Wallet className="h-5 w-5" />} title="Not available for your role" /></Card></Page>
  return (
    <Page>
      <PageHeader back={<Link href="/payroll" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Payroll</Link>} title="Compensation" description="How each person is paid. A change applies to what is earned from now on; pay already on record is not rewritten."
        actions={<Link href="/payroll/commission-plans"><Button>Commission plans</Button></Link>} />
      <Card padded={false}>
        {loading ? <SkeletonRows rows={6} /> : error || !data ? <ErrorState error={error || 'Could not load compensation'} onRetry={reload} /> : data.staff.length === 0 ? <EmptyState icon={<Wallet className="h-5 w-5" />} title="No staff yet" description="Add staff under Staff, then set how they are paid here." /> : (
          <Table>
            <thead><tr><Th>Person</Th><Th>Role</Th><Th>Pay</Th><Th>Commission plan</Th><Th /></tr></thead>
            <tbody>
              {data.staff.map((s) => (
                <tr key={s.id} className="hover:bg-subtle/50">
                  <Td><span className="block font-medium text-fg-heading">{s.name}{!s.active && <span className="ml-2 text-xs font-normal text-fg-muted">no longer active</span>}</span><span className="block text-xs text-fg-muted">{s.title || s.email}</span></Td>
                  <Td>{ROLES[s.role as Role]?.label || s.role}</Td>
                  <Td>{summary(s, money) || <span className="text-fg-subtle">Not set</span>}{s.overrides.length > 0 && <span className="block text-xs text-fg-muted">Different at {s.overrides.map((o) => data.locations.find((l) => l.id === o.locationId)?.name || 'a location').join(', ')}</span>}</Td>
                  <Td>{s.commissionPlanName ? <><span className="block">{s.commissionPlanName}</span><span className="block text-xs text-fg-muted">since {day(s.commissionSince)}</span></> : <span className="text-fg-subtle">None</span>}</Td>
                  <Td align="right"><Button size="sm" onClick={() => setEditing(s)} aria-label={`${data.can.manage ? 'Edit' : 'View'} pay for ${s.name}`}>{data.can.manage ? 'Edit' : 'View'}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {/* Mounted afresh for each person, so the form can never start from someone else's figures. */}
      {data && editing && <EditModal key={editing.id} row={editing} data={data} onClose={() => setEditing(null)} onSaved={reload} />}
    </Page>
  )
}

function EditModal({ row, data, onClose, onSaved }: { row: StaffRow; data: Data; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [base, setBase] = useState<Rates>({ basePay: row.basePay, hourlyRateCents: row.hourlyRateCents, annualSalaryCents: row.annualSalaryCents, flatPerPeriodCents: row.flatPerPeriodCents, perSessionCents: row.perSessionCents, perClassCents: row.perClassCents })
  const [overrides, setOverrides] = useState<(Rates & { locationId: string })[]>(row.overrides)
  const [planId, setPlanId] = useState(row.commissionPlanId || '')
  const [notes, setNotes] = useState(row.notes || '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const readOnly = !data.can.manage
  const free = data.locations.filter((l) => !overrides.some((o) => o.locationId === l.id))
  // Only the figure that goes with the chosen kind of base pay is sent; the others are zero.
  const clean = (r: Rates) => ({ basePay: r.basePay, hourlyRateCents: r.basePay === 'hourly' ? r.hourlyRateCents : 0, annualSalaryCents: r.basePay === 'salary' ? r.annualSalaryCents : 0, flatPerPeriodCents: r.basePay === 'flat' ? r.flatPerPeriodCents : 0, perSessionCents: r.perSessionCents, perClassCents: r.perClassCents })
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ planChanged: boolean }>(`/api/payroll/compensation/${row.id}`, { method: 'PUT', body: { ...clean(base), notes: notes.trim() || null, overrides: overrides.map((o) => ({ locationId: o.locationId, ...clean(o) })), commissionPlanId: planId || null } })
      toast.success(r.planChanged ? 'Pay saved. The commission plan change starts today.' : 'Pay saved')
      onSaved(); onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={`Pay for ${row.name}`} description="Base pay, extra for each appointment and class, and commission can be combined."
      footer={readOnly ? <Button variant="primary" onClick={onClose}>Close</Button> : <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={[base, ...overrides].some(missing)} onClick={save}>Save pay</Button></>}>
      <div className="space-y-5">
        {problem && <FormError message={problem} />}
        <RateFields value={base} onChange={setBase} disabled={readOnly} idPrefix="Default" />
        <div className="space-y-3 border-t border-line pt-4">
          <Field label="Commission plan" hint={planId !== (row.commissionPlanId || '') ? 'Starts today. Sales and sessions before today keep the plan they were earned under.' : 'What they earn on sales, appointments and classes.'}>
            <Select value={planId} disabled={readOnly} onChange={(e) => setPlanId(e.target.value)}><option value="">No commission plan</option>{data.plans.filter((p) => p.isActive || p.id === row.commissionPlanId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? '' : ' (archived)'}</option>)}</Select>
          </Field>
          {data.plans.filter((p) => p.isActive).length === 0 && !readOnly && <p className="text-xs text-fg-muted">No commission plans yet. <Link href="/payroll/commission-plans" className="text-accent-text underline">Create one</Link>.</p>}
        </div>
        {(data.locations.length > 1 || overrides.length > 0) && (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-fg-heading">Different rates at a location</p>{!readOnly && free.length > 0 && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOverrides([...overrides, { ...base, locationId: free[0].id }])}>Add location rates</Button>}</div>
            {overrides.length === 0 ? <p className="text-sm text-fg-muted">The rates above apply wherever they work.</p> : overrides.map((o, i) => (
              <div key={o.locationId} className="space-y-3 rounded-lg border border-line p-3">
                <div className="flex items-end gap-2">
                  <Field label="Location" className="min-w-0 flex-1"><Select value={o.locationId} disabled={readOnly} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, locationId: e.target.value } : x)))}>{data.locations.filter((l) => l.id === o.locationId || free.some((f) => f.id === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
                  {!readOnly && <Button size="sm" variant="ghost" className="mb-0.5 text-red-600" aria-label="Remove location rates" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                <RateFields value={o} onChange={(r) => setOverrides(overrides.map((x, j) => (j === i ? { ...r, locationId: x.locationId } : x)))} disabled={readOnly} idPrefix={data.locations.find((l) => l.id === o.locationId)?.name || 'Location'} />
              </div>
            ))}
          </div>
        )}
        <Field label="Notes (managers only)"><Input value={notes} disabled={readOnly} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
