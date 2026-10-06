'use client'

import { useEffect, useState } from 'react'
import { MapPin, Pencil, Plus } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, Page, PageHeader, SkeletonRows, useToast } from '@/components/ui'

interface Location { id: string; name: string; address: string | null; city: string | null; state: string | null; postalCode: string | null; phone: string | null; isActive: boolean; memberCount: number; staffCount: number }
const EMPTY = { name: '', address: '', city: '', state: '', postalCode: '', phone: '', isActive: true }

export default function LocationsPage() {
  const toast = useToast()
  const session = useSession()
  const { data, error, loading, reload } = useApi<Location[]>('/api/locations?all=1')
  const [editing, setEditing] = useState<Location | 'new' | null>(null)
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (editing) { setProblem(null); setF(editing === 'new' ? EMPTY : { name: editing.name, address: editing.address || '', city: editing.city || '', state: editing.state || '', postalCode: editing.postalCode || '', phone: editing.phone || '', isActive: editing.isActive }) } }, [editing])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      if (editing === 'new') { const { isActive: _a, ...body } = f; await api('/api/locations', { body }) }
      else await api(`/api/locations/${(editing as Location).id}`, { method: 'PATCH', body: f })
      toast.success('Location saved')
      setEditing(null)
      reload()
      session.reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Locations" description="Each location has its own classes, staff and reporting. Members can use any location their membership allows." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add location</Button>} />
      {loading ? <Card padded={false}><SkeletonRows rows={3} /></Card> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.length === 0 ? (
        <Card><EmptyState icon={<MapPin className="h-5 w-5" />} title="No locations yet" description="Add your gym as the first location. With two or more, a location switcher appears in the top bar and reports can be split by location." action={<Button variant="primary" onClick={() => setEditing('new')}>Add location</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((l) => (
            <Card key={l.id} className={l.isActive ? '' : 'opacity-60'}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-semibold text-fg-heading">{l.name} {!l.isActive && <Badge>Closed</Badge>}</p><p className="mt-1 text-sm text-fg-muted">{[l.address, l.city, l.state, l.postalCode].filter(Boolean).join(', ') || 'No address'}</p>{l.phone && <p className="text-sm text-fg-muted">{l.phone}</p>}</div>
                <IconButton label={`Edit ${l.name}`} onClick={() => setEditing(l)}><Pencil className="h-4 w-4" /></IconButton>
              </div>
              <p className="mt-3 border-t border-line pt-3 text-xs text-fg-subtle">{l.memberCount} home member{l.memberCount === 1 ? '' : 's'} · {l.staffCount} staff</p>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add location' : 'Edit location'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="location" loading={busy}>Save</Button></>}>
        <form id="location" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Downtown" /></Field>
          <Field label="Street address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4"><Field label="State"><Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></Field><Field label="Postal code"><Input value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} /></Field></div>
          <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {editing !== 'new' && <div className="flex items-end pb-2"><Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Open (appears in the app)" /></div>}
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>
    </Page>
  )
}
