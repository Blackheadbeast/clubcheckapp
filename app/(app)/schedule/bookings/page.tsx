'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarCheck } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, EmptyState, ErrorState, Page, PageHeader, Pagination, SearchInput, Select, SkeletonRows, StatusBadge, Table, Tabs, Td, Th, useToast } from '@/components/ui'
import { SessionDrawer } from '@/components/schedule/SessionModals'

interface Row {
  id: string
  status: string
  source: string
  creditUsed: boolean
  createdAt: string
  offerExpiresAt: string | null
  member: { id: string; name: string; photoUrl: string | null }
  session: { id: string; title: string | null; startsAt: string; capacity: number; classType: { name: string; color: string }; coach: { name: string } | null }
}

const TABS = [
  { key: '', label: 'All' }, { key: 'booked', label: 'Booked' }, { key: 'waitlisted', label: 'Waitlisted' }, { key: 'attended', label: 'Attended' },
  { key: 'no_show', label: 'No-shows' }, { key: 'late_cancelled', label: 'Late cancels' }, { key: 'cancelled', label: 'Cancelled' },
]

function Bookings() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { dateTime, can, locationId } = useSession()
  const { classTypes } = useLookups()
  const status = params.get('status') || ''
  const [when, setWhen] = useState('upcoming')
  const [search, setSearch] = useState('')
  const [classTypeId, setClassTypeId] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const debounced = useDebounced(search)
  useEffect(() => setPage(1), [status, when, debounced, classTypeId])
  // Attendance outcomes only exist for classes that have happened.
  useEffect(() => { if (['attended', 'no_show'].includes(status)) setWhen('past') }, [status])

  const { data, meta, error, loading, reload } = useApi<Row[]>(`/api/bookings${qs({ status, when, search: debounced, classTypeId, locationId, page })}`)
  const upcoming = (meta?.upcoming || {}) as Record<string, number>

  const act = async (id: string, body: Record<string, unknown>, message: string) => {
    try {
      await api(`/api/bookings/${id}`, { body })
      toast.success(message)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  return (
    <Page>
      <PageHeader title="Bookings" description={meta ? `${upcoming.booked || 0} upcoming bookings · ${(upcoming.waitlisted || 0) + (upcoming.offered || 0)} on waitlists` : undefined} />
      <Tabs tabs={TABS} value={status} onChange={(key) => router.replace(`/schedule/bookings${qs({ status: key })}`)} />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by member" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Select aria-label="When" value={when} onChange={(e) => setWhen(e.target.value)} className="w-auto"><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All dates</option></Select>
        <Select aria-label="Class" value={classTypeId} onChange={(e) => setClassTypeId(e.target.value)} className="w-auto"><option value="">All classes</option>{classTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title={status === 'waitlisted' ? 'No one is on a waitlist' : 'No bookings match'} description="Bookings appear here as members reserve spots or staff book them in." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Member</Th><Th>Class</Th><Th>When</Th><Th>Status</Th><Th>Booked by</Th><Th /></tr></thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <Td><Link href={`/members/${b.member.id}`} className="ui-focus flex items-center gap-2.5 rounded font-medium text-fg-heading hover:underline"><Avatar name={b.member.name} src={b.member.photoUrl} size="sm" />{b.member.name}</Link></Td>
                    <Td><button type="button" onClick={() => setOpen(b.session.id)} className="ui-focus flex items-center gap-2 rounded hover:underline"><span className="h-2 w-2 rounded-full" style={{ background: b.session.classType.color }} />{b.session.title || b.session.classType.name}</button></Td>
                    <Td className="text-fg-muted">{dateTime(b.session.startsAt)}</Td>
                    <Td><StatusBadge status={b.status} />{b.status === 'offered' && <span className="ml-2 text-xs text-fg-subtle">until {dateTime(b.offerExpiresAt)}</span>}</Td>
                    <Td className="capitalize text-fg-muted">{b.source}</Td>
                    <Td align="right">
                      {can('bookings.manage') && ['booked', 'waitlisted', 'offered'].includes(b.status) && new Date(b.session.startsAt) > new Date() && (
                        <span className="inline-flex gap-1.5">
                          {b.status === 'offered' && <Button size="sm" variant="primary" onClick={() => act(b.id, { action: 'claim' }, 'Spot confirmed')}>Confirm spot</Button>}
                          <Button size="sm" onClick={() => act(b.id, { action: 'cancel', waive: true }, b.status === 'booked' ? 'Booking cancelled' : 'Removed from the waitlist')}>{b.status === 'booked' ? 'Cancel' : 'Remove'}</Button>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="bookings" />}
          </>
        )}
      </Card>
      <SessionDrawer sessionId={open} onClose={() => setOpen(null)} onChanged={reload} />
    </Page>
  )
}

export default function BookingsPage() {
  return <Suspense><Bookings /></Suspense>
}
