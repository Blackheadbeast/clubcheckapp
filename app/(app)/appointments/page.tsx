'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, Plus } from 'lucide-react'
import { qs, useApi } from '@/lib/client'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Button, Card, EmptyState, ErrorState, Page, PageHeader, Select, SkeletonRows, Stat, StatusBadge, Tabs, cn } from '@/components/ui'
import { AppointmentDetailModal, BookAppointmentModal } from '@/components/appointments/AppointmentModals'

interface Row {
  id: string; status: string; startsAt: string; endsAt: string; paymentMode: string
  type: { id: string; name: string; color: string; durationMin: number }
  staff: { id: string; name: string }
  member: { id: string; name: string }
  location: { id: string; name: string } | null
}
type Range = 'today' | 'week' | 'upcoming' | 'past'

function Appointments() {
  const router = useRouter()
  const params = useSearchParams()
  const { gym, can, time, user, locationId } = useSession()
  const lookups = useLookups()
  const tz = gym.timezone
  const today = zonedParts(new Date(), tz).date
  const [range, setRange] = useState<Range>('upcoming')
  const [staffId, setStaffId] = useState('')
  const [status, setStatus] = useState('active')
  const [openId, setOpenId] = useState<string | null>(params.get('open'))
  const [booking, setBooking] = useState(false)
  const ownDiary = user.role === 'coach' || user.role === 'trainer'

  useEffect(() => { setOpenId(params.get('open')) }, [params])
  const window = useMemo(() => {
    const start = (d: string) => zonedToUtc(d, '00:00', tz).toISOString()
    if (range === 'today') return { from: start(today), to: start(addDaysToDate(today, 1)) }
    if (range === 'week') return { from: start(today), to: start(addDaysToDate(today, 7)) }
    if (range === 'past') return { from: start(addDaysToDate(today, -30)), to: new Date().toISOString() }
    return { from: new Date().toISOString(), to: start(addDaysToDate(today, 60)) }
  }, [range, today, tz])
  const { data, error, loading, reload } = useApi<Row[]>(`/api/appointments${qs({ ...window, staffId, locationId, status: range === 'past' && status === 'active' ? null : status })}`)
  const todayRows = useApi<Row[]>(`/api/appointments${qs({ from: zonedToUtc(today, '00:00', tz).toISOString(), to: zonedToUtc(addDaysToDate(today, 1), '00:00', tz).toISOString(), status: 'active', locationId })}`)

  const rows = useMemo(() => (range === 'past' ? [...(data || [])].reverse() : data || []), [data, range])
  const days = useMemo(() => {
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      const key = zonedParts(new Date(r.startsAt), tz).date
      groups.set(key, [...(groups.get(key) || []), r])
    }
    return Array.from(groups.entries())
  }, [rows, tz])
  const label = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return `${d === today ? 'Today · ' : d === addDaysToDate(today, 1) ? 'Tomorrow · ' : ''}${new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
  }
  const close = () => { setOpenId(null); if (params.get('open')) router.replace('/appointments') }
  const changed = () => { reload(); todayRows.reload() }
  const coaches = lookups.coaches.length ? lookups.coaches : lookups.staff

  return (
    <Page>
      <PageHeader
        title="Appointments"
        description={ownDiary ? 'Your personal training and one-to-one sessions.' : 'Personal training, assessments and consultations.'}
        actions={<>
          {can('appointments.configure') && <Link href="/appointments/types"><Button>Types</Button></Link>}
          <Link href="/appointments/availability"><Button>Availability</Button></Link>
          {can('appointments.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setBooking(true)}>Book appointment</Button>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Today" value={todayRows.data ? todayRows.data.length : '—'} hint={todayRows.data?.length ? `Next at ${time((todayRows.data.find((r) => new Date(r.endsAt) > new Date()) || todayRows.data[0]).startsAt)}` : 'Nothing booked'} />
        <Stat label="Still to come today" value={todayRows.data ? todayRows.data.filter((r) => r.status === 'booked' && new Date(r.startsAt) > new Date()).length : '—'} />
        <Stat label="To record" value={todayRows.data ? todayRows.data.filter((r) => r.status === 'booked' && new Date(r.endsAt) < new Date()).length : '—'} hint="Finished today, not yet marked attended or no-show" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs tabs={[{ key: 'today', label: 'Today' }, { key: 'week', label: 'Next 7 days' }, { key: 'upcoming', label: 'All upcoming' }, { key: 'past', label: 'Past 30 days' }]} value={range} onChange={(v) => setRange(v as Range)} />
        <div className="ml-auto flex flex-wrap gap-2">
          {!ownDiary && (
            <Select aria-label="Staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-auto">
              <option value="">All staff</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="active">Booked and attended</option>
            <option value="booked">Booked</option>
            <option value="completed">Attended</option>
            <option value="no_show">No-show</option>
            <option value="cancelled">Cancelled</option>
            <option value="late_cancelled">Late cancelled</option>
            <option value="">Everything</option>
          </Select>
        </div>
      </div>

      <Card padded={false}>
        {loading ? <SkeletonRows rows={6} /> : error ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={range === 'past' ? 'No appointments in the last 30 days' : 'No appointments here'} description={range === 'past' ? undefined : 'Book a member in, or let members book themselves from their app.'} action={can('appointments.manage') && range !== 'past' ? <Button variant="primary" onClick={() => setBooking(true)}>Book appointment</Button> : undefined} />
        ) : (
          <div className="divide-y divide-line">
            {days.map(([d, items]) => (
              <section key={d} className="px-4 py-3 sm:px-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{label(d)}</h3>
                <ul className="space-y-1.5">
                  {items.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setOpenId(r.id)} className={cn('ui-focus flex w-full items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-left hover:bg-subtle/60', ['cancelled', 'late_cancelled'].includes(r.status) && 'opacity-60')}>
                        <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: r.type.color }} />
                        <span className="tabular w-[4.5rem] shrink-0 text-sm font-medium text-fg-heading">{time(r.startsAt)}<span className="block text-xs font-normal text-fg-subtle">{r.type.durationMin} min</span></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg-heading">{r.member.name}</span>
                          <span className="block truncate text-xs text-fg-muted">{[r.type.name, r.staff.name, r.location?.name].filter(Boolean).join(' · ')}</span>
                        </span>
                        <StatusBadge status={r.status === 'booked' && new Date(r.endsAt) < new Date() ? 'pending' : r.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} onDone={changed} />
      <AppointmentDetailModal id={openId} onClose={close} onChanged={changed} />
    </Page>
  )
}

export default function AppointmentsPage() {
  return <Suspense><Appointments /></Suspense>
}
