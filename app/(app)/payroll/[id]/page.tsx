'use client'

// One pay period: what each person earned, the lines behind it, adjustments and hours, and the
// steps from open to locked. Everything on this page is read from the earnings ledger.

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ChevronLeft, Download, Lock, RefreshCw } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, FormError, Input, Modal, MoneyInput, Page, PageHeader, Select, SkeletonRows, Stat, Table, Td, Textarea, Th, useToast } from '@/components/ui'
import { ADJUSTMENT_LABELS, Amount, Lines, PeriodStatus, STATUS, day, hours, range, type Line } from '@/components/payroll/shared'

interface StaffRow { staffId: string; staffName: string; active: boolean; baseCents: number; commissionCents: number; reversalCents: number; adjustmentCents: number; totalCents: number; lines: number; minutes: number }
interface Totals { baseCents: number; commissionCents: number; reversalCents: number; adjustmentCents: number; totalCents: number }
interface Detail {
  id: string; name: string; startDate: string; endDate: string; status: string; locked: boolean; notes: string | null
  submittedAt: string | null; submittedByName: string | null; approvedAt: string | null; approvedByName: string | null; finalizedAt: string | null; finalizedByName: string | null; reopenedAt: string | null; reopenedByName: string | null; reopenReason: string | null
  staff: StaffRow[]; totals: Totals; carriedLines: number; integrity: { ok: boolean; lockedTotalCents: number | null } | null
  events: { id: string; type: string; at: string; actorName: string | null; metadata: Record<string, unknown> | null }[]
  roster: { id: string; name: string; role: string; hourly: boolean }[]; locations: { id: string; name: string }[]; can: { manage: boolean; reopen: boolean }
}
interface StaffDetail { staff: { id: string; name: string; active: boolean }; totals: Totals; lines: Line[]; time: { id: string; workDate: string; minutes: number; note: string | null; voided: boolean; createdByName: string | null }[] }

const EVENTS: Record<string, string> = {
  period_created: 'Period created', period_submitted: 'Sent for review', period_sent_back: 'Sent back to open', period_approved: 'Approved', period_finalized: 'Finalized and locked', period_reopened: 'Reopened',
  adjustment_added: 'Adjustment added', hours_added: 'Hours added', hours_removed: 'Hours removed', period_exported: 'Exported',
}
const STEPS: Record<string, { title: string; body: string; button: string; done: string }> = {
  submit: { title: 'Send for review?', body: 'Earnings are brought up to date and the period moves to review. Adjustments and hours can still be added.', button: 'Send for review', done: 'Sent for review' },
  send_back: { title: 'Send back to open?', body: 'The period goes back to open. Nothing is removed.', button: 'Send back', done: 'Sent back to open' },
  approve: { title: 'Approve this pay period?', body: 'Earnings are brought up to date one last time. After approval nothing more is added to this period: anything that arrives later, including refunds, is paid in the next one.', button: 'Approve', done: 'Pay period approved' },
  finalize: { title: 'Finalize and lock?', body: 'The approved totals are recorded and the period is locked. Only the owner or an admin can reopen it, and that is recorded.', button: 'Finalize and lock', done: 'Pay period finalized' },
}

