'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, FormError, Input, Page, PageHeader, Select, SkeletonRows, useToast } from '@/components/ui'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKDAY = [1, 2, 3, 4, 5, 6, 0]
const KINDS: Record<string, string> = { vacation: 'Vacation', personal: 'Personal time', holiday: 'Holiday', other: 'Other' }
interface Loaded { hours: { weekday: number; startMinute: number; endMinute: number; locationId: string | null }[]; breaks: { weekday: number; startMinute: number; endMinute: number }[]; timeOff: { id: string; startsAt: string; endsAt: string; kind: string; note: string | null }[]; types: { id: string; name: string }[] }
interface DayState { on: boolean; start: string; end: string; locationId: string; hasBreak: boolean; breakStart: string; breakEnd: string }
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const empty = (): DayState => ({ on: false, start: '09:00', end: '17:00', locationId: '', hasBreak: false, breakStart: '12:00', breakEnd: '13:00' })

export default function AvailabilityPage() {
  const { can, user, dateTime } = useSession()
  const toast = useToast()
  const lookups = useLookups()
  const manage = can('appointments.configure')
  const people = manage ? (lookups.coaches.length ? lookups.coaches : lookups.staff) : lookups.staff.filter((s) => s.id === user.id)
  const [staffId, setStaffId] = useState('')
  useEffect(() => { if (!staffId && people.length) setStaffId(people.find((p) => p.id === user.id)?.id || people[0].id) }, [people, staffId, user.id])
  const { data, error, loading, reload } = useApi<Loaded>(staffId ? `/api/appointments/availability/${staffId}` : null)
  const [week, setWeek] = useState<DayState[]>(DAYS.map(empty))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState({ from: '', to: '', kind: 'vacation', note: '' })
  const [offBusy, setOffBusy] = useState(false)
  const editable = manage || staffId === user.id

  useEffect(() => {
    if (!data) return
    setWeek(WEEKDAY.map((wd) => {
      const h = data.hours.find((x) => x.weekday === wd)
      const b = data.breaks.find((x) => x.weekday === wd)
      return { on: !!h, start: h ? hhmm(h.startMinute) : '09:00', end: h ? hhmm(Math.min(h.endMinute, 1435)) : '17:00', locationId: h?.locationId || '', hasBreak: !!b, breakStart: b ? hhmm(b.startMinute) : '12:00', breakEnd: b ? hhmm(b.endMinute) : '13:00' }
    }))
    setProblem(null)
  }, [data])
  const set = (i: number, patch: Partial<DayState>) => setWeek((w) => w.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const copyToAll = (i: number) => setWeek((w) => w.map((d) => (d.on ? { ...w[i] } : d)))

  const save = async () => {
    setBusy(true)
    setProblem(null)
    const round = (m: number) => Math.round(m / 5) * 5
    try {
      for (const [i, d] of week.entries()) {
        if (d.on && minutes(d.end) <= minutes(d.start)) throw new ClientError(`${DAYS[i]}: the end time must be after the start time.`, 400)
        if (d.on && d.hasBreak && minutes(d.breakEnd) <= minutes(d.breakStart)) throw new ClientError(`${DAYS[i]}: the break must end after it starts.`, 400)
      }
      await api(`/api/appointments/availability/${staffId}`, {
        method: 'PUT',
        body: {
          hours: week.flatMap((d, i) => (d.on ? [{ weekday: WEEKDAY[i], startMinute: round(minutes(d.start)), endMinute: round(minutes(d.end)), locationId: d.locationId || null }] : [])),
          breaks: week.flatMap((d, i) => (d.on && d.hasBreak ? [{ weekday: WEEKDAY[i], startMinute: round(minutes(d.breakStart)), endMinute: round(minutes(d.breakEnd)) }] : [])),
        },
      })
      toast.success('Availability saved')
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const addOff = async (e: React.FormEvent) => {
    e.preventDefault()
    setOffBusy(true)
    try {
      const r = await api<{ affectedAppointments: number }>('/api/appointments/time-off', { body: { staffId, startsAt: new Date(off.from).toISOString(), endsAt: new Date(off.to).toISOString(), kind: off.kind, note: off.note || null } })
      if (r.affectedAppointments > 0) toast.error(`Time off added. ${r.affectedAppointments} appointment${r.affectedAppointments === 1 ? ' is' : 's are'} already booked in that range and still need moving or cancelling.`)
      else toast.success('Time off added')
      setOff({ from: '', to: '', kind: 'vacation', note: '' })
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setOffBusy(false)
    }
  }
  const removeOff = async (id: string) => {
    try { await api(`/api/appointments/time-off/${id}`, { method: 'DELETE' }); reload() } catch (err) { toast.error((err as ClientError).message) }
  }

  return (
    <Page width="narrow">
      <Link href="/appointments" className="ui-focus mb-3 inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Appointments</Link>
      <PageHeader title="Availability" description="When each person can be booked for appointments. Classes they teach are blocked automatically." actions={people.length > 1 && (
        <Select aria-label="Staff member" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-auto">{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      )} />
      {!staffId ? <Card><EmptyState title="No staff to set up" description="Add a coach or trainer under Staff first." /></Card> : loading ? <Card padded={false}><SkeletonRows rows={7} /></Card> : error || !data ? <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card> : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Weekly hours" description={data.types.length ? `Offers: ${data.types.map((t) => t.name).join(', ')}` : 'Not assigned to any appointment type yet, so nothing can be booked. Add them under Appointment types.'} />
            <div className="divide-y divide-line">
              {week.map((d, i) => (
                <div key={DAYS[i]} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="w-32"><Checkbox checked={d.on} disabled={!editable} onChange={(e) => set(i, { on: e.target.checked })} label={DAYS[i]} /></div>
                    {d.on ? (
                      <>
                        <Input type="time" step={300} aria-label={`${DAYS[i]} start`} value={d.start} disabled={!editable} onChange={(e) => set(i, { start: e.target.value })} className="w-[7.5rem]" />
                        <span className="text-fg-subtle">to</span>
                        <Input type="time" step={300} aria-label={`${DAYS[i]} end`} value={d.end} disabled={!editable} onChange={(e) => set(i, { end: e.target.value })} className="w-[7.5rem]" />
                        {lookups.locations.length > 1 && <Select aria-label={`${DAYS[i]} location`} value={d.locationId} disabled={!editable} onChange={(e) => set(i, { locationId: e.target.value })} className="w-auto"><option value="">Any location</option>{lookups.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
                        {editable && <button type="button" onClick={() => copyToAll(i)} className="ui-focus rounded text-xs font-medium text-accent-text hover:underline">Copy to other days</button>}
                      </>
                    ) : <span className="text-sm text-fg-subtle">Not available</span>}
                  </div>
                  {d.on && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-0 sm:pl-[8.75rem]">
                      <Checkbox checked={d.hasBreak} disabled={!editable} onChange={(e) => set(i, { hasBreak: e.target.checked })} label="Break" />
                      {d.hasBreak && <><Input type="time" step={300} aria-label={`${DAYS[i]} break start`} value={d.breakStart} disabled={!editable} onChange={(e) => set(i, { breakStart: e.target.value })} className="w-[7.5rem]" /><span className="text-fg-subtle">to</span><Input type="time" step={300} aria-label={`${DAYS[i]} break end`} value={d.breakEnd} disabled={!editable} onChange={(e) => set(i, { breakEnd: e.target.value })} className="w-[7.5rem]" /></>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3"><FormError message={problem} /></div>
            {editable && <div className="mt-3 flex justify-end"><Button variant="primary" loading={busy} onClick={save}>Save hours</Button></div>}
          </Card>

          <Card>
            <CardHeader title="Time off" description="Vacation, holidays and one-off absences. Nothing can be booked in these ranges." />
            {data.timeOff.length === 0 ? <p className="text-sm text-fg-muted">No time off coming up.</p> : (
              <ul className="divide-y divide-line">
                {data.timeOff.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1"><span className="block font-medium text-fg-heading">{KINDS[t.kind] || t.kind}{t.note ? ` · ${t.note}` : ''}</span><span className="block text-xs text-fg-muted">{dateTime(t.startsAt)} to {dateTime(t.endsAt)}</span></span>
                    {editable && <button type="button" aria-label="Remove time off" onClick={() => removeOff(t.id)} className="ui-focus flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle hover:text-fg"><Trash2 className="h-4 w-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <form onSubmit={addOff} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <Field label="From"><Input type="datetime-local" value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} required /></Field>
                <Field label="Until"><Input type="datetime-local" value={off.to} min={off.from} onChange={(e) => setOff({ ...off, to: e.target.value })} required /></Field>
                <Field label="Type"><Select value={off.kind} onChange={(e) => setOff({ ...off, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Note (optional)"><Input value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} maxLength={200} /></Field>
                <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={offBusy}>Add time off</Button></div>
              </form>
            )}
          </Card>
        </div>
      )}
    </Page>
  )
}
