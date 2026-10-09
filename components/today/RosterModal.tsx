'use client'

// The class roster as the front desk and coaches use it: find the member, tap,
// done. Everything it does goes through the existing booking and attendance
// endpoints; there is no second roster or waitlist engine here.

import { useEffect, useMemo, useState } from 'react'
import { Check, MessageSquare, Search, Undo2, UserPlus, X } from 'lucide-react'
import { api, ClientError, useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, EmptyState, ErrorState, FormError, Input, Modal, SkeletonRows, StatusBadge, cn, useToast } from '@/components/ui'
import { ComposeModal } from '@/components/members/ComposeModal'

interface RosterRow { id: string; status: string; checkedInAt: string | null; member: { id: string; name: string; photoUrl: string | null; status: string; hasMedicalNotes?: boolean }; membership: { plan: { name: string } } | null }
interface WaitRow { id: string; status: string; position: number; offerExpiresAt: string | null; member: { id: string; name: string; photoUrl: string | null; status: string } }
interface Session {
  id: string; title: string; startsAt: string; endsAt: string; capacity: number; booked: number; status: string
  coach: { id: string; name: string } | null; location: { id: string; name: string } | null; room: string | null
  roster: RosterRow[]; waitlist: WaitRow[]
}
interface Found { id: string; name: string; status: string; membership: string | null }

