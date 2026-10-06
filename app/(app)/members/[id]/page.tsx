'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  Archive, CalendarPlus, ChevronLeft, CreditCard, ExternalLink, Mail, MessageSquare, Pencil, Phone, Plus, ScanLine, Snowflake, Trash2, X,
} from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { timeAgo, titleCase } from '@/lib/format'
import { useSession } from '@/components/Session'
import {
  Avatar, Badge, Button, Card, CardHeader, ConfirmModal, EmptyState, ErrorState, FormError, IconButton, Modal, MoneyInput, Page, Pagination,
  Select, Skeleton, SkeletonRows, StatusBadge, Table, Tabs, Td, Textarea, Th, Field, Input, useToast,
} from '@/components/ui'
import { EMPTY_MEMBER, MemberFields, toPayload, type MemberFormValues } from '@/components/members/MemberForm'
import { MembershipActionModal, SellMembershipModal, type MembershipRef } from '@/components/members/MembershipModals'
import { ComposeModal } from '@/components/members/ComposeModal'
import { PayModal, RefundModal, type PayTarget, type RefundTarget } from '@/components/billing/PaymentModals'
import { BookClassModal } from '@/components/schedule/BookClassModal'

interface Membership {
  id: string
  status: string
  startDate: string
  endDate: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  contractEndsAt: string | null
  priceCents: number
  discountPercent: number
  creditsRemaining: number | null
  autoRenew: boolean
  paymentMethod: string
  frozenAt: string | null
  freezeEndsAt: string | null
  cancelAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  plan: { id: string; name: string; type: string; billingInterval: string; intervalCount: number; freezeAllowed: boolean }
}

interface Member extends Omit<MemberFormValues, 'dateOfBirth' | 'homeLocationId' | 'assignedStaffId'> {
  id: string
  status: string
  dateOfBirth: string | null
  createdAt: string
  lastCheckInAt: string | null
  archivedAt: string | null
  currentStreak: number
  longestStreak: number
  creditBalanceCents: number
  waiverSignedAt: string | null
  waiverEnabled: boolean
  portalUrl: string | null
  qrCodeUrl: string
  homeLocationId: string | null
  assignedStaffId: string | null
  tags: { id: string; name: string; color: string }[]
  homeLocation: { id: string; name: string } | null
  assignedStaff: { id: string; name: string } | null
  memberships: Membership[]
  stats: { totalVisits: number; visitsLast30Days: number; upcomingBookings: number; noShows: number }
  billing: { balanceCents: number; overdueCents: number; openInvoices: number; lifetimePaidCents: number } | null
}

type TabKey = 'overview' | 'memberships' | 'billing' | 'attendance' | 'messages' | 'timeline' | 'details'
const LIVE = ['active', 'trial', 'past_due', 'frozen']

