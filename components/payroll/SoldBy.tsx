'use client'

// Who is credited with selling a membership, for commission. Shown on the member's memberships
// to people who can see payroll; changed by people who manage it.

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, Field, FormError, Input, Modal, Select, useToast } from '@/components/ui'

interface Data { shares: { staffId: string; staffName: string; sharePercent: number }[]; staff: { id: string; name: string }[] }

export function SoldBy({ membershipId, planName }: { membershipId: string; planName: string }) {
  const { can } = useSession()
  const toast = useToast()
  const { data, reload } = useApi<Data>(can('payroll.view') ? `/api/memberships/${membershipId}/attribution` : null)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<{ staffId: string; sharePercent: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (!can('payroll.view') || !data) return null

  const total = rows.reduce((a, r) => a + (parseInt(r.sharePercent, 10) || 0), 0)
  const valid = rows.length === 0 || (total === 100 && rows.every((r) => r.staffId && parseInt(r.sharePercent, 10) > 0) && new Set(rows.map((r) => r.staffId)).size === rows.length)
  // Someone credited who has since left still shows by name.
  const people = [...data.staff, ...data.shares.filter((s) => !data.staff.some((p) => p.id === s.staffId)).map((s) => ({ id: s.staffId, name: `${s.staffName} (no longer active)` }))]
  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api(`/api/memberships/${membershipId}/attribution`, { method: 'PUT', body: { shares: rows.map((r) => ({ staffId: r.staffId, sharePercent: parseInt(r.sharePercent, 10) })) } })
      toast.success('Sale credit saved')
      reload(); setOpen(false)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-0.5 text-xs text-fg-subtle">
      {data.shares.length ? `Sold by ${data.shares.map((s) => `${s.staffName}${data.shares.length > 1 ? ` (${s.sharePercent}%)` : ''}`).join(', ')}` : 'Sale not credited to anyone'}
      {can('payroll.manage') && <button type="button" onClick={() => { setRows(data.shares.map((s) => ({ staffId: s.staffId, sharePercent: String(s.sharePercent) }))); setProblem(null); setOpen(true) }} className="ui-focus ml-2 rounded font-medium text-accent-text hover:underline" aria-label={`Change who sold ${planName}`}>Change</button>}
      <Modal open={open} onClose={() => setOpen(false)} title={`Who sold ${planName}?`} description="Commission on this membership goes to these people, including renewals. A change applies to payments payroll has not yet worked out; commission already on record stays where it is."
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Save</Button></>}>
        <span className="block space-y-3">
          {problem && <FormError message={problem} />}
          {rows.length === 0 && <span className="block text-sm text-fg-muted">Nobody is credited, so no commission is paid on it.</span>}
          {rows.map((r, i) => (
            <span key={i} className="flex items-end gap-2">
              <Field label="Person" className="min-w-0 flex-1"><Select value={r.staffId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, staffId: e.target.value } : x)))}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <Field label="Share %" className="w-24"><Input inputMode="numeric" value={r.sharePercent} aria-label={`Share for person ${i + 1}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sharePercent: e.target.value.replace(/\D/g, '').slice(0, 3) } : x)))} /></Field>
              <Button size="sm" variant="ghost" className="mb-0.5 text-red-600" aria-label={`Remove person ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </span>
          ))}
          <span className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={rows.length >= 5} onClick={() => setRows([...rows, { staffId: '', sharePercent: rows.length === 0 ? '100' : String(Math.max(0, 100 - total)) }])}>Add person</Button>
            {rows.length > 0 && <span className={`text-sm ${total === 100 ? 'text-fg-muted' : 'text-red-600'}`} role="status">Shares add up to {total}%{total === 100 ? '' : ': they must come to 100%'}</span>}
          </span>
        </span>
      </Modal>
    </div>
  )
}