export function RosterModal({ sessionId, initialTab = 'roster', onClose, onChanged, onOpenMember }: { sessionId: string | null; initialTab?: 'roster' | 'waitlist'; onClose: () => void; onChanged: () => void; onOpenMember: (id: string) => void }) {
  const toast = useToast()
  const { can, time } = useSession()
  const { data, error, loading, reload } = useApi<Session>(sessionId ? `/api/schedule/sessions/${sessionId}` : null)
  const [tab, setTab] = useState<'roster' | 'waitlist'>(initialTab)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const found = useApi<Found[]>(adding && term.trim().length >= 2 ? `/api/today/members?q=${encodeURIComponent(term.trim())}` : null)
  const [message, setMessage] = useState<{ ids: string[]; label: string } | null>(null)
  const mark = can('attendance.manage') || can('bookings.manage')
  const manage = can('bookings.manage')

  useEffect(() => { setTab(initialTab); setFilter(''); setProblem(null); setAdding(false); setSearch('') }, [sessionId, initialTab])
  const roster = useMemo(() => (data?.roster || []).filter((r) => r.member.name.toLowerCase().includes(filter.trim().toLowerCase())).sort((a, b) => Number(a.status === 'attended') - Number(b.status === 'attended') || a.member.name.localeCompare(b.member.name)), [data, filter])
  if (!sessionId) return null
  const s = data
  const attended = s ? s.roster.filter((r) => r.status === 'attended').length : 0
  const changed = () => { reload(); onChanged() }

  const act = async (bookingId: string, body: unknown, done?: string) => {
    setBusy(bookingId)
    setProblem(null)
    try {
      await api(`/api/bookings/${bookingId}`, { body })
      if (done) toast.success(done)
      changed()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }
  const add = async (member: Found, joinWaitlist = false) => {
    setBusy(member.id)
    setProblem(null)
    try {
      const r = await api<{ status: string; waitlistPosition: number | null }>('/api/bookings', { body: { memberId: member.id, sessionId, ...(joinWaitlist && { joinWaitlist: true }) } })
      toast.success(r.status === 'waitlisted' ? `${member.name} added to the waitlist (#${r.waitlistPosition})` : `${member.name} booked in`)
      setSearch('')
      setAdding(false)
      changed()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Modal open onClose={onClose} title={s ? s.title : 'Class'} description={s ? `${time(s.startsAt)} – ${time(s.endsAt)}${s.coach ? ` · ${s.coach.name}` : ''}${s.location ? ` · ${[s.location.name, s.room].filter(Boolean).join(' · ')}` : ''}` : undefined} size="lg">
        {loading ? <SkeletonRows rows={6} /> : error || !s ? <ErrorState error={error || 'Not found'} onRetry={reload} /> : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[['Booked', `${s.booked}/${s.capacity}`], ['Checked in', attended], ['No-shows', s.roster.filter((r) => r.status === 'no_show').length], ['Waitlist', s.waitlist.length]].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line px-1 py-2"><p className="tabular text-lg font-semibold text-fg-heading">{value}</p><p className="text-[11px] text-fg-muted">{label}</p></div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Roster or waitlist">
                {(['roster', 'waitlist'] as const).map((k) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('ui-focus h-9 rounded-md px-3 text-sm font-medium capitalize', tab === k ? 'bg-subtle text-fg-heading' : 'text-fg-muted')}>{k}{k === 'waitlist' && s.waitlist.length ? ` (${s.waitlist.length})` : ''}</button>)}
              </div>
              <div className="ml-auto flex gap-2">
                {can('communication.send') && s.roster.length > 0 && <Button onClick={() => setMessage({ ids: s.roster.map((r) => r.member.id), label: `${s.roster.length} member${s.roster.length === 1 ? '' : 's'} in ${s.title}` })}><MessageSquare className="h-4 w-4" />Message class</Button>}
                {manage && <Button onClick={() => setAdding((v) => !v)}><UserPlus className="h-4 w-4" />Add member</Button>}
              </div>
            </div>

            {adding && (
              <div className="rounded-xl border border-line p-3">
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden /><Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a member to add" className="h-11 pl-9" aria-label="Find a member to add" /></div>
                {term.trim().length >= 2 && (
                  <ul className="mt-2 divide-y divide-line">
                    {found.loading ? <li className="py-2 text-sm text-fg-muted">Searching…</li> : (found.data || []).length === 0 ? <li className="py-2 text-sm text-fg-muted">No members match.</li> : (found.data || []).map((m) => {
                      const already = s.roster.some((r) => r.member.id === m.id) || s.waitlist.some((w) => w.member.id === m.id)
                      return <li key={m.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg-heading">{m.name}</span><span className="block truncate text-xs text-fg-muted">{m.membership || 'No membership'}</span></span>{already ? <Badge>Already in</Badge> : <Button size="sm" variant="primary" loading={busy === m.id} onClick={() => add(m, s.booked >= s.capacity)}>{s.booked >= s.capacity ? 'Add to waitlist' : 'Book in'}</Button>}</li>
                    })}
                  </ul>
                )}
              </div>
            )}
            <FormError message={problem} />

            {tab === 'roster' ? (
              <>
                {s.roster.length > 6 && <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden /><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in this class" className="h-11 pl-9" aria-label="Find in this class" /></div>}
                {s.roster.length === 0 ? <EmptyState title="Nobody booked yet" description="Add a member, or they can book from their app." /> : roster.length === 0 ? <p className="py-4 text-center text-sm text-fg-muted">Nobody in this class matches "{filter}".</p> : (
                  <ul className="divide-y divide-line">
                    {roster.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-2.5">
                        <button type="button" onClick={() => onOpenMember(r.member.id)} className="ui-focus flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left">
                          <Avatar name={r.member.name} src={r.member.photoUrl} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg-heading">{r.member.name}</span>
                            <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted"><span className="truncate">{r.membership?.plan.name || 'No membership'}</span>{!['active', 'trial'].includes(r.member.status) && <StatusBadge status={r.member.status} />}{r.member.hasMedicalNotes && <span className="text-sky-700 dark:text-sky-400">Medical note</span>}</span>
                          </span>
                        </button>
                        {r.status === 'attended' ? (
                          <span className="flex shrink-0 items-center gap-1.5"><span className="inline-flex h-10 items-center gap-1 rounded-lg bg-emerald-500/10 px-3 text-sm font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" aria-hidden />In{r.checkedInAt ? ` ${time(r.checkedInAt)}` : ''}</span>{mark && <button type="button" aria-label={`Undo check-in for ${r.member.name}`} disabled={busy === r.id} onClick={() => act(r.id, { action: 'attendance', status: 'booked' })} className="ui-focus flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle hover:text-fg"><Undo2 className="h-4 w-4" aria-hidden /></button>}</span>
                        ) : r.status === 'no_show' ? (
                          <span className="flex shrink-0 items-center gap-1.5"><Badge tone="amber">No-show</Badge>{mark && <Button size="sm" loading={busy === r.id} onClick={() => act(r.id, { action: 'attendance', status: 'attended' })}>They came</Button>}</span>
                        ) : mark ? (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Button variant="primary" className="h-10" loading={busy === r.id} onClick={() => act(r.id, { action: 'attendance', status: 'attended' })}><Check className="h-4 w-4" />Check in</Button>
                            <button type="button" aria-label={`Mark ${r.member.name} as a no-show`} title="No-show" disabled={busy === r.id} onClick={() => act(r.id, { action: 'attendance', status: 'no_show' })} className="ui-focus flex h-10 w-10 items-center justify-center rounded-lg border border-line text-fg-muted hover:bg-subtle hover:text-fg"><X className="h-4 w-4" aria-hidden /></button>
                          </span>
                        ) : <StatusBadge status={r.status} />}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : s.waitlist.length === 0 ? <EmptyState title="No one is waiting" description={s.booked >= s.capacity ? 'The class is full. New bookings join the waitlist.' : 'There are still spots in this class.'} /> : (
              <ol className="divide-y divide-line">
                {s.waitlist.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-sm font-semibold text-fg-heading">{w.position}</span>
                    <button type="button" onClick={() => onOpenMember(w.member.id)} className="ui-focus min-w-0 flex-1 rounded text-left"><span className="block truncate text-sm font-medium text-fg-heading">{w.member.name}</span><span className="block text-xs text-fg-muted">{w.status === 'offered' ? `Spot offered${w.offerExpiresAt ? ` until ${time(w.offerExpiresAt)}` : ''}` : 'Waiting'}{!['active', 'trial'].includes(w.member.status) ? ` · ${w.member.status.replace('_', ' ')}` : ''}</span></button>
                    <span className="flex shrink-0 gap-1.5">
                      {manage && <Button size="sm" variant="primary" loading={busy === w.id} onClick={() => act(w.id, { action: 'promote' }, `${w.member.name} moved into the class`)}>Promote</Button>}
                      {can('communication.send') && <Button size="sm" onClick={() => setMessage({ ids: [w.member.id], label: w.member.name })}>Contact</Button>}
                      {manage && <Button size="sm" disabled={busy === w.id} onClick={() => act(w.id, { action: 'cancel' }, `${w.member.name} removed from the waitlist`)}>Remove</Button>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>
      <ComposeModal open={!!message} onClose={() => setMessage(null)} audience={{ type: 'members', ids: message?.ids || [] }} label={message?.label || ''} />
    </>
  )
}
