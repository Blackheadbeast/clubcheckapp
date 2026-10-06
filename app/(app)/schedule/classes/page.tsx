'use client'

import { useEffect, useState } from 'react'
import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, Page, PageHeader, Select, SkeletonRows, Table, Td, Textarea, Th, useToast } from '@/components/ui'
import { SessionFormModal } from '@/components/schedule/SessionModals'

interface ClassType { id: string; name: string; description: string | null; category: string; color: string; defaultDurationMin: number; defaultCapacity: number; isActive: boolean; scheduleCount: number }
interface Schedule { id: string; daysOfWeek: number[]; startTime: string; durationMin: number; capacity: number; room: string | null; isActive: boolean; endDate: string | null; classType: { name: string; color: string }; coach: { name: string } | null; location: { name: string } | null }

const COLORS = ['#f59e0b', '#ef4444', '#10b981', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b']
const CATEGORIES = ['class', 'workshop', 'event', 'personal_training', 'open_gym']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EMPTY = { name: '', description: '', category: 'class', color: COLORS[0], defaultDurationMin: 60, defaultCapacity: 20, isActive: true }
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export default function ClassesPage() {
  const toast = useToast()
  const { can } = useSession()
  const types = useApi<ClassType[]>('/api/schedule/class-types')
  const schedules = useApi<Schedule[]>('/api/schedule/schedules')
  const [editing, setEditing] = useState<ClassType | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ClassType | null>(null)
  const [stopping, setStopping] = useState<Schedule | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const manage = can('classes.manage')

  useEffect(() => {
    if (!editing) return
    setError(null)
    setForm(editing === 'new' ? { ...EMPTY, color: COLORS[(types.data?.length || 0) % COLORS.length] } : { name: editing.name, description: editing.description || '', category: editing.category, color: editing.color, defaultDurationMin: editing.defaultDurationMin, defaultCapacity: editing.defaultCapacity, isActive: editing.isActive })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (editing === 'new') await api('/api/schedule/class-types', { body: form })
      else await api(`/api/schedule/class-types/${(editing as ClassType).id}`, { method: 'PATCH', body: form })
      toast.success('Class saved')
      setEditing(null)
      types.reload()
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const result = await api<{ archived: boolean }>(`/api/schedule/class-types/${removing.id}`, { method: 'DELETE' })
      toast.success(result.archived ? `${removing.name} retired. Its history is kept.` : `${removing.name} deleted`)
      setRemoving(null)
      types.reload()
      schedules.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (!stopping) return
    setBusy(true)
    try {
      const result = await api<{ keptWithBookings: number }>(`/api/schedule/schedules/${stopping.id}`, { method: 'DELETE' })
      toast.success(result.keptWithBookings ? `Stopped. ${result.keptWithBookings} upcoming session${result.keptWithBookings === 1 ? ' has' : 's have'} bookings and stayed on the calendar.` : 'Recurring class stopped')
      setStopping(null)
      schedules.reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  const activeSchedules = (schedules.data || []).filter((s) => s.isActive)

  return (
    <Page>
      <PageHeader title="Classes" description="The classes you offer, and when they repeat each week." actions={manage && <><Button icon={<Repeat className="h-4 w-4" />} onClick={() => setScheduling(true)}>Schedule a class</Button><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New class</Button></>} />

      <div className="space-y-4">
        <Card padded={false}>
          <CardHeader title="Class types" className="px-4 pt-4 sm:px-5" />
          {types.loading ? <SkeletonRows /> : types.error ? <ErrorState error={types.error} onRetry={types.reload} /> : !types.data || types.data.length === 0 ? (
            <EmptyState title="No classes yet" description="Add the classes, workshops and sessions you run, such as CrossFit, Yoga or Personal Training." action={manage && <Button variant="primary" onClick={() => setEditing('new')}>New class</Button>} />
          ) : (
            <Table>
              <thead><tr><Th>Class</Th><Th>Type</Th><Th align="right">Length</Th><Th align="right">Capacity</Th><Th align="right">Weekly schedules</Th><Th /></tr></thead>
              <tbody>
                {types.data.map((t) => (
                  <tr key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                        <div className="min-w-0">
                          <p className="font-medium text-fg-heading">{t.name} {!t.isActive && <Badge>Retired</Badge>}</p>
                          {t.description && <p className="max-w-md truncate text-xs text-fg-muted">{t.description}</p>}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-fg-muted">{titleCase(t.category)}</Td>
                    <Td align="right">{t.defaultDurationMin} min</Td>
                    <Td align="right">{t.defaultCapacity}</Td>
                    <Td align="right">{t.scheduleCount}</Td>
                    <Td align="right">
                      {manage && <span className="inline-flex gap-1"><IconButton label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></IconButton>{t.isActive && <IconButton label={`Remove ${t.name}`} onClick={() => setRemoving(t)}><Trash2 className="h-4 w-4" /></IconButton>}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false}>
          <CardHeader title="Weekly schedule" description="Recurring classes. Sessions are added to the calendar eight weeks ahead." className="px-4 pt-4 sm:px-5" />
          {schedules.loading ? <SkeletonRows /> : schedules.error ? <ErrorState error={schedules.error} onRetry={schedules.reload} /> : activeSchedules.length === 0 ? (
            <EmptyState icon={<Repeat className="h-5 w-5" />} title="Nothing repeats yet" description="Schedule a class and tick “Repeat every week”." action={manage && <Button variant="primary" onClick={() => setScheduling(true)}>Schedule a class</Button>} />
          ) : (
            <Table>
              <thead><tr><Th>Class</Th><Th>Days</Th><Th>Time</Th><Th>Coach</Th><Th>Location</Th><Th align="right">Capacity</Th><Th /></tr></thead>
              <tbody>
                {activeSchedules.map((s) => (
                  <tr key={s.id}>
                    <Td><span className="flex items-center gap-2 font-medium text-fg-heading"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.classType.color }} />{s.classType.name}</span></Td>
                    <Td className="text-fg-muted">{s.daysOfWeek.length === 7 ? 'Every day' : s.daysOfWeek.map((d) => DAYS[d]).join(', ')}</Td>
                    <Td>{clock(s.startTime)} <span className="text-fg-subtle">· {s.durationMin} min</span></Td>
                    <Td className="text-fg-muted">{s.coach?.name || 'Unassigned'}</Td>
                    <Td className="text-fg-muted">{[s.location?.name, s.room].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td align="right">{s.capacity}</Td>
                    <Td align="right">{manage && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setStopping(s)}>Stop</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New class' : 'Edit class'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="class-type" loading={busy}>Save</Button></>}>
        <form id="class-type" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} placeholder="CrossFit, Yoga Flow, Boxing…" /></Field>
          <Field label="Type">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
          </Field>
          <Field label="Calendar colour">
            <div className="flex flex-wrap gap-1.5 pt-1" role="radiogroup" aria-label="Calendar colour">
              {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => setForm({ ...form, color: c })} className={`ui-focus h-7 w-7 rounded-full ${form.color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c }} />)}
            </div>
          </Field>
          <Field label="Usual length (minutes)"><Input type="number" min={5} max={720} step={5} value={form.defaultDurationMin} onChange={(e) => setForm({ ...form, defaultDurationMin: Number(e.target.value) })} /></Field>
          <Field label="Usual capacity"><Input type="number" min={1} max={1000} value={form.defaultCapacity} onChange={(e) => setForm({ ...form, defaultCapacity: Number(e.target.value) })} /></Field>
          <Field label="Description" hint="Shown to members when they book." className="sm:col-span-2"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} /></Field>
          {editing !== 'new' && <div className="sm:col-span-2"><Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} label="Active (can be scheduled and booked)" /></div>}
          <div className="sm:col-span-2"><FormError message={error} /></div>
        </form>
      </Modal>
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} loading={busy} danger title={`Remove ${removing?.name}?`} confirmLabel="Remove">
        <p>If this class has ever been on the calendar it is retired instead of deleted, so attendance history stays intact. Its weekly schedules stop.</p>
      </ConfirmModal>
      <ConfirmModal open={!!stopping} onClose={() => setStopping(null)} onConfirm={stop} loading={busy} danger title="Stop this recurring class?" confirmLabel="Stop">
        <p>Upcoming sessions that nobody has booked are removed from the calendar. Sessions with bookings stay, so you can cancel those individually and members are notified.</p>
      </ConfirmModal>
      <SessionFormModal open={scheduling} initial={null} onClose={() => setScheduling(false)} onSaved={() => { schedules.reload(); types.reload() }} />
    </Page>
  )
}
