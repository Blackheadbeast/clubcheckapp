'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, ClientError, qs, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Button, EmptyState, ErrorState, FormError, Modal, SkeletonRows, useToast } from '@/components/ui'

export interface SessionSummary {
  id: string
  title: string
  classType: { id: string; name: string; color: string; category: string }
  coach: { id: string; name: string } | null
  location: { id: string; name: string } | null
  room: string | null
  startsAt: string
  endsAt: string
  status: string
  cancelReason: string | null
  scheduleId: string | null
  capacity: number
  waitlistCapacity: number
  booked: number
  spotsLeft: number
  waitlisted: number
  attended: number
  noShow: number
}

/** Pick an upcoming class and book a member into it (staff flow). */
export function BookClassModal({ memberId, memberName, open, onClose, onDone }: { memberId: string; memberName: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { time, locationId, gym } = useSession()
  const [range] = useState(() => ({ from: new Date().toISOString(), to: new Date(Date.now() + 14 * 86_400_000).toISOString() }))
  const { data, error, loading, reload } = useApi<SessionSummary[]>(open ? `/api/schedule/sessions${qs({ ...range, locationId })}` : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (open) setProblem(null) }, [open])

  const days = useMemo(() => {
    const groups = new Map<string, SessionSummary[]>()
    for (const s of data || []) {
      const key = new Date(s.startsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: gym.timezone })
      groups.set(key, [...(groups.get(key) || []), s])
    }
    return Array.from(groups.entries())
  }, [data, gym.timezone])

  const book = async (session: SessionSummary) => {
    setBusy(session.id)
    setProblem(null)
    try {
      const result = await api<{ status: string; waitlistPosition: number | null }>('/api/bookings', { body: { memberId, sessionId: session.id } })
      toast.success(result.status === 'waitlisted' ? `Added to the waitlist (#${result.waitlistPosition}) for ${session.title}` : `Booked into ${session.title}`)
      onDone()
      onClose()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Book a class" description={`For ${memberName} · next 14 days`} size="lg">
      <div className="space-y-4">
        <FormError message={problem} />
        {loading ? <SkeletonRows rows={5} /> : error ? <ErrorState error={error} onRetry={reload} /> : days.length === 0 ? (
          <EmptyState title="No classes scheduled" description="Nothing is on the calendar for the next two weeks." />
        ) : (
          days.map(([day, sessions]) => (
            <section key={day}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{day}</h3>
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {sessions.map((s) => {
                  const full = s.spotsLeft === 0
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: s.classType.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg-heading">{time(s.startsAt)} · {s.title}</p>
                        <p className="truncate text-xs text-fg-muted">{[s.coach?.name, s.location?.name, s.room].filter(Boolean).join(' · ') || 'No coach assigned'}</p>
                      </div>
                      <span className={`tabular shrink-0 text-xs ${full ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-fg-muted'}`}>
                        {full ? (s.waitlisted >= s.waitlistCapacity ? 'Full' : `Full · ${s.waitlisted} waiting`) : `${s.spotsLeft} of ${s.capacity} left`}
                      </span>
                      <Button size="sm" variant={full ? 'secondary' : 'primary'} loading={busy === s.id} disabled={!!busy || (full && s.waitlisted >= s.waitlistCapacity)} onClick={() => book(s)}>
                        {full ? 'Waitlist' : 'Book'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </Modal>
  )
}
