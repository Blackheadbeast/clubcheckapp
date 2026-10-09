'use client'

// Payroll: the pay periods, what each one comes to, and the way in to the one being worked on.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, SkeletonRows, Stat, Table, Td, Th, useToast } from '@/components/ui'
import { Amount, PeriodStatus, range } from '@/components/payroll/shared'

interface Period { id: string; name: string; startDate: string; endDate: string; status: string; locked: boolean; current: boolean; staffCount: number; baseCents: number; commissionCents: number; reversalCents: number; adjustmentCents: number; totalCents: number }
interface Data { periods: Period[]; currentId: string | null; suggestion: { startDate: string; endDate: string }; today: string; can: { manage: boolean; reopen: boolean } }

export default function PayrollPage() {
  const { can, money } = useSession()
  const router = useRouter()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<Data>(can('payroll.view') ? '/api/payroll/periods' : null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ startDate: '', endDate: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  if (!can('payroll.view')) {
    return <Page width="narrow"><PageHeader title="Payroll" /><Card><EmptyState icon={<Wallet className="h-5 w-5" />} title="Not available for your role" description="Payroll is handled by the owner, managers and the accountant. Your own earnings are under My earnings." action={<Link href="/payroll/me"><Button variant="primary">My earnings</Button></Link>} /></Card></Page>
  }
  // Filled in as the form is opened, in the same step, so it never opens showing the last attempt.
  const startCreating = () => { if (data) { setForm({ ...data.suggestion, name: '' }); setProblem(null); setCreating(true) } }
  const create = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await api<{ id: string }>('/api/payroll/periods', { body: { startDate: form.startDate, endDate: form.endDate, name: form.name.trim() || null } })
      toast.success('Pay period created')
      router.push(`/payroll/${made.id}`)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const current = data?.periods.find((p) => p.id === data.currentId) || null
  return (
    <Page>
      <PageHeader title="Payroll" description="What staff have earned: base pay, commissions and adjustments, by pay period. Review it, approve it, lock it, export it."
        actions={<><Link href="/payroll/compensation"><Button>Compensation</Button></Link><Link href="/payroll/commission-plans"><Button>Commission plans</Button></Link>{data?.can.manage && <Button variant="primary" onClick={startCreating}>New pay period</Button>}</>} />
      {loading ? <Card padded={false}><SkeletonRows rows={6} /></Card> : error || !data ? <Card><ErrorState error={error || 'Could not load payroll'} onRetry={reload} /></Card> : data.periods.length === 0 ? (
        <Card><EmptyState icon={<Wallet className="h-5 w-5" />} title="No pay periods yet" description="Payroll starts with your first pay period. Sales, appointments and classes from its first day onwards are worked out from what is already on record. Set up how each person is paid first." action={<div className="flex flex-wrap justify-center gap-2"><Link href="/payroll/compensation"><Button>Set up compensation</Button></Link>{data.can.manage && <Button variant="primary" onClick={startCreating}>Create the first pay period</Button>}</div>} /></Card>
      ) : (
        <div className="space-y-5">
          {current && (
            <section aria-label="Current pay period">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold text-fg-heading">{current.current ? 'Current pay period' : 'Open pay period'}: {range(current.startDate, current.endDate)}</h2>
                <PeriodStatus status={current.status} />
                <Link href={`/payroll/${current.id}`} className="ui-focus ml-auto rounded text-sm font-medium text-accent-text hover:underline">Review earnings</Link>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Total payable" value={<Amount cents={current.totalCents} money={money} strong />} hint={`${current.staffCount} ${current.staffCount === 1 ? 'person' : 'people'}`} />
                <Stat label="Base pay" value={<Amount cents={current.baseCents} money={money} strong />} />
                <Stat label="Commissions" value={<Amount cents={current.commissionCents} money={money} strong />} />
                <Stat label="Refund reversals" value={<Amount cents={current.reversalCents} money={money} strong />} />
                <Stat label="Adjustments" value={<Amount cents={current.adjustmentCents} money={money} strong />} />
              </div>
            </section>
          )}
          <Card padded={false}>
            <CardHeader title="Pay periods" className="px-4 pt-4 sm:px-5" />
            <Table className="mt-2">
              <thead><tr><Th>Period</Th><Th>Status</Th><Th align="right">People</Th><Th align="right">Base pay</Th><Th align="right">Commissions</Th><Th align="right">Reversals</Th><Th align="right">Adjustments</Th><Th align="right">Total payable</Th></tr></thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.id} className="hover:bg-subtle/50">
                    <Td><Link href={`/payroll/${p.id}`} className="ui-focus rounded font-medium text-fg-heading hover:underline">{range(p.startDate, p.endDate)}</Link>{p.current && <span className="ml-2 text-xs text-fg-muted">now</span>}</Td>
                    <Td><PeriodStatus status={p.status} /></Td>
                    <Td align="right">{p.staffCount}</Td>
                    <Td align="right"><Amount cents={p.baseCents} money={money} /></Td>
                    <Td align="right"><Amount cents={p.commissionCents} money={money} /></Td>
                    <Td align="right"><Amount cents={p.reversalCents} money={money} /></Td>
                    <Td align="right"><Amount cents={p.adjustmentCents} money={money} /></Td>
                    <Td align="right"><Amount cents={p.totalCents} money={money} strong /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New pay period" description="Earnings dated inside these days are paid in this period. Periods cannot overlap."
        footer={<><Button onClick={() => setCreating(false)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!form.startDate || !form.endDate} onClick={create}>Create pay period</Button></>}>
        <div className="space-y-3">
          {problem && <FormError message={problem} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First day" required><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Last day" required><Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
          </div>
          <Field label="Name (optional)" hint="Left blank, it is named after its dates."><Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        </div>
      </Modal>
    </Page>
  )
}
