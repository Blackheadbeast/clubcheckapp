'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Info, MonitorSmartphone, ScanLine, Search, XCircle } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { timeAgo, titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorState, Page, PageHeader, Pagination, SkeletonRows, Spinner, StatusBadge, cn, useToast } from '@/components/ui'

interface Match {
  id: string
  name: string
  email: string
  phone: string | null
  photoUrl: string | null
  status: string
  lastCheckInAt: string | null
  exact: boolean
}

interface MemberCard {
  id: string
  name: string
  photoUrl: string | null
  status: string
  lastCheckInAt: string | null
  currentStreak: number
  visitsLast30Days: number
  balanceCents: number | null
  membership: { name: string; status: string; creditsRemaining: number | null; renewsAt: string | null; endsAt: string | null } | null
  canCheckIn: boolean
  alerts: { level: 'danger' | 'warning' | 'info'; message: string }[]
  todaysBookings: { id: string; status: string; name: string; color: string; startsAt: string }[]
}

interface Result {
  duplicate: boolean
  streak: { current: number }
  attended: { name: string } | null
  member: MemberCard
}

interface LogRow {
  id: string
  timestamp: string
  source: string | null
  type: string
  member: { id: string; name: string; photoUrl: string | null }
  session: { title: string | null; classType: { name: string } } | null
}