export default function PayPeriodPage() {
  const { id } = useParams<{ id: string }>()
  const { can, money, date, dateTime } = useSession()
  const toast = useToast()
  const [locationId, setLocationId] = useState('')
  const { data, error, loading, reload } = useApi<Detail>(can('payroll.view') ? `/api/payroll/periods/${id}${locationId ? `?locationId=${locationId}` : ''}` : null)
  const [step, setStep] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null | false>(false)
  const [timing, setTiming] = useState<string | null | false>(false)
  const [version, setVersion] = useState(0)

  if (!can('payroll.view')) return <Page width="narrow"><PageHeader title="Payroll" /><Card><EmptyState title="Not available for your role" description="Your own earnings are under My earnings." action={<Link href="/payroll/me"><Button variant="primary">My earnings</Button></Link>} /></Card></Page>
  if (loading && !data) return <Page><Card padded={false}><SkeletonRows rows={8} /></Card></Page>
  if (error || !data) return <Page><Card><ErrorState error={error || 'Pay period not found'} onRetry={reload} /></Card></Page>

  const changed = () => { reload(); setVersion((v) => v + 1) }
  const run = async (action: string) => {
    setBusy(action)
    setProblem(null)
    try {
      const r = await api<{ changed: boolean }>(`/api/payroll/periods/${id}`, { body: action === 'reopen' ? { action, reason: reason.trim() } : { action } })
      toast.success(action === 'sync' ? 'Earnings are up to date' : action === 'reopen' ? 'Pay period reopened' : r.changed ? STEPS[action].done : 'Already done')
      setStep(null); setReason('')
      changed()
    } catch (err) {
      setProblem((err as ClientError).message)
      if (action === 'sync') toast.error((err as ClientError).message)
      reload()
    } finally {
      setBusy(null)
    }
  }
  const manage = data.can.manage
  const editable = manage && !data.locked
  const exportUrl = (format: string) => `/api/payroll/periods/${id}/export?format=${format}`
  const linkButton = 'ui-focus inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-fg hover:bg-subtle'

  return (
    <Page>
      <PageHeader
        back={<Link href="/payroll" className="ui-focus inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Payroll</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{range(data.startDate, data.endDate)}<PeriodStatus status={data.status} /></span>}
        description={STATUS[data.status]?.help}
        actions={
          <>
            <a href={exportUrl('summary')} className={linkButton}><Download className="h-4 w-4" aria-hidden />Export summary</a>
            <a href={exportUrl('detail')} className={linkButton}><Download className="h-4 w-4" aria-hidden />Export lines</a>
            {editable && <Button icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'sync'} onClick={() => run('sync')}>Refresh</Button>}
            {editable && <Button onClick={() => setTiming(null)}>Add hours</Button>}
            {editable && <Button onClick={() => setAdjusting(null)}>Add adjustment</Button>}
            {manage && data.status === 'open' && <Button variant="primary" onClick={() => setStep('submit')}>Send for review</Button>}
            {manage && data.status === 'review' && <><Button onClick={() => setStep('send_back')}>Send back</Button><Button variant="primary" onClick={() => setStep('approve')}>Approve</Button></>}
            {manage && data.status === 'approved' && <Button variant="primary" icon={<Lock className="h-4 w-4" />} onClick={() => setStep('finalize')}>Finalize and lock</Button>}
            {data.can.reopen && data.locked && <Button onClick={() => setStep('reopen')}>Reopen</Button>}
          </>
        }
      />
      <div className="space-y-5">
        {data.integrity && !data.integrity.ok && (
          <p className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />The total locked at finalization was {money(data.integrity.lockedTotalCents || 0)}, but the lines on record now add up differently. Do not pay from this page until that is explained.</p>
        )}
        {data.status === 'finalized' && data.integrity?.ok && <p className="flex items-center gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted"><Lock className="h-4 w-4 shrink-0" aria-hidden />Finalized {data.finalizedAt ? dateTime(data.finalizedAt) : ''}{data.finalizedByName ? ` by ${data.finalizedByName}` : ''}. The lines on record match the locked total.</p>}
        {data.reopenedAt && !data.locked && <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-fg dark:border-amber-800/50 dark:bg-amber-950/30">Reopened {dateTime(data.reopenedAt)}{data.reopenedByName ? ` by ${data.reopenedByName}` : ''}: {data.reopenReason}</p>}
        {data.carriedLines > 0 && <p className="rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted">{data.carriedLines} line{data.carriedLines === 1 ? ' is' : 's are'} carried from an earlier period that was already locked when {data.carriedLines === 1 ? 'it' : 'they'} arrived.</p>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Total payable" value={<Amount cents={data.totals.totalCents} money={money} strong />} hint={`${data.staff.length} ${data.staff.length === 1 ? 'person' : 'people'}`} />
          <Stat label="Base pay" value={<Amount cents={data.totals.baseCents} money={money} strong />} />
          <Stat label="Commissions" value={<Amount cents={data.totals.commissionCents} money={money} strong />} />
          <Stat label="Refund reversals" value={<Amount cents={data.totals.reversalCents} money={money} strong />} />
          <Stat label="Adjustments" value={<Amount cents={data.totals.adjustmentCents} money={money} strong />} />
        </div>

        <Card padded={false}>
          <CardHeader title="Earnings by person" description="Select someone to see every line behind their figure." className="px-4 pt-4 sm:px-5"
            action={data.locations.length > 1 ? <Select aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-44"><option value="">All locations</option>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select> : undefined} />
          {data.staff.length === 0 ? <EmptyState title="Nothing earned yet" description={locationId ? 'Nothing at this location in this period.' : 'Earnings appear as sales are paid, appointments are completed and classes are taught. Set up pay rates and commission plans under Compensation.'} action={<Link href="/payroll/compensation"><Button>Compensation</Button></Link>} /> : (
            <Table className="mt-2">
              <thead><tr><Th>Person</Th><Th align="right">Hours</Th><Th align="right">Base pay</Th><Th align="right">Commissions</Th><Th align="right">Reversals</Th><Th align="right">Adjustments</Th><Th align="right">Total payable</Th></tr></thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.staffId} className="hover:bg-subtle/50">
                    <Td><button type="button" onClick={() => setOpen(s.staffId)} className="ui-focus rounded text-left font-medium text-fg-heading hover:underline">{s.staffName}</button>{!s.active && <span className="ml-2 text-xs text-fg-muted">no longer active</span>}</Td>
                    <Td align="right">{s.minutes ? hours(s.minutes) : <span className="text-fg-subtle">–</span>}</Td>
                    <Td align="right"><Amount cents={s.baseCents} money={money} /></Td>
                    <Td align="right"><Amount cents={s.commissionCents} money={money} /></Td>
                    <Td align="right"><Amount cents={s.reversalCents} money={money} /></Td>
                    <Td align="right"><Amount cents={s.adjustmentCents} money={money} /></Td>
                    <Td align="right"><Amount cents={s.totalCents} money={money} strong /></Td>
                  </tr>
                ))}
                <tr className="bg-subtle/40"><Td className="font-semibold text-fg-heading">Total</Td><Td /><Td align="right"><Amount cents={data.totals.baseCents} money={money} strong /></Td><Td align="right"><Amount cents={data.totals.commissionCents} money={money} strong /></Td><Td align="right"><Amount cents={data.totals.reversalCents} money={money} strong /></Td><Td align="right"><Amount cents={data.totals.adjustmentCents} money={money} strong /></Td><Td align="right"><Amount cents={data.totals.totalCents} money={money} strong /></Td></tr>
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <CardHeader title="Activity" description="Everything done to this pay period. This record is only ever added to." className="px-4 pt-4 sm:px-5" />
          <ol className="mt-2 divide-y divide-line/60 border-t border-line" aria-label="Activity">
            {data.events.map((e) => {
              const m = e.metadata || {}
              const extra = e.type === 'adjustment_added' ? `${ADJUSTMENT_LABELS[String(m.adjustmentType)] || 'Adjustment'} for ${m.staffName}: ${typeof m.amountCents === 'number' ? (m.amountCents < 0 ? `−${money(-m.amountCents)}` : money(m.amountCents)) : ''} · ${m.reason}`
                : e.type === 'hours_added' || e.type === 'hours_removed' ? `${m.staffName ? `${m.staffName}: ` : ''}${hours(Number(m.minutes) || 0)} on ${day(String(m.workDate))}`
                : e.type === 'period_reopened' ? String(m.reason || '') : e.type === 'period_exported' ? (m.format === 'detail' ? 'Lines' : 'Summary') : typeof m.totalCents === 'number' ? `Total ${money(m.totalCents)}` : ''
              return <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm sm:px-5"><span className="font-medium text-fg-heading">{EVENTS[e.type] || e.type}</span>{extra && <span className="min-w-0 break-words text-fg">{extra}</span>}<span className="ml-auto text-xs text-fg-muted">{dateTime(e.at)}{e.actorName ? ` · ${e.actorName}` : ''}</span></li>
            })}
          </ol>
        </Card>
      </div>

      <Modal open={!!step} onClose={() => { setStep(null); setProblem(null) }} title={step === 'reopen' ? 'Reopen this pay period?' : step ? STEPS[step].title : ''}
        footer={<><Button onClick={() => { setStep(null); setProblem(null) }} disabled={!!busy}>Cancel</Button><Button variant="primary" loading={!!busy} disabled={step === 'reopen' && reason.trim().length < 3} onClick={() => step && run(step)}>{step === 'reopen' ? 'Reopen' : step ? STEPS[step].button : ''}</Button></>}>
        <div className="space-y-3 text-sm text-fg">
          {problem && <FormError message={problem} />}
          {step === 'reopen' ? (
            <>
              <p>It goes back to review so it can be changed, and has to be approved and finalized again. Nothing already on record is removed, and the reopening is recorded with your name.</p>
              <Field label="Reason" required><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A bonus was left out" /></Field>
            </>
          ) : step ? (
            <>
              <p>{STEPS[step].body}</p>
              {(step === 'approve' || step === 'finalize') && <p className="rounded-lg bg-subtle px-3 py-2">Total payable: <Amount cents={data.totals.totalCents} money={money} strong /> for {data.staff.length} {data.staff.length === 1 ? 'person' : 'people'}.</p>}
            </>
          ) : null}
        </div>
      </Modal>
      <StaffModal periodId={id} staffId={open} version={version} editable={editable} money={money} date={date} onClose={() => setOpen(null)} onChanged={changed} onAdjust={(s) => setAdjusting(s)} onHours={(s) => setTiming(s)} />
      {/* Each form is mounted when it is opened, so it starts clean every time. */}
      {adjusting !== false && <AdjustmentModal periodId={id} staffId={adjusting || null} people={mergePeople(data)} onClose={() => setAdjusting(false)} onDone={changed} />}
      {timing !== false && <HoursModal periodId={id} staffId={timing || null} detail={data} onClose={() => setTiming(false)} onDone={changed} />}
    </Page>
  )
}

/** Everyone who can be adjusted: current staff, plus anyone who has left but has earnings in this period. */
function mergePeople(d: Detail) {
  const people = d.roster.map((s) => ({ id: s.id, name: s.name }))
  for (const s of d.staff) if (!people.some((p) => p.id === s.staffId)) people.push({ id: s.staffId, name: `${s.staffName} (no longer active)` })
  return people
}

function StaffModal({ periodId, staffId, version, editable, money, date, onClose, onChanged, onAdjust, onHours }: { periodId: string; staffId: string | null; version: number; editable: boolean; money: (c: number) => string; date: (v: string) => string; onClose: () => void; onChanged: () => void; onAdjust: (staffId: string) => void; onHours: (staffId: string) => void }) {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<StaffDetail>(staffId ? `/api/payroll/periods/${periodId}/staff/${staffId}?v=${version}` : null)
  const [busy, setBusy] = useState<string | null>(null)
  const remove = async (timeId: string) => {
    setBusy(timeId)
    try {
      await api(`/api/payroll/periods/${periodId}/time/${timeId}`, { method: 'DELETE' })
      toast.success('Hours removed')
      reload(); onChanged()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const live = data?.time.filter((t) => !t.voided) || []
  return (
    <Modal open={!!staffId} onClose={onClose} size="lg" title={data ? data.staff.name : 'Earnings'} description={data ? `Total payable ${data.totals.totalCents < 0 ? '−' : ''}${money(Math.abs(data.totals.totalCents))}` : undefined}
      footer={<>{editable && staffId && <><Button onClick={() => onHours(staffId)}>Add hours</Button><Button onClick={() => onAdjust(staffId)}>Add adjustment</Button></>}<Button variant="primary" onClick={onClose}>Close</Button></>}>
      {loading && !data ? <SkeletonRows rows={5} /> : error || !data ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {([['Base pay', data.totals.baseCents], ['Commissions', data.totals.commissionCents], ['Refund reversals', data.totals.reversalCents], ['Adjustments', data.totals.adjustmentCents]] as const).map(([label, cents]) => <div key={label}><dt className="text-xs text-fg-muted">{label}</dt><dd><Amount cents={cents} money={money} className="font-medium" /></dd></div>)}
          </dl>
          <Lines lines={data.lines} money={money} date={date} />
          {live.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-muted">Hours entered</p>
              <ul className="divide-y divide-line/60 rounded-lg border border-line" aria-label="Hours entered">
                {live.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"><span className="w-24 shrink-0 text-fg">{day(t.workDate, false)}</span><span className="tabular text-fg">{hours(t.minutes)}</span><span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{t.note || ''}{t.createdByName ? ` · entered by ${t.createdByName}` : ''}</span>{editable && <Button size="sm" variant="ghost" className="text-red-600" loading={busy === t.id} onClick={() => remove(t.id)}>Remove</Button>}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function AdjustmentModal({ periodId, staffId, people, onClose, onDone }: { periodId: string; staffId: string | null; people: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ staffId: staffId || '', type: 'bonus', amountCents: 0, direction: 'add', reason: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One key per time the form is opened: pressing the button twice, or retrying after a dropped connection, is still one adjustment.
  const [key] = useState(() => crypto.randomUUID())
  const takes = f.type === 'deduction' || (f.type !== 'bonus' && f.direction === 'subtract')
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch(`/api/payroll/periods/${periodId}/adjustments`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ staffId: f.staffId, type: f.type, amountCents: f.amountCents, direction: takes ? 'subtract' : 'add', reason: f.reason.trim() }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new ClientError(json?.error || 'Could not save the adjustment', res.status, json?.code)
      toast.success('Adjustment added')
      onDone(); onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Add adjustment" description="Added to this pay period as its own line, with your name and the reason. It cannot be edited afterwards; a mistake is corrected with another adjustment."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.staffId || f.amountCents <= 0 || f.reason.trim().length < 3} onClick={save}>Add adjustment</Button></>}>
      <div className="space-y-3">
        {problem && <FormError message={problem} />}
        <Field label="Person" required><Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" required><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(ADJUSTMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Amount" required><MoneyInput cents={f.amountCents} onChange={(amountCents) => setF({ ...f, amountCents })} aria-label="Amount" /></Field>
        </div>
        {f.type !== 'bonus' && f.type !== 'deduction' && <Field label="Effect on their pay"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="add">Adds to their pay</option><option value="subtract">Takes from their pay</option></Select></Field>}
        <Field label="Reason" required hint="Shown on the payroll record and in the export."><Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {f.amountCents > 0 && f.staffId && <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-fg" role="status">{takes ? 'Takes' : 'Adds'} <span className="font-semibold">${(f.amountCents / 100).toFixed(2)}</span> {takes ? 'from' : 'to'} {people.find((p) => p.id === f.staffId)?.name.replace(' (no longer active)', '')}&rsquo;s pay for this period.</p>}
      </div>
    </Modal>
  )
}

function HoursModal({ periodId, staffId, detail, onClose, onDone }: { periodId: string; staffId: string | null; detail: Detail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const hourly = detail.roster.filter((s) => s.hourly)
  const [f, setF] = useState(() => {
    const today = new Date().toLocaleDateString('en-CA')
    return { staffId: staffId && hourly.some((s) => s.id === staffId) ? staffId : '', workDate: today >= detail.startDate && today <= detail.endDate ? today : detail.endDate, hours: '', minutes: '', locationId: '', note: '' }
  })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const total = Math.round((parseFloat(f.hours) || 0) * 60) + (parseInt(f.minutes, 10) || 0)
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api(`/api/payroll/periods/${periodId}/time`, { body: { staffId: f.staffId, workDate: f.workDate, minutes: total, locationId: f.locationId || null, note: f.note.trim() || null } })
      toast.success('Hours added')
      onDone(); onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Add hours" description="For people paid by the hour. Each entry becomes a line of pay at their hourly rate."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.staffId || !f.workDate || total <= 0} onClick={save}>Add hours</Button></>}>
      {hourly.length === 0 ? <p className="text-sm text-fg-muted">Nobody is set up with an hourly rate. <Link href="/payroll/compensation" className="text-accent-text underline">Set it under Compensation</Link>.</p> : (
        <div className="space-y-3">
          {problem && <FormError message={problem} />}
          <Field label="Person" required><Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}><option value="">Choose…</option>{hourly.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date worked" required><Input type="date" value={f.workDate} min={detail.startDate} max={detail.endDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} /></Field>
            <Field label="Hours" required><Input inputMode="decimal" value={f.hours} placeholder="7.5" onChange={(e) => setF({ ...f, hours: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
            <Field label="Minutes"><Input inputMode="numeric" value={f.minutes} placeholder="0" onChange={(e) => setF({ ...f, minutes: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Field>
          </div>
          {detail.locations.length > 1 && <Field label="Location" hint="Used if they have a different rate there."><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">Their usual rate</option>{detail.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
          <Field label="Note (optional)"><Input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  )
}
