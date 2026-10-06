'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Copy, Plus, Trash2, UserCog } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { ASSIGNABLE_ROLES, ROLES } from '@/lib/permissions'
import { timeAgo } from '@/lib/format'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, Input, Modal, Page, PageHeader, Select, SkeletonRows, Table, Tabs, Td, Textarea, Th, useToast } from '@/components/ui'

interface Staff { id: string; name: string; email: string; role: string; roleLabel: string; active: boolean; lastLoginAt: string | null; phone: string | null; title: string | null; bio: string | null; isCoach: boolean; locationId: string | null; location: { name: string } | null; classesThisWeek: number }
const EMPTY = { name: '', email: '', password: '', role: 'front_desk', phone: '', title: '', bio: '', isCoach: false, locationId: '', active: true }

function StaffList() {
  const params = useSearchParams()
  const toast = useToast()
  const { user } = useSession()
  const { locations, reload: reloadLookups } = useLookups()
  const { data, error, loading, reload } = useApi<{ staff: Staff[]; gymCode: string | null; ownerEmail: string }>('/api/staff')
  const [tab, setTab] = useState<'all' | 'coaches' | 'inactive'>(params.get('coaches') ? 'coaches' : 'all')
  const [editing, setEditing] = useState<Staff | 'new' | null>(null)
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  useEffect(() => { setTab(params.get('coaches') ? 'coaches' : 'all') }, [params])
  useEffect(() => {
    if (!editing) return
    setProblem(null)
    setF(editing === 'new' ? { ...EMPTY, isCoach: tab === 'coaches', role: tab === 'coaches' ? 'coach' : 'front_desk' } : { name: editing.name, email: editing.email, password: '', role: editing.role, phone: editing.phone || '', title: editing.title || '', bio: editing.bio || '', isCoach: editing.isCoach, locationId: editing.locationId || '', active: editing.active })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const all = data?.staff || []
  const coaches = all.filter((s) => s.active && (s.isCoach || ['coach', 'trainer'].includes(s.role)))
  const rows = tab === 'coaches' ? coaches : tab === 'inactive' ? all.filter((s) => !s.active) : all.filter((s) => s.active)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const body = { ...f, locationId: f.locationId || null, ...(f.password ? {} : { password: undefined }) }
      if (editing === 'new') await api('/api/staff', { body })
      else await api(`/api/staff/${(editing as Staff).id}`, { method: 'PATCH', body })
      toast.success(editing === 'new' ? `${f.name} can now sign in` : 'Saved')
      setEditing(null)
      reload()
      reloadLookups()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api(`/api/staff/${(editing as Staff).id}`, { method: 'DELETE' })
      toast.success('Staff account deleted')
      setRemoving(false)
      setEditing(null)
      reload()
      reloadLookups()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const self = editing && editing !== 'new' && user.type === 'staff' && user.id === editing.id

  return (
    <Page>
      <PageHeader title="Staff" description="Everyone who signs in to ClubCheck, and what they can do." actions={<><Link href="/staff/permissions"><Button>View permissions</Button></Link><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add staff</Button></>} />
      {data?.gymCode && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm"><p className="font-medium text-fg-heading">Staff sign in at <span className="font-mono">/staff-login</span> with gym code <span className="rounded bg-subtle px-1.5 py-0.5 font-mono font-semibold">{data.gymCode}</span></p><p className="text-fg-muted">The account owner ({data.ownerEmail}) signs in on the main login page.</p></div>
          <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard?.writeText(data.gymCode!).then(() => toast.success('Gym code copied'), () => toast.error('Could not copy'))}>Copy code</Button>
        </Card>
      )}
      <Tabs tabs={[{ key: 'all', label: 'Employees', count: all.filter((s) => s.active).length }, { key: 'coaches', label: 'Coaches', count: coaches.length }, { key: 'inactive', label: 'Deactivated', count: all.filter((s) => !s.active).length }]} value={tab} onChange={setTab} />
      <Card padded={false}>
        {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<UserCog className="h-5 w-5" />} title={tab === 'inactive' ? 'No deactivated accounts' : tab === 'coaches' ? 'No coaches yet' : 'No staff yet'} description={tab === 'inactive' ? undefined : 'Give each person their own sign-in so every action is recorded under their name.'} action={tab !== 'inactive' ? <Button variant="primary" onClick={() => setEditing('new')}>Add staff</Button> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Location</Th>{tab === 'coaches' && <Th align="right">Classes this week</Th>}<Th>Last sign-in</Th><Th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-60'}>
                  <Td><div className="flex items-center gap-3"><Avatar name={s.name} /><div className="min-w-0"><p className="font-medium text-fg-heading">{s.name}</p><p className="text-xs text-fg-muted">{s.title ? `${s.title} · ` : ''}{s.email}</p></div></div></Td>
                  <Td><Badge tone={['admin', 'manager'].includes(s.role) ? 'violet' : 'neutral'}>{s.roleLabel}</Badge>{s.isCoach && !['coach', 'trainer'].includes(s.role) && <Badge className="ml-1">Coaches</Badge>}</Td>
                  <Td className="text-fg-muted">{s.location?.name || 'All locations'}</Td>
                  {tab === 'coaches' && <Td align="right">{s.classesThisWeek}</Td>}
                  <Td className="text-fg-muted">{timeAgo(s.lastLoginAt)}</Td>
                  <Td align="right"><Button size="sm" onClick={() => setEditing(s)}>Edit</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!editing && !removing} onClose={() => setEditing(null)} size="lg" title={editing === 'new' ? 'Add staff' : `Edit ${(editing as Staff | null)?.name || ''}`} footer={<>{editing !== 'new' && !self && <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(true)}>Delete</Button>}<Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="staff" loading={busy}>Save</Button></>}>
        <form id="staff" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Job title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Head Coach, Front Desk…" /></Field>
          <Field label="Email (their sign-in)" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="off" /></Field>
          <Field label={editing === 'new' ? 'Password' : 'New password'} required={editing === 'new'} hint={editing === 'new' ? 'At least 8 characters. Share it with them privately.' : 'Leave blank to keep their current password.'}><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={editing === 'new'} minLength={8} autoComplete="new-password" /></Field>
          <Field label="Role" hint={ROLES[f.role as keyof typeof ROLES]?.description} className="sm:col-span-2">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, isCoach: ['coach', 'trainer'].includes(e.target.value) ? true : f.isCoach })} disabled={!!self}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
            </Select>
          </Field>
          <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {locations.length > 0 && <Field label="Home location"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
          <Field label="Bio" hint="Shown to members on the class schedule." className="sm:col-span-2"><Textarea rows={2} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={1000} /></Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox checked={f.isCoach} onChange={(e) => setF({ ...f, isCoach: e.target.checked })} label="Coaches classes (can be assigned to the schedule)" />
            {editing !== 'new' && !self && <Checkbox checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} label="Account is active (can sign in)" />}
          </div>
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>
      <ConfirmModal open={removing} onClose={() => setRemoving(false)} onConfirm={remove} loading={busy} danger title="Delete this staff account?" confirmLabel="Delete"><p>They lose access immediately. Classes they coach become unassigned and their past actions stay in the audit log. To keep their history tidy, deactivating is usually enough.</p></ConfirmModal>
    </Page>
  )
}

export default function StaffPage() {
  return <Suspense><StaffList /></Suspense>
}