function MemberProfile() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const session = useSession()
  const { can, money, date } = session
  const { data: member, error, loading, reload } = useApi<Member>(`/api/members/${id}`)
  const [tab, setTab] = useState<TabKey>((params.get('tab') as TabKey) || 'overview')
  const [version, setVersion] = useState(0)
  const refresh = () => {
    reload()
    setVersion((v) => v + 1)
  }

  const [selling, setSelling] = useState(false)
  const [booking, setBooking] = useState(false)
  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [membershipAction, setMembershipAction] = useState<{ action: 'freeze' | 'cancel' | 'change_plan'; membership: MembershipRef } | null>(null)

  if (loading) {
    return (
      <Page>
        <div className="flex items-center gap-4"><Skeleton className="h-20 w-20 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-72" /></div></div>
        <Card className="mt-6" padded={false}><SkeletonRows /></Card>
      </Page>
    )
  }
  if (error || !member) {
    return <Page><Card><ErrorState error={error || 'Member not found'} onRetry={reload} /></Card></Page>
  }

  const live = member.memberships.filter((m) => LIVE.includes(m.status))
  const toRef = (m: Membership): MembershipRef => ({ id: m.id, planName: m.plan.name, status: m.status, currentPeriodEnd: m.currentPeriodEnd, contractEndsAt: m.contractEndsAt })

  const checkIn = async (force = false) => {
    setBusy(true)
    try {
      const result = await api<{ duplicate: boolean; attended: { name: string } | null }>('/api/checkin', { body: { memberId: member.id, source: 'manual', force, locationId: session.locationId } })
      toast.success(result.duplicate ? `${member.name} was already checked in a moment ago` : result.attended ? `Checked in for ${result.attended.name}` : `${member.name} checked in`)
      refresh()
    } catch (err) {
      const e = err as ClientError
      const details = e.details as { canOverride?: boolean } | undefined
      if (details?.canOverride && !force && window.confirm(`${e.message}\n\nCheck them in anyway?`)) return checkIn(true)
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const simpleAction = async (membershipId: string, action: 'unfreeze' | 'resume', message: string) => {
    try {
      await api(`/api/memberships/${membershipId}`, { body: { action } })
      toast.success(message)
      refresh()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  const setArchived = async (archived: boolean) => {
    setBusy(true)
    try {
      await api(`/api/members/${member.id}`, { method: 'PATCH', body: { archived } })
      toast.success(archived ? 'Member archived' : 'Member restored')
      setArchiving(false)
      refresh()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'memberships', label: 'Memberships' },
    ...(can('billing.view') ? [{ key: 'billing' as const, label: 'Billing' }] : []),
    { key: 'attendance', label: 'Attendance' },
    { key: 'messages', label: 'Messages' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'details', label: 'Details' },
  ]

  return (
    <Page>
      <Link href="/members" className="ui-focus mb-3 inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Members</Link>

      <div className="mb-5 flex flex-wrap items-start gap-4">
        <Avatar name={member.name} src={member.photoUrl} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg-heading sm:text-2xl">{member.name}</h1>
            <StatusBadge status={member.archivedAt ? 'archived' : member.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
            <a href={`mailto:${member.email}`} className="ui-focus inline-flex items-center gap-1.5 rounded hover:text-fg"><Mail className="h-3.5 w-3.5" />{member.email}</a>
            {member.phone && <a href={`tel:${member.phone}`} className="ui-focus inline-flex items-center gap-1.5 rounded hover:text-fg"><Phone className="h-3.5 w-3.5" />{member.phone}</a>}
            <span>Joined {date(member.createdAt)}</span>
          </div>
          <TagEditor member={member} canEdit={can('members.manage')} onChange={refresh} />
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {!member.archivedAt && can('attendance.manage') && <Button variant="primary" icon={<ScanLine className="h-4 w-4" />} onClick={() => checkIn()} loading={busy}>Check in</Button>}
          {!member.archivedAt && can('bookings.manage') && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking(true)}>Book class</Button>}
          {!member.archivedAt && can('memberships.manage') && <Button icon={<CreditCard className="h-4 w-4" />} onClick={() => setSelling(true)}>Sell</Button>}
          {can('communication.send') && <Button icon={<MessageSquare className="h-4 w-4" />} onClick={() => setComposing(true)}>Message</Button>}
          {can('members.manage') && <IconButton label="Edit profile" onClick={() => setEditing(true)} className="border border-line bg-surface"><Pencil className="h-4 w-4" /></IconButton>}
          {can('members.delete') && (
            member.archivedAt
              ? <Button onClick={() => setArchived(false)} loading={busy}>Restore</Button>
              : <IconButton label="Archive member" onClick={() => setArchiving(true)} className="border border-line bg-surface"><Archive className="h-4 w-4" /></IconButton>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Last visit" value={timeAgo(member.lastCheckInAt)} />
              <MiniStat label="Visits, 30 days" value={member.stats.visitsLast30Days} />
              <MiniStat label="Current streak" value={`${member.currentStreak} day${member.currentStreak === 1 ? '' : 's'}`} hint={`Best ${member.longestStreak}`} />
              {member.billing
                ? <MiniStat label="Balance due" value={money(member.billing.balanceCents)} tone={member.billing.overdueCents > 0 ? 'danger' : undefined} hint={member.billing.overdueCents > 0 ? `${money(member.billing.overdueCents)} overdue` : `${money(member.billing.lifetimePaidCents)} lifetime`} />
                : <MiniStat label="Upcoming classes" value={member.stats.upcomingBookings} />}
            </div>

            <Card>
              <CardHeader title="Membership" action={can('memberships.manage') && !member.archivedAt ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSelling(true)}>Sell</Button> : undefined} />
              {live.length === 0 ? (
                <p className="text-sm text-fg-muted">No active membership.</p>
              ) : (
                <div className="space-y-3">
                  {live.map((m) => (
                    <MembershipCard key={m.id} membership={m} canManage={can('memberships.manage')} onAction={(action) => setMembershipAction({ action, membership: toRef(m) })} onSimple={simpleAction} />
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Notes" />
              <NoteComposer memberId={member.id} canEdit={can('members.manage')} onSaved={refresh} />
              <Timeline key={`notes-${version}`} memberId={member.id} type="note" canEdit={can('members.manage')} compact />
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Contact & details" action={can('members.manage') ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button> : undefined} />
              <dl className="space-y-2.5 text-sm">
                <Detail label="Date of birth" value={member.dateOfBirth ? new Date(member.dateOfBirth).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null} />
                <Detail label="Address" value={[member.addressLine1, member.city, member.state, member.postalCode].filter(Boolean).join(', ') || null} />
                <Detail label="Emergency contact" value={[member.emergencyContactName, member.emergencyContactPhone].filter(Boolean).join(' · ') || null} />
                <Detail label="Coach" value={member.assignedStaff?.name} />
                <Detail label="Home location" value={member.homeLocation?.name} />
                <Detail label="Source" value={member.leadSource} />
                <Detail label="Goals" value={member.goals} />
                {member.medicalNotes && <Detail label="Medical notes" value={member.medicalNotes} tone="warning" />}
                {member.waiverEnabled && <Detail label="Waiver" value={member.waiverSignedAt ? `Signed ${date(member.waiverSignedAt)}` : 'Not signed'} tone={member.waiverSignedAt ? undefined : 'warning'} />}
                {member.creditBalanceCents > 0 && <Detail label="Account credit" value={money(member.creditBalanceCents)} />}
              </dl>
            </Card>
            <Card>
              <CardHeader title="Recent activity" action={<Button size="sm" variant="ghost" onClick={() => setTab('timeline')}>View all</Button>} />
              <Timeline key={`recent-${version}`} memberId={member.id} compact limit={6} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'memberships' && (
        <Card>
          <CardHeader title="All memberships" action={can('memberships.manage') && !member.archivedAt ? <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSelling(true)}>Sell membership</Button> : undefined} />
          {member.memberships.length === 0 ? (
            <EmptyState title="No memberships yet" description="Sell a membership, class pack or drop-in to get this member started." />
          ) : (
            <div className="space-y-3">
              {member.memberships.map((m) => (
                <MembershipCard key={m.id} membership={m} canManage={can('memberships.manage')} onAction={(action) => setMembershipAction({ action, membership: toRef(m) })} onSimple={simpleAction} />
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'billing' && can('billing.view') && <BillingTab key={version} member={member} onChange={refresh} />}
      {tab === 'attendance' && <AttendanceTab key={version} memberId={member.id} stats={member.stats} onChange={refresh} />}
      {tab === 'messages' && <MessagesTab key={version} memberId={member.id} onCompose={can('communication.send') ? () => setComposing(true) : undefined} />}
      {tab === 'timeline' && <Card><Timeline key={`all-${version}`} memberId={member.id} canEdit={can('members.manage')} /></Card>}
      {tab === 'details' && <DetailsTab member={member} />}

      <SellMembershipModal memberId={member.id} memberName={member.name} open={selling} onClose={() => setSelling(false)} onDone={refresh} />
      <BookClassModal memberId={member.id} memberName={member.name} open={booking} onClose={() => setBooking(false)} onDone={refresh} />
      <ComposeModal open={composing} onClose={() => setComposing(false)} memberId={member.id} label={member.name} onSent={refresh} />
      <MembershipActionModal action={membershipAction?.action || null} membership={membershipAction?.membership || null} onClose={() => setMembershipAction(null)} onDone={refresh} />
      <EditMemberModal member={member} open={editing} onClose={() => setEditing(false)} onSaved={refresh} onDeleted={() => router.push('/members')} />
      <ConfirmModal open={archiving} onClose={() => setArchiving(false)} onConfirm={() => setArchived(true)} loading={busy} title={`Archive ${member.name}?`} confirmLabel="Archive">
        <p>They'll be hidden from the directory and won't be able to check in or book. Their history is kept and you can restore them at any time.</p>
        {live.length > 0 && <p className="font-medium text-fg">They still have an active membership. Cancel it first if billing should stop.</p>}
      </ConfirmModal>
    </Page>
  )
}

function MiniStat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={`tabular mt-1 text-lg font-semibold ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-fg-heading'}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-fg-subtle">{hint}</p>}
    </div>
  )
}

function Detail({ label, value, tone }: { label: string; value?: string | null; tone?: 'warning' }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-fg-subtle">{label}</dt>
      <dd className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : value ? 'text-fg' : 'text-fg-subtle'}`}>{value || '—'}</dd>
    </div>
  )
}

function MembershipCard({
  membership: m,
  canManage,
  onAction,
  onSimple,
}: {
  membership: Membership
  canManage: boolean
  onAction: (action: 'freeze' | 'cancel' | 'change_plan') => void
  onSimple: (id: string, action: 'unfreeze' | 'resume', message: string) => void
}) {
  const { money, date } = useSession()
  const recurring = m.plan.type === 'recurring'
  const live = LIVE.includes(m.status)
  const unit = m.plan.billingInterval === 'week' ? 'week' : m.plan.billingInterval === 'year' ? 'year' : 'month'
  const facts: string[] = []
  if (recurring) facts.push(m.priceCents > 0 ? `${money(m.priceCents)} / ${m.plan.intervalCount > 1 ? `${m.plan.intervalCount} ${unit}s` : unit}` : 'Free')
  if (m.discountPercent > 0) facts.push(`${m.discountPercent}% discount`)
  if (m.creditsRemaining !== null) facts.push(`${m.creditsRemaining} session${m.creditsRemaining === 1 ? '' : 's'} left`)
  if (m.status === 'trial' && m.trialEndsAt) facts.push(`Trial ends ${date(m.trialEndsAt)}`)
  else if (m.status === 'frozen') facts.push(m.freezeEndsAt ? `Frozen until ${date(m.freezeEndsAt)}` : 'Frozen')
  else if (m.cancelAt) facts.push(`Cancels ${date(m.cancelAt)}`)
  else if (live && recurring && m.currentPeriodEnd) facts.push(`${m.autoRenew ? 'Renews' : 'Ends'} ${date(m.currentPeriodEnd)}`)
  else if (live && m.endDate) facts.push(`Expires ${date(m.endDate)}`)
  else if (!live && (m.cancelledAt || m.endDate)) facts.push(`Ended ${date(m.cancelledAt || m.endDate)}`)
  if (live && m.contractEndsAt && new Date(m.contractEndsAt) > new Date()) facts.push(`Contract to ${date(m.contractEndsAt)}`)

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg-heading">{m.plan.name}</span>
            <StatusBadge status={m.status} />
          </div>
          <p className="mt-1 text-sm text-fg-muted">{facts.join(' · ')}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">Started {date(m.startDate)}{live && recurring ? ` · pays by ${m.paymentMethod.replace('_', ' ')}` : ''}{m.cancelReason ? ` · ${m.cancelReason}` : ''}</p>
        </div>
        {canManage && live && (
          <div className="flex flex-wrap gap-1.5">
            {m.status === 'frozen' ? (
              <Button size="sm" onClick={() => onSimple(m.id, 'unfreeze', 'Membership resumed')}>Unfreeze</Button>
            ) : (
              ['active', 'trial'].includes(m.status) && m.plan.freezeAllowed && <Button size="sm" icon={<Snowflake className="h-3.5 w-3.5" />} onClick={() => onAction('freeze')}>Freeze</Button>
            )}
            {recurring && <Button size="sm" onClick={() => onAction('change_plan')}>Change plan</Button>}
            {m.cancelAt
              ? <Button size="sm" onClick={() => onSimple(m.id, 'resume', 'Cancellation withdrawn')}>Don't cancel</Button>
              : <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onAction('cancel')}>Cancel</Button>}
          </div>
        )}
      </div>
    </div>
  )
}

function TagEditor({ member, canEdit, onChange }: { member: Member; canEdit: boolean; onChange: () => void }) {
  const toast = useToast()
  const { tags, reload } = useLookups()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const available = tags.filter((t) => !member.tags.some((mt) => mt.id === t.id))

  const save = async (tagIds: string[]) => {
    try {
      await api(`/api/members/${member.id}/tags`, { method: 'PUT', body: { tagIds } })
      onChange()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }
  const create = async () => {
    if (!name.trim()) return
    try {
      const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899']
      const tag = await api<{ id: string }>('/api/tags', { body: { name: name.trim(), color: colors[tags.length % colors.length] } })
      setName('')
      reload()
      await save([...member.tags.map((t) => t.id), tag.id])
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {member.tags.map((t) => (
        <Badge key={t.id}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
          {t.name}
          {canEdit && (
            <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => save(member.tags.filter((x) => x.id !== t.id).map((x) => x.id))} className="ui-focus -mr-0.5 rounded text-fg-subtle hover:text-fg">
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {canEdit && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="ui-focus rounded-md border border-dashed border-line px-1.5 py-0.5 text-xs text-fg-muted hover:text-fg">+ Tag</button>
      )}
      {adding && (
        <span className="flex items-center gap-1.5">
          {available.length > 0 && (
            <Select aria-label="Add existing tag" className="h-7 w-auto py-0 text-xs" value="" onChange={(e) => { if (e.target.value) { save([...member.tags.map((t) => t.id), e.target.value]); setAdding(false) } }}>
              <option value="">Existing…</option>
              {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
          <Input aria-label="New tag name" className="h-7 w-28 text-xs" placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create().then(() => setAdding(false)) } if (e.key === 'Escape') setAdding(false) }} maxLength={40} />
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Done</Button>
        </span>
      )}
    </div>
  )
}

function NoteComposer({ memberId, canEdit, onSaved }: { memberId: string; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (!canEdit) return null
  const save = async () => {
    setBusy(true)
    try {
      await api(`/api/members/${memberId}/notes`, { body: { note } })
      setNote('')
      onSaved()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-3">
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note. Members never see these." aria-label="New note" maxLength={4000} />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="primary" onClick={save} loading={busy} disabled={!note.trim()}>Save note</Button>
      </div>
    </div>
  )
}

interface Activity {
  id: string
  type: string
  title: string
  detail: string | null
  actorName: string | null
  actorType: string
  createdAt: string
}

const ACTIVITY_TONES: Record<string, string> = {
  payment: 'bg-emerald-500', refund: 'bg-amber-500', payment_failed: 'bg-red-500', membership_past_due: 'bg-red-500', class_missed: 'bg-red-500',
  membership_cancelled: 'bg-neutral-400', membership_frozen: 'bg-amber-500', checkin: 'bg-sky-500', class_attended: 'bg-sky-500',
  class_booked: 'bg-violet-500', note: 'bg-amber-400', message: 'bg-violet-400', joined: 'bg-emerald-500', membership_purchased: 'bg-emerald-500',
}

function Timeline({ memberId, type, compact, limit, canEdit }: { memberId: string; type?: string; compact?: boolean; limit?: number; canEdit?: boolean }) {
  const toast = useToast()
  const { dateTime } = useSession()
  const [page, setPage] = useState(1)
  const { data, meta, error, loading, reload } = useApi<Activity[]>(`/api/members/${memberId}/timeline?page=${page}&pageSize=${limit || (compact ? 10 : 30)}${type ? `&type=${type}` : ''}`)
  if (loading) return <SkeletonRows rows={compact ? 3 : 6} />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data || data.length === 0) return <p className="py-3 text-sm text-fg-subtle">{type === 'note' ? 'No notes yet.' : 'Nothing has happened yet.'}</p>

  const removeNote = async (activityId: string) => {
    try {
      await api(`/api/members/${memberId}/notes?activityId=${activityId}`, { method: 'DELETE' })
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  return (
    <>
      <ol className="relative space-y-4 pl-5 before:absolute before:bottom-1 before:left-[5px] before:top-1.5 before:w-px before:bg-line">
        {data.map((a) => (
          <li key={a.id} className="relative">
            <span className={`absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-surface ${ACTIVITY_TONES[a.type] || 'bg-neutral-400'}`} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {a.type !== 'note' && <p className="text-sm font-medium text-fg-heading">{a.title}</p>}
                {a.detail && <p className={`whitespace-pre-wrap break-words text-sm ${a.type === 'note' ? 'text-fg' : 'text-fg-muted'}`}>{a.detail}</p>}
                <p className="mt-0.5 text-xs text-fg-subtle">{dateTime(a.createdAt)}{a.actorName && a.actorType !== 'system' ? ` · ${a.actorName}` : ''}</p>
              </div>
              {a.type === 'note' && canEdit && <IconButton label="Delete note" onClick={() => removeNote(a.id)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
            </div>
          </li>
        ))}
      </ol>
      {!limit && meta && meta.totalPages > 1 && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="events" />}
    </>
  )
}

interface InvoiceRow { id: string; number: string; status: string; totalCents: number; amountPaidCents: number; refundedCents: number; dueDate: string | null; createdAt: string; items: { description: string }[] }
interface TxRow { id: string; type: string; status: string; amountCents: number; refundedCents: number; method: string; failureReason: string | null; note: string | null; createdAt: string; invoice: { number: string } | null }

function BillingTab({ member, onChange }: { member: Member; onChange: () => void }) {
  const { can, money, date, dateTime } = useSession()
  const toast = useToast()
  const { data, error, loading, reload } = useApi<{ invoices: InvoiceRow[]; transactions: TxRow[] }>(`/api/members/${member.id}/invoices`)
  const [pay, setPay] = useState<PayTarget | null>(null)
  const [refund, setRefund] = useState<RefundTarget | null>(null)
  const [creditOpen, setCreditOpen] = useState(false)
  const [creditCents, setCreditCents] = useState(0)
  const [creditNote, setCreditNote] = useState('')
  const [creditError, setCreditError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const done = () => { reload(); onChange() }

  const addCredit = async () => {
    setBusy(true)
    setCreditError(null)
    try {
      await api(`/api/members/${member.id}/credit`, { body: { amountCents: creditCents, note: creditNote || null } })
      toast.success(`${money(creditCents)} credit added`)
      setCreditOpen(false)
      setCreditCents(0)
      setCreditNote('')
      done()
    } catch (err) {
      setCreditError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Card padded={false}><SkeletonRows /></Card>
  if (error || !data) return <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Balance due" value={money(member.billing?.balanceCents)} tone={member.billing?.overdueCents ? 'danger' : undefined} />
        <MiniStat label="Overdue" value={money(member.billing?.overdueCents)} tone={member.billing?.overdueCents ? 'danger' : undefined} />
        <MiniStat label="Lifetime paid" value={money(member.billing?.lifetimePaidCents)} />
        <div className="rounded-xl border border-line bg-surface p-3 shadow-card">
          <p className="text-xs text-fg-muted">Account credit</p>
          <p className="tabular mt-1 text-lg font-semibold text-fg-heading">{money(member.creditBalanceCents)}</p>
          {can('billing.refund') && <button type="button" onClick={() => setCreditOpen(true)} className="ui-focus mt-0.5 rounded text-xs font-medium text-accent-text hover:underline">Add credit</button>}
        </div>
      </div>

      <Card padded={false}>
        <CardHeader title="Invoices" className="px-4 pt-4 sm:px-5" />
        {data.invoices.length === 0 ? <EmptyState title="No invoices" description="Invoices appear when you sell a membership or product." /> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>For</Th><Th>Status</Th><Th>Due</Th><Th align="right">Total</Th><Th align="right">Balance</Th><Th /></tr></thead>
            <tbody>
              {data.invoices.map((inv) => {
                const balance = inv.totalCents - inv.amountPaidCents
                const overdue = inv.status === 'open' && inv.dueDate && new Date(inv.dueDate) < new Date()
                return (
                  <tr key={inv.id}>
                    <Td className="font-medium"><Link href={`/billing/invoices?invoice=${inv.id}`} className="ui-focus rounded hover:underline">{inv.number}</Link></Td>
                    <Td className="max-w-[16rem] truncate text-fg-muted">{inv.items[0]?.description || '—'}</Td>
                    <Td><StatusBadge status={overdue ? 'overdue' : inv.status} /></Td>
                    <Td className="text-fg-muted">{date(inv.dueDate)}</Td>
                    <Td align="right">{money(inv.totalCents)}</Td>
                    <Td align="right" className={inv.status === 'open' ? 'font-medium' : 'text-fg-subtle'}>{inv.status === 'open' ? money(balance) : '—'}</Td>
                    <Td align="right">{inv.status === 'open' && can('billing.manage') && <Button size="sm" variant="primary" onClick={() => setPay({ id: inv.id, number: inv.number, balanceCents: balance, creditBalanceCents: member.creditBalanceCents })}>Take payment</Button>}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader title="Payment history" className="px-4 pt-4 sm:px-5" />
        {data.transactions.length === 0 ? <EmptyState title="No payments yet" /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Type</Th><Th>Method</Th><Th>Invoice</Th><Th>Status</Th><Th align="right">Amount</Th><Th /></tr></thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id}>
                  <Td className="text-fg-muted">{dateTime(t.createdAt)}</Td>
                  <Td>{titleCase(t.type)}</Td>
                  <Td className="text-fg-muted">{titleCase(t.method)}</Td>
                  <Td className="text-fg-muted">{t.invoice?.number || '—'}</Td>
                  <Td>
                    <StatusBadge status={t.status === 'succeeded' && t.type === 'payment' && t.refundedCents > 0 ? (t.refundedCents >= t.amountCents ? 'refunded' : 'partially_refunded') : t.status} />
                    {(t.failureReason || t.note) && <span className="ml-2 text-xs text-fg-subtle">{t.failureReason || t.note}</span>}
                  </Td>
                  <Td align="right" className={t.type === 'refund' ? 'text-amber-700 dark:text-amber-400' : ''}>{t.type === 'refund' ? '−' : ''}{money(t.amountCents)}</Td>
                  <Td align="right">
                    {t.type === 'payment' && t.status === 'succeeded' && t.refundedCents < t.amountCents && can('billing.refund') && (
                      <Button size="sm" onClick={() => setRefund({ id: t.id, amountCents: t.amountCents, refundedCents: t.refundedCents, method: t.method })}>Refund</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <PayModal invoice={pay} onClose={() => setPay(null)} onDone={done} />
      <RefundModal transaction={refund} onClose={() => setRefund(null)} onDone={done} />
      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title="Add account credit" size="sm" footer={<><Button onClick={() => setCreditOpen(false)}>Cancel</Button><Button variant="primary" onClick={addCredit} loading={busy} disabled={creditCents <= 0}>Add {money(creditCents)}</Button></>}>
        <div className="space-y-4">
          <Field label="Amount"><MoneyInput cents={creditCents} onChange={setCreditCents} /></Field>
          <Field label="Reason"><Input value={creditNote} onChange={(e) => setCreditNote(e.target.value)} placeholder="Goodwill, referral reward…" maxLength={300} /></Field>
          <FormError message={creditError} />
        </div>
      </Modal>
    </div>
  )
}

interface BookingRow { id: string; status: string; creditUsed: boolean; offerExpiresAt: string | null; session: { id: string; title: string | null; startsAt: string; status: string; classType: { name: string; color: string }; coach: { name: string } | null } }
interface CheckinRow { id: string; timestamp: string; source: string | null; type?: string }

function AttendanceTab({ memberId, stats, onChange }: { memberId: string; stats: Member['stats']; onChange: () => void }) {
  const { dateTime, can } = useSession()
  const toast = useToast()
  const bookings = useApi<{ upcoming: BookingRow[]; past: BookingRow[] }>(`/api/members/${memberId}/bookings`)
  const [checkins, setCheckins] = useState<CheckinRow[] | null>(null)
  useEffect(() => {
    // Legacy endpoint: returns { checkins } without the { data } envelope.
    fetch(`/api/members/${memberId}/checkins`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { checkins: [] }))
      .then((j) => setCheckins(j.checkins || []))
      .catch(() => setCheckins([]))
  }, [memberId])

  const cancel = async (bookingId: string) => {
    try {
      const result = await api<{ late: boolean }>(`/api/bookings/${bookingId}`, { body: { action: 'cancel' } })
      toast.success(result.late ? 'Cancelled as a late cancellation' : 'Booking cancelled')
      bookings.reload()
      onChange()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  const row = (b: BookingRow, upcoming: boolean) => (
    <tr key={b.id}>
      <Td>
        <span className="flex items-center gap-2 font-medium text-fg-heading"><span className="h-2 w-2 rounded-full" style={{ background: b.session.classType.color }} />{b.session.title || b.session.classType.name}</span>
      </Td>
      <Td className="text-fg-muted">{dateTime(b.session.startsAt)}</Td>
      <Td className="text-fg-muted">{b.session.coach?.name || '—'}</Td>
      <Td><StatusBadge status={b.session.status === 'cancelled' ? 'cancelled' : b.status} /></Td>
      <Td align="right">{upcoming && can('bookings.manage') && <Button size="sm" onClick={() => cancel(b.id)}>{b.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel'}</Button>}</Td>
    </tr>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Total visits" value={stats.totalVisits} />
        <MiniStat label="Visits, 30 days" value={stats.visitsLast30Days} />
        <MiniStat label="Upcoming classes" value={stats.upcomingBookings} />
        <MiniStat label="No-shows" value={stats.noShows} tone={stats.noShows > 2 ? 'danger' : undefined} />
      </div>
      <Card padded={false}>
        <CardHeader title="Upcoming classes" className="px-4 pt-4 sm:px-5" />
        {bookings.loading ? <SkeletonRows rows={3} /> : bookings.error ? <ErrorState error={bookings.error} onRetry={bookings.reload} /> : bookings.data!.upcoming.length === 0 ? <EmptyState title="Nothing booked" /> : (
          <Table><thead><tr><Th>Class</Th><Th>When</Th><Th>Coach</Th><Th>Status</Th><Th /></tr></thead><tbody>{bookings.data!.upcoming.map((b) => row(b, true))}</tbody></Table>
        )}
      </Card>
      <Card padded={false}>
        <CardHeader title="Class history" className="px-4 pt-4 sm:px-5" />
        {bookings.loading ? <SkeletonRows rows={3} /> : !bookings.data || bookings.data.past.length === 0 ? <EmptyState title="No class history yet" /> : (
          <Table><thead><tr><Th>Class</Th><Th>When</Th><Th>Coach</Th><Th>Status</Th><Th /></tr></thead><tbody>{bookings.data.past.map((b) => row(b, false))}</tbody></Table>
        )}
      </Card>
      <Card padded={false}>
        <CardHeader title="Check-ins" className="px-4 pt-4 sm:px-5" />
        {checkins === null ? <SkeletonRows rows={3} /> : checkins.length === 0 ? <EmptyState title="No check-ins yet" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Type</Th><Th>Method</Th></tr></thead>
            <tbody>{checkins.map((c) => <tr key={c.id}><Td>{dateTime(c.timestamp)}</Td><Td className="text-fg-muted">{titleCase(c.type || 'open_gym')}</Td><Td className="text-fg-muted">{titleCase(c.source || 'manual')}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

interface MessageRow { id: string; channel: string; subject: string | null; body: string; status: string; error: string | null; createdAt: string; automation: { name: string } | null; campaign: { name: string } | null }

function MessagesTab({ memberId, onCompose }: { memberId: string; onCompose?: () => void }) {
  const { dateTime } = useSession()
  const { data, error, loading, reload } = useApi<MessageRow[]>(`/api/members/${memberId}/messages`)
  return (
    <Card padded={false}>
      <CardHeader title="Email & SMS history" description="Everything sent to this member, including automated messages." className="px-4 pt-4 sm:px-5" action={onCompose && <Button size="sm" variant="primary" onClick={onCompose}>New message</Button>} />
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? <EmptyState title="No messages yet" /> : (
        <ul className="divide-y divide-line/60">
          {data.map((m) => (
            <li key={m.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{m.channel === 'sms' ? 'SMS' : 'Email'}</Badge>
                <span className="text-sm font-medium text-fg-heading">{m.subject || m.body.slice(0, 60)}</span>
                <StatusBadge status={m.status} />
                {(m.automation || m.campaign) && <span className="text-xs text-fg-subtle">{m.automation ? `Automation: ${m.automation.name}` : `Campaign: ${m.campaign!.name}`}</span>}
                <span className="ml-auto text-xs text-fg-subtle">{dateTime(m.createdAt)}</span>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-fg-muted">{m.body}</p>
              {m.error && <p className="mt-1 text-xs text-fg-subtle">{m.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DetailsTab({ member }: { member: Member }) {
  const { date } = useSession()
  const toast = useToast()
  const [sending, setSending] = useState<string | null>(null)
  const send = async (kind: 'send-qr' | 'send-waiver') => {
    setSending(kind)
    try {
      const res = await fetch(`/api/members/${member.id}/${kind}`, { method: 'POST', credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not send')
      toast.success(kind === 'send-qr' ? 'Check-in code emailed' : 'Waiver emailed')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSending(null)
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Check-in code" description="Scan this at the front desk or kiosk." />
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={member.qrCodeUrl} alt={`Check-in QR code for ${member.name}`} className="h-40 w-40 rounded-lg border border-line bg-white p-1" />
          <div className="space-y-2">
            <Button onClick={() => send('send-qr')} loading={sending === 'send-qr'} icon={<Mail className="h-4 w-4" />}>Email code to member</Button>
            {member.portalUrl && (
              <a href={member.portalUrl} target="_blank" rel="noreferrer" className="block"><Button icon={<ExternalLink className="h-4 w-4" />}>Open member portal</Button></a>
            )}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Waiver & documents" />
        {member.waiverEnabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-medium text-fg-heading">Liability waiver</p>
              <p className="text-fg-muted">{member.waiverSignedAt ? `Signed ${date(member.waiverSignedAt)}` : 'Not signed yet'}</p>
            </div>
            {!member.waiverSignedAt && <Button onClick={() => send('send-waiver')} loading={sending === 'send-waiver'}>Email waiver</Button>}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Waivers are turned off. Enable them in <Link href="/settings" className="font-medium text-accent-text underline">Settings</Link>.</p>
        )}
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Communication preferences" />
        <dl className="grid gap-2.5 text-sm sm:grid-cols-2">
          <Detail label="Marketing email" value={member.emailOptIn ? 'Subscribed' : 'Opted out'} />
          <Detail label="Text messages" value={member.smsOptIn ? 'Opted in' : 'Not opted in'} />
        </dl>
      </Card>
    </div>
  )
}

function EditMemberModal({ member, open, onClose, onSaved, onDeleted }: { member: Member; open: boolean; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const toast = useToast()
  const { can } = useSession()
  const [value, setValue] = useState<MemberFormValues>(EMPTY_MEMBER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setValue({
      name: member.name, email: member.email, phone: member.phone || '', dateOfBirth: member.dateOfBirth ? member.dateOfBirth.slice(0, 10) : '',
      addressLine1: member.addressLine1 || '', city: member.city || '', state: member.state || '', postalCode: member.postalCode || '',
      emergencyContactName: member.emergencyContactName || '', emergencyContactPhone: member.emergencyContactPhone || '', goals: member.goals || '',
      medicalNotes: member.medicalNotes || '', leadSource: member.leadSource || '', photoUrl: member.photoUrl || '',
      emailOptIn: member.emailOptIn, smsOptIn: member.smsOptIn, homeLocationId: member.homeLocationId || '', assignedStaffId: member.assignedStaffId || '',
    })
  }, [open, member])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/api/members/${member.id}`, { method: 'PATCH', body: toPayload(value) })
      toast.success('Profile saved')
      onSaved()
      onClose()
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api(`/api/members/${member.id}`, { method: 'DELETE' })
      toast.success('Member deleted')
      onDeleted()
    } catch (err) {
      setError((err as ClientError).message)
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        title="Edit profile"
        size="lg"
        footer={
          <>
            {can('members.delete') && <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}>Delete permanently</Button>}
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" form="edit-member" loading={busy}>Save</Button>
          </>
        }
      >
        <form id="edit-member" onSubmit={save} className="space-y-4">
          <MemberFields value={value} onChange={setValue} />
          <FormError message={error} />
        </form>
      </Modal>
      <ConfirmModal open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} loading={busy} danger title={`Delete ${member.name} permanently?`} confirmLabel="Delete">
        <p>This removes their profile, check-ins, bookings and memberships for good. Payment records are kept for your books. If you might want them back, archive instead.</p>
      </ConfirmModal>
    </>
  )
}

export default function MemberPage() {
  return (
    <Suspense>
      <MemberProfile />
    </Suspense>
  )
}