export default function CheckinPage() {
  const toast = useToast()
  const { locationId, can, time, date } = useSession()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 120)
  const scanned = /^clubcheck-member-/.test(query.trim())
  const { data: matches, loading: searching } = useApi<Match[]>(debounced.length >= 2 && !scanned ? `/api/checkin/lookup?q=${encodeURIComponent(debounced)}` : null)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [refused, setRefused] = useState<{ message: string; memberId?: string; canOverride: boolean } | null>(null)
  const [page, setPage] = useState(1)
  const log = useApi<LogRow[]>(`/api/checkin${qs({ range: 'today', locationId, page })}`)
  const input = useRef<HTMLInputElement>(null)
  // Tied to the live input as well, so results vanish the moment a check-in clears the box.
  const list = query.trim().length >= 2 && debounced.length >= 2 && !scanned ? matches || [] : []

  useEffect(() => setActive(0), [debounced])
  // The desk should always be ready for the next scan.
  const refocus = useCallback(() => setTimeout(() => input.current?.focus(), 0), [])
  useEffect(() => { refocus() }, [refocus])

  const checkIn = useCallback(
    async (target: { memberId?: string; qrCode?: string }, source: string, force = false) => {
      setBusy(true)
      setRefused(null)
      try {
        const data = await api<Result>('/api/checkin', { body: { ...target, source, force, locationId } })
        setResult(data)
        setQuery('')
        log.reload()
      } catch (err) {
        const e = err as ClientError
        const details = e.details as { memberId?: string; canOverride?: boolean } | undefined
        setResult(null)
        setRefused({ message: e.message, memberId: details?.memberId || target.memberId, canOverride: !!details?.canOverride && can('members.manage') })
        if (e.status === 0 || e.status >= 500) toast.error(e.message)
      } finally {
        setBusy(false)
        refocus()
      }
    },
    [locationId, log, can, toast, refocus]
  )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = query.trim()
    if (!value || busy) return
    if (scanned) return checkIn({ qrCode: value }, 'qr')
    if (list[active]) return checkIn({ memberId: list[active].id }, 'search')
  }

  return (
    <Page>
      <PageHeader
        title="Check-in"
        description="Scan a member's code, or type a name or phone number."
        actions={<Link href="/kiosk"><Button icon={<MonitorSmartphone className="h-4 w-4" />}>Open self check-in kiosk</Button></Link>}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <form onSubmit={submit} role="search">
              <div className="relative">
                {scanned ? <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-accent-text" /> : <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-subtle" />}
                <input
                  ref={input}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)) }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                    if (e.key === 'Escape') setQuery('')
                  }}
                  placeholder="Scan code, or search name / phone"
                  aria-label="Scan code, or search name or phone"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="ui-input h-14 pl-12 pr-12 text-lg"
                />
                {(busy || searching) && <Spinner className="absolute right-4 top-1/2 -translate-y-1/2" />}
              </div>
            </form>

            {list.length > 0 && (
              <ul className="mt-2 divide-y divide-line/60 overflow-hidden rounded-lg border border-line" aria-label="Matching members">
                {list.map((m, i) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => checkIn({ memberId: m.id }, 'search')}
                      aria-current={i === active ? 'true' : undefined}
                      className={cn('flex w-full items-center gap-3 px-3 py-3 text-left transition', i === active ? 'bg-subtle' : 'hover:bg-subtle/60')}
                    >
                      <Avatar name={m.name} src={m.photoUrl} size="lg" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium text-fg-heading">{m.name}</span>
                        <span className="block truncate text-xs text-fg-muted">{m.phone || m.email} · last visit {m.lastCheckInAt ? timeAgo(m.lastCheckInAt) : 'never'}</span>
                      </span>
                      <StatusBadge status={m.status} />
                      <span className="hidden text-xs font-medium text-accent-text sm:block">{i === active ? 'Enter ↵' : 'Check in'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {debounced.length >= 2 && !scanned && !searching && list.length === 0 && (
              <p className="mt-3 text-sm text-fg-muted">No member matches “{debounced}”. {can('members.manage') && <Link href="/members" className="font-medium text-accent-text underline">Add them as a member</Link>}</p>
            )}
          </Card>

          {refused && (
            <Card className="border-red-500/40">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-500" aria-hidden />
                <div className="min-w-0 flex-1" role="alert">
                  <p className="text-base font-semibold text-fg-heading">Not checked in</p>
                  <p className="mt-0.5 text-sm text-fg-muted">{refused.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {refused.canOverride && refused.memberId && <Button variant="danger" onClick={() => checkIn({ memberId: refused.memberId }, 'manual', true)} loading={busy}>Check in anyway</Button>}
                    {refused.memberId && <Link href={`/members/${refused.memberId}`}><Button>Open profile</Button></Link>}
                    <Button variant="ghost" onClick={() => { setRefused(null); refocus() }}>Dismiss</Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {result && <Confirmation result={result} />}
        </div>

        <Card padded={false} className="lg:col-span-2">
          <CardHeader title="Today" description={log.meta ? `${log.meta.total} check-in${log.meta.total === 1 ? '' : 's'}` : undefined} className="px-4 pt-4 sm:px-5" action={<Link href="/attendance"><Button size="sm" variant="ghost">Attendance</Button></Link>} />
          {log.loading ? <SkeletonRows rows={6} /> : log.error ? <ErrorState error={log.error} onRetry={log.reload} /> : !log.data || log.data.length === 0 ? (
            <EmptyState icon={<ScanLine className="h-5 w-5" />} title="No check-ins yet today" description="Scan a member's code or look them up above. Each visit appears here as it happens." />
          ) : (
            <>
              <ul className="divide-y divide-line/60">
                {log.data.map((c) => (
                  <li key={c.id}>
                    <Link href={`/members/${c.member.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/50 sm:px-5">
                      <Avatar name={c.member.name} src={c.member.photoUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg-heading">{c.member.name}</span>
                        <span className="block truncate text-xs text-fg-muted">{c.session ? c.session.title || c.session.classType.name : titleCase(c.type)}</span>
                      </span>
                      <span className="tabular text-xs text-fg-subtle">{time(c.timestamp)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {log.meta && <Pagination page={log.meta.page} totalPages={log.meta.totalPages} total={log.meta.total} onPage={setPage} noun="today" />}
            </>
          )}
        </Card>
      </div>
    </Page>
  )
}

function Confirmation({ result }: { result: Result }) {
  const { time, date } = useSession()
  const m = result.member
  const danger = m.alerts.some((a) => a.level === 'danger')
  return (
    <Card className={danger ? 'border-amber-500/50' : 'border-emerald-500/40'}>
      <div className="flex flex-wrap items-start gap-4" role="status" aria-live="polite">
        <Avatar name={m.name} src={m.photoUrl} size="xl" />
        <div className="min-w-0 flex-1">
          <p className={cn('flex items-center gap-1.5 text-sm font-semibold', result.duplicate ? 'text-fg-muted' : 'text-emerald-600 dark:text-emerald-400')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {result.duplicate ? 'Already checked in a moment ago' : result.attended ? `Checked in for ${result.attended.name}` : 'Checked in'}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-2xl font-semibold tracking-tight text-fg-heading">{m.name}</h2>
            <StatusBadge status={m.status} />
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {m.membership ? (
              <>
                {m.membership.name}
                {m.membership.creditsRemaining !== null && ` · ${m.membership.creditsRemaining} session${m.membership.creditsRemaining === 1 ? '' : 's'} left`}
                {m.membership.renewsAt && ` · renews ${date(m.membership.renewsAt)}`}
                {!m.membership.renewsAt && m.membership.endsAt && ` · ends ${date(m.membership.endsAt)}`}
              </>
            ) : 'No membership on file'}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">{m.visitsLast30Days} visit{m.visitsLast30Days === 1 ? '' : 's'} in the last 30 days · {result.streak.current}-day streak</p>
        </div>
        <Link href={`/members/${m.id}`}><Button size="sm">Profile</Button></Link>
      </div>

      {m.alerts.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {m.alerts.map((a, i) => (
            <li key={i} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', a.level === 'danger' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : a.level === 'warning' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-400' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400')}>
              {a.level === 'info' ? <Info className="h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
              {a.message}
            </li>
          ))}
        </ul>
      )}

      {m.todaysBookings.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Today's classes</p>
          <ul className="space-y-1">
            {m.todaysBookings.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                <span className="tabular text-fg-muted">{time(b.startsAt)}</span>
                <span className="text-fg">{b.name}</span>
                <StatusBadge status={b.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
