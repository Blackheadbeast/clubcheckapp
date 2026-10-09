'use client'

// A gym's public booking page. The same component is the standalone page (/book/<slug>) and the
// widget a gym embeds in its own website (the same page in a frame, with ?embed=1).
//
// The page never decides anything about availability, eligibility or price: it shows what the
// server says, asks the server to book, and shows what the server answers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, CreditCard, Download, Loader2, MapPin, User } from 'lucide-react'
import { api, ClientError, setApiBearer } from '@/lib/client'
import { AddPaymentMethodModal } from '@/components/billing/PaymentMethods'
import { SignDocument } from '@/components/documents/SignDocument'
import { Button, Field, FormError, Input, Select, Skeleton, Textarea, ToastProvider, cn } from '@/components/ui'

// ---------------------------------------------------------------------------
// What the server sends
// ---------------------------------------------------------------------------

export interface Site {
  slug: string; name: string; tagline: string | null; logoUrl: string | null
  theme: { primaryColor: string; buttonStyle: string; appearance: string }
  timezone: string; currency: string; today: string
  locations: { id: string; name: string; address: string | null; phone: string | null }[]
  classTypes: { id: string; name: string; category: string; description: string | null }[]
  categories: string[]; hasClasses: boolean; hasAppointments: boolean; advanceDays: number
  options: { requireAccount: boolean; allowGuests: boolean }
  policy: { cancellation: string | null; classCancelHours: number; termsUrl: string | null }
  contact: { email: string | null; phone: string | null }
}
interface Viewer { name: string; firstName: string; email: string; hasAccount: boolean }
type ClassStatus = 'available' | 'almost_full' | 'full' | 'waitlist' | 'closed' | 'not_open' | 'cancelled'
interface ClassRow { id: string; name: string; category: string; startsAt: string; endsAt: string; durationMin: number; coach: string | null; locationId: string | null; location: string | null; status: ClassStatus; opensAt: string | null; spotsLeft: number; waitlistAvailable: boolean; myBooking: { id: string; status: string } | null }
interface Plan { id: string; name: string; description: string | null; type: string; free: boolean; priceLabel: string; detail: string | null }
interface ClassDetail extends Omit<ClassRow, 'classTypeId' | 'locationId'> { description: string | null; address: string | null; cancelReason: string | null; requiresMembership: boolean; eligibility: { eligible: boolean; code: string | null; message: string | null; usesCredit: boolean } | null; plans: Plan[] }
interface ApptType { id: string; name: string; description: string | null; durationMin: number; paymentMode: string; priceLabel: string; cancelWindowHours: number; locationIds: string[]; coaches: { id: string; name: string; title: string | null }[]; needsAccount: boolean; blocked: 'needs_package' | 'needs_membership' | null; creditsAvailable: number | null; packages: { id: string; name: string; description: string | null; priceLabel: string; sessions: number | null }[] }
interface Slot { startsAt: string; endsAt: string; coaches: { id: string; name: string }[] }
export interface Confirmation {
  kind: 'class' | 'appointment'; id: string; reference: string; status: string; waitlistPosition: number | null
  name: string; startsAt: string; endsAt: string; coach: string | null; location: string | null; address: string | null
  payment: { label: string } | null; can: { cancel: boolean; cancelFree: boolean }; cancelNote: string | null; manageToken: string
  late?: boolean; creditReturned?: boolean; refunded?: boolean
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Keep the page in the gym's chosen light or dark, whatever this browser uses for the staff app. */
function useAppearance(appearance: string) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', appearance === 'dark' || (appearance === 'auto' && media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [appearance])
}

const STATUS: Record<ClassStatus, { label: string; tone: string }> = {
  available: { label: 'Available', tone: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  almost_full: { label: 'Almost full', tone: 'bg-amber-500/15 text-amber-800 dark:text-amber-400' },
  full: { label: 'Full', tone: 'bg-subtle text-fg-muted' },
  waitlist: { label: 'Full · waitlist open', tone: 'bg-sky-500/12 text-sky-800 dark:text-sky-400' },
  closed: { label: 'Booking closed', tone: 'bg-subtle text-fg-muted' },
  not_open: { label: 'Not open yet', tone: 'bg-subtle text-fg-muted' },
  cancelled: { label: 'Cancelled', tone: 'bg-red-500/10 text-red-700 dark:text-red-400' },
}
const titled = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function useFormat(tz: string) {
  return useMemo(() => {
    const f = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts })
    const time = f({ hour: 'numeric', minute: '2-digit' })
    const long = f({ weekday: 'long', month: 'long', day: 'numeric' })
    return {
      time: (iso: string) => time.format(new Date(iso)),
      long: (iso: string) => long.format(new Date(iso)),
      range: (a: string, b: string) => `${time.format(new Date(a))} – ${time.format(new Date(b))}`,
      weekday: (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`)),
      dayNum: (date: string) => Number(date.slice(8, 10)),
      monthDay: (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T12:00:00Z`)),
    }
  }, [tz])
}

const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn('rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6', className)}>{children}</div>
const Notice = ({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'ok' }) => (
  <p className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm', tone === 'warn' ? 'bg-amber-500/10 text-amber-900 dark:text-amber-300' : tone === 'ok' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-subtle text-fg')}>
    {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : tone === 'ok' ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : null}<span className="min-w-0">{children}</span>
  </p>
)
function Primary({ children, className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button variant="primary" size="lg" className={cn('min-h-12 w-full text-base', className)} {...props}>{children}</Button>
}
function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="bk-plain ui-focus -ml-1 mb-3 inline-flex min-h-11 items-center gap-1 px-1 text-sm font-medium text-fg-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden />{children}</button>
}

/** A week of days to pick from, with arrows to move a week at a time. */
function DateStrip({ value, onChange, today, last, fmt }: { value: string; onChange: (d: string) => void; today: string; last: string; fmt: ReturnType<typeof useFormat> }) {
  const [start, setStart] = useState(value)
  useEffect(() => { if (value < start || value > addDays(start, 6)) setStart(value) }, [value, start])
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="flex items-stretch gap-1" role="group" aria-label="Choose a date">
      <button type="button" aria-label="Earlier dates" disabled={start <= today} onClick={() => { const s = addDays(start, -7) < today ? today : addDays(start, -7); setStart(s); onChange(s) }} className="bk-plain ui-focus flex w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle disabled:opacity-30"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
      <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
        {days.map((d) => (
          <button key={d} type="button" disabled={d > last} aria-pressed={d === value} aria-label={fmt.monthDay(d)} onClick={() => onChange(d)}
            className={cn('bk-plain ui-focus flex min-h-14 flex-col items-center justify-center rounded-xl border text-center transition disabled:opacity-30', d === value ? 'border-accent bg-accent text-accent-fg' : 'border-transparent text-fg hover:bg-subtle')}>
            <span className="text-[11px] font-medium uppercase tracking-wide opacity-80">{d === today ? <><span className="hidden sm:inline">Today</span><span className="sm:hidden">{fmt.weekday(d)}</span></> : fmt.weekday(d)}</span>
            <span className="text-base font-semibold tabular-nums">{fmt.dayNum(d)}</span>
          </button>
        ))}
      </div>
      <button type="button" aria-label="Later dates" disabled={addDays(start, 7) > last} onClick={() => { const s = addDays(start, 7); setStart(s); onChange(s) }} className="bk-plain ui-focus flex w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle disabled:opacity-30"><ChevronRight className="h-5 w-5" aria-hidden /></button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

type Picked = { kind: 'class'; classId: string } | { kind: 'appointment'; typeId: string; startsAt?: string; staffId?: string | null }
type Screen = { name: 'browse' } | { name: 'class'; classId: string } | { name: 'appointment'; typeId: string; startsAt?: string; staffId?: string | null } | { name: 'done'; confirmation: Confirmation; note?: string } | { name: 'mine' }

export default function BookingApp(props: { slug: string; initial: Site; embed: boolean }) {
  // The shared "add a card" dialog reports through toasts.
  return <ToastProvider><Booking {...props} /></ToastProvider>
}

function Booking({ slug, initial, embed }: { slug: string; initial: Site; embed: boolean }) {
  const base = `/api/public/booking/${slug}`
  const site = initial
  const fmt = useFormat(site.timezone)
  useAppearance(site.theme.appearance)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [ready, setReady] = useState(false)
  const [screen, setScreen] = useState<Screen>({ name: 'browse' })
  const [tab, setTab] = useState<'classes' | 'appointments'>(site.hasClasses ? 'classes' : 'appointments')
  const [signingIn, setSigningIn] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const remember = useCallback((token: string | null, who: Viewer | null) => {
    setApiBearer(token)
    setViewer(who)
    try { if (token) sessionStorage.setItem(`ccbk:${slug}`, token); else sessionStorage.removeItem(`ccbk:${slug}`) } catch { /* private mode: the session simply lasts for this page */ }
  }, [slug])

  // Who is here, and where they were. A token from earlier in this tab, or (on the standalone page)
  // the member app's own session; then whatever the link they followed says they had picked.
  useEffect(() => {
    let live = true
    let stored: string | null = null
    try { stored = sessionStorage.getItem(`ccbk:${slug}`) } catch { /* ignore */ }
    setApiBearer(stored)
    api<{ viewer: Viewer | null; token: string | null }>(`${base}?visit=1`)
      .then((r) => { if (live) remember(r.token, r.viewer) })
      .catch(() => { if (live) remember(null, null) })
      .finally(() => {
        if (!live) return
        const q = new URLSearchParams(window.location.search)
        if (q.get('class')) setScreen({ name: 'class', classId: q.get('class')! })
        else if (q.get('type')) { setTab('appointments'); setScreen({ name: 'appointment', typeId: q.get('type')!, startsAt: q.get('at') || undefined, staffId: q.get('coach') }) }
        if (q.get('signin') === '1') setSigningIn(true)
        setReady(true)
      })
    return () => { live = false }
  }, [base, slug, remember])

  // Inside someone else's page: tell it how tall we are so it can size the frame, and never scroll inside it.
  useEffect(() => {
    if (!embed || !root.current) return
    const send = () => window.parent?.postMessage({ type: 'clubcheck:booking:height', slug, height: Math.ceil(root.current!.getBoundingClientRect().height) }, '*')
    const observer = new ResizeObserver(send)
    observer.observe(root.current)
    send()
    return () => observer.disconnect()
  }, [embed, slug])

  const go = (next: Screen) => {
    setScreen(next)
    if (embed) window.parent?.postMessage({ type: 'clubcheck:booking:scroll', slug }, '*')
    else window.scrollTo({ top: 0 })
  }
  const signOut = () => { remember(null, null); go({ name: 'browse' }) }

  return (
    <div ref={root} className={cn('bk-root mx-auto w-full max-w-3xl text-fg', embed ? 'px-1 py-2' : 'px-4 py-6 sm:py-10')}>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {site.logoUrl && <img src={site.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-line bg-surface object-contain" />}
        <div className="min-w-0 flex-1 basis-40">
          <h1 className={cn('break-words font-semibold leading-tight tracking-tight text-fg-heading', embed ? 'text-lg' : 'text-2xl')}>{embed ? `Book at ${site.name}` : site.name}</h1>
          {site.tagline && <p className="mt-0.5 text-sm text-fg-muted">{site.tagline}</p>}
        </div>
        <div className="flex items-center gap-1 text-sm">
          {!ready ? null : viewer ? (
            <>
              <button type="button" onClick={() => go({ name: 'mine' })} className="bk-plain ui-focus inline-flex min-h-11 items-center gap-1.5 px-2 font-medium text-fg hover:text-accent-text"><User className="h-4 w-4" aria-hidden />{viewer.firstName}&apos;s bookings</button>
              <button type="button" onClick={signOut} className="bk-plain ui-focus min-h-11 px-2 text-fg-muted hover:text-fg">{viewer.hasAccount ? 'Sign out' : 'Not you?'}</button>
            </>
          ) : (
            <button type="button" onClick={() => setSigningIn(true)} className="bk-plain ui-focus min-h-11 px-2 font-medium text-accent-text">Sign in</button>
          )}
        </div>
      </header>

      {signingIn && !viewer && (
        <Panel className="mb-5">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-fg-heading">Sign in</h2><button type="button" onClick={() => setSigningIn(false)} className="bk-plain ui-focus min-h-11 px-2 text-sm text-fg-muted">Close</button></div>
          <SignIn base={base} onDone={(token, who) => { remember(token, who); setSigningIn(false) }} />
        </Panel>
      )}

      {screen.name === 'browse' && (
        <>
          {site.hasClasses && site.hasAppointments && (
            <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
              {(['classes', 'appointments'] as const).map((t) => <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('bk-plain ui-focus min-h-11 rounded-lg text-sm font-semibold transition', tab === t ? 'bg-surface text-fg-heading shadow-sm' : 'text-fg-muted hover:text-fg')}>{t === 'classes' ? 'Classes' : 'Appointments'}</button>)}
            </div>
          )}
          {!site.hasClasses && !site.hasAppointments ? (
            <Panel><p className="text-center text-fg-muted">Nothing can be booked online just yet.{site.contact.phone || site.contact.email ? ` Get in touch: ${[site.contact.phone, site.contact.email].filter(Boolean).join(' · ')}` : ''}</p></Panel>
          ) : tab === 'classes' && site.hasClasses ? (
            <Classes base={base} site={site} fmt={fmt} viewerKey={viewer?.email || ''} onPick={(classId) => go({ name: 'class', classId })} />
          ) : (
            <AppointmentTypes base={base} viewerKey={viewer?.email || ''} onPick={(typeId) => go({ name: 'appointment', typeId })} />
          )}
        </>
      )}

      {screen.name === 'class' && <ClassScreen key={screen.classId} base={base} site={site} fmt={fmt} classId={screen.classId} viewer={viewer} onViewer={remember} onBack={() => go({ name: 'browse' })} onDone={(confirmation, note) => go({ name: 'done', confirmation, note })} />}
      {screen.name === 'appointment' && <AppointmentScreen key={screen.typeId} base={base} site={site} fmt={fmt} typeId={screen.typeId} resumeAt={screen.startsAt} resumeCoach={screen.staffId} viewer={viewer} onViewer={remember} onBack={() => go({ name: 'browse' })} onDone={(confirmation) => go({ name: 'done', confirmation })} />}
      {screen.name === 'done' && <Confirmed base={base} site={site} fmt={fmt} confirmation={screen.confirmation} note={screen.note} embed={embed} onAgain={() => go({ name: 'browse' })} onChanged={(confirmation) => setScreen({ name: 'done', confirmation })} />}
      {screen.name === 'mine' && viewer && <Mine base={base} site={site} fmt={fmt} embed={embed} onBack={() => go({ name: 'browse' })} />}

      <footer className="mt-8 space-y-1 text-center text-xs text-fg-subtle">
        {(site.contact.phone || site.contact.email) && <p>Questions? {[site.contact.phone, site.contact.email].filter(Boolean).join(' · ')}</p>}
        {site.policy.termsUrl && <p><a href={site.policy.termsUrl} target="_blank" rel="noopener noreferrer" className="underline">Terms and waiver</a></p>}
        <p>Booking by ClubCheck</p>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

function Classes({ base, site, fmt, viewerKey, onPick }: { base: string; site: Site; fmt: ReturnType<typeof useFormat>; viewerKey: string; onPick: (id: string) => void }) {
  const [date, setDate] = useState(site.today)
  const [locationId, setLocationId] = useState('')
  const [category, setCategory] = useState('')
  const [rows, setRows] = useState<ClassRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const last = addDays(site.today, site.advanceDays + 7)

  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    const q = new URLSearchParams({ date, days: '1', ...(locationId && { locationId }), ...(category && { category }) })
    api<{ classes: ClassRow[] }>(`${base}/classes?${q}`).then((r) => { if (live) setRows(r.classes) }).catch((e: ClientError) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [base, date, locationId, category, tick, viewerKey])

  return (
    <Panel>
      {(site.locations.length > 1 || site.categories.length > 1) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {site.locations.length > 1 && <Select aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-11 min-w-0 flex-1 basis-40"><option value="">All locations</option>{site.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
          {site.categories.length > 1 && <Select aria-label="Class type" value={category} onChange={(e) => setCategory(e.target.value)} className="h-11 min-w-0 flex-1 basis-40"><option value="">All class types</option>{site.categories.map((c) => <option key={c} value={c}>{titled(c)}</option>)}</Select>}
        </div>
      )}
      <DateStrip value={date} onChange={setDate} today={site.today} last={last} fmt={fmt} />
      <h2 className="mb-2 mt-5 text-sm font-semibold text-fg-heading">{fmt.monthDay(date)}</h2>
      {error ? (
        <div className="space-y-3 py-4 text-center"><p className="text-sm text-fg-muted">{error}</p><Button onClick={() => setTick((t) => t + 1)}>Try again</Button></div>
      ) : !rows ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading classes"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-fg-muted">No classes on this day. Try another date.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const state = STATUS[c.status]
            const canOpen = c.status !== 'cancelled'
            const mine = c.myBooking
            return (
              <li key={c.id}>
                <button type="button" disabled={!canOpen} onClick={() => onPick(c.id)} className={cn('bk-plain ui-focus flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line p-3 text-left transition sm:p-4', canOpen ? 'hover:border-accent/60 hover:bg-subtle/50' : 'opacity-70')}>
                  <span className="w-[5.25rem] shrink-0"><span className="block whitespace-nowrap text-base font-semibold tabular-nums text-fg-heading">{fmt.time(c.startsAt)}</span><span className="block text-xs text-fg-muted">{c.durationMin} min</span></span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className={cn('block break-words font-semibold text-fg-heading', c.status === 'cancelled' && 'line-through')}>{c.name}</span>
                    <span className="block truncate text-sm text-fg-muted">{[c.coach, c.location].filter(Boolean).join(' · ') || titled(c.category)}</span>
                  </span>
                  <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                    {mine ? <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent-text">{mine.status === 'waitlisted' ? 'On the waitlist' : mine.status === 'offered' ? 'Spot offered' : 'You’re booked'}</span> : <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', state.tone)}>{state.label}</span>}
                    {!mine && ['available', 'almost_full'].includes(c.status) && <span className="text-xs text-fg-muted">{c.spotsLeft} spot{c.spotsLeft === 1 ? '' : 's'} left</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function ClassScreen({ base, site, fmt, classId, viewer, onViewer, onBack, onDone }: { base: string; site: Site; fmt: ReturnType<typeof useFormat>; classId: string; viewer: Viewer | null; onViewer: (token: string | null, who: Viewer | null) => void; onBack: () => void; onDone: (c: Confirmation, note?: string) => void }) {
  const [detail, setDetail] = useState<ClassDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [addingCard, setAddingCard] = useState(false)
  const [needs, setNeeds] = useState<Needs>(null)
  const key = useRef(newKey())

  useEffect(() => {
    let live = true
    setError(null)
    api<ClassDetail>(`${base}/classes/${classId}`).then((d) => { if (live) setDetail(d) }).catch((e: ClientError) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [base, classId, viewer?.email, tick])

  const book = async (joinWaitlist: boolean, note?: string) => {
    setBusy('book')
    setProblem(null)
    try {
      const c = await bookWithKey<Confirmation & { usedCredit?: boolean }>(`${base}/bookings`, { classId, joinWaitlist }, key.current)
      onDone(c, note)
    } catch (e) {
      const err = e as ClientError
      const documents = neededFrom(err)
      if (documents) { key.current = newKey(); setNeeds({ documents, retry: () => { setNeeds(null); book(joinWaitlist, note) } }); return }
      setProblem(err.message)
      // Whatever went wrong, show what is true now: it may have just filled.
      key.current = newKey()
      setTick((t) => t + 1)
    } finally {
      setBusy(null)
    }
  }
  const startPlan = async (plan: Plan) => {
    setBusy(plan.id)
    setProblem(null)
    try {
      await bookWithKey(`${base}/plans`, { planId: plan.id }, `${key.current}:plan:${plan.id}`)
      await book(detail?.status === 'waitlist', plan.free ? `${plan.name} started.` : `${plan.name} bought.`)
    } catch (e) {
      const err = e as ClientError
      const documents = neededFrom(err)
      if (documents) setNeeds({ documents, retry: () => { setNeeds(null); startPlan(plan) } })
      else if (err.code === 'no_payment_method') setAddingCard(true)
      else setProblem(err.message)
      setBusy(null)
    }
  }

  if (error) return <Panel><BackLink onClick={onBack}>All classes</BackLink><p className="py-6 text-center text-fg-muted">{error}</p><Button className="mx-auto flex" onClick={() => setTick((t) => t + 1)}>Try again</Button></Panel>
  if (!detail) return <Panel><div className="space-y-3" aria-busy="true"><Skeleton className="h-6 w-28" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-12 rounded-xl" /></div></Panel>

  const state = STATUS[detail.status]
  const open = ['available', 'almost_full', 'waitlist'].includes(detail.status)
  const waitlist = detail.status === 'waitlist'
  const e = detail.eligibility
  return (
    <Panel>
      <BackLink onClick={onBack}>All classes</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold leading-tight text-fg-heading">{detail.name}</h2>
          <p className="mt-1 text-fg">{fmt.long(detail.startsAt)}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted"><span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden />{fmt.range(detail.startsAt, detail.endsAt)}</span>{detail.coach && <span className="inline-flex items-center gap-1"><User className="h-4 w-4" aria-hidden />{detail.coach}</span>}{detail.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden />{detail.location}</span>}</p>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', state.tone)}>{state.label}{['available', 'almost_full'].includes(detail.status) ? ` · ${detail.spotsLeft} left` : ''}</span>
      </div>
      {detail.description && <p className="mt-3 text-sm text-fg-muted">{detail.description}</p>}

      <div className="mt-5 space-y-3">
        {problem && <FormError message={problem} />}
        {needs ? (
          <RequiredDocuments base={base} needs={needs} onCancel={() => setNeeds(null)} />
        ) : detail.myBooking ? (
          <Notice tone="ok">{detail.myBooking.status === 'waitlisted' ? 'You are on the waitlist for this class.' : 'You are booked into this class.'} See it under your bookings.</Notice>
        ) : detail.status === 'cancelled' ? (
          <Notice tone="warn">This class has been cancelled{detail.cancelReason ? `: ${detail.cancelReason}` : '.'}</Notice>
        ) : detail.status === 'closed' ? (
          <Notice>Booking for this class has closed.</Notice>
        ) : detail.status === 'not_open' ? (
          <Notice>Booking opens {detail.opensAt ? fmt.long(detail.opensAt) : 'soon'}.</Notice>
        ) : detail.status === 'full' ? (
          <Notice>This class and its waitlist are full.</Notice>
        ) : !viewer ? (
          <Identify base={base} site={site} resume={{ classId }} lead={waitlist ? 'This class is full. Enter your details to join the waitlist.' : detail.requiresMembership ? 'Tell us who you are and we will show how you can join this class.' : 'Enter your details to book.'} onViewer={onViewer} />
        ) : !e ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-fg-muted" aria-label="Checking" /></div>
        ) : e.eligible ? (
          <>
            {waitlist && <Notice>This class is full. Join the waitlist and we will email you if a spot opens.</Notice>}
            {e.usesCredit && !waitlist && <Notice>This uses one class from your pass.</Notice>}
            <Primary loading={busy === 'book'} onClick={() => book(waitlist)}>{waitlist ? 'Join the waitlist' : 'Confirm booking'}</Primary>
            <p className="text-center text-xs text-fg-muted">Booking as {viewer.name} ({viewer.email})</p>
          </>
        ) : (
          <>
            <Notice tone="warn">{e.code === 'no_membership' || e.code === 'plan_not_allowed' ? 'This class needs a membership or pass.' : e.message}</Notice>
            {detail.plans.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-fg-heading">Ways to join this class</p>
                <ul className="space-y-2">
                  {detail.plans.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line p-3">
                      <div className="min-w-0 flex-1 basis-44"><p className="font-semibold text-fg-heading">{p.name}</p><p className="text-sm text-fg-muted">{[p.priceLabel, p.detail].filter(Boolean).join(' · ')}</p>{p.description && <p className="mt-0.5 text-xs text-fg-subtle">{p.description}</p>}</div>
                      {p.free && (viewer.hasAccount || p.type !== 'recurring') ? <Button variant="primary" className="min-h-11" loading={busy === p.id} disabled={!!busy} onClick={() => startPlan(p)}>Start and book</Button>
                        : viewer.hasAccount ? <Button variant="primary" className="min-h-11" loading={busy === p.id} disabled={!!busy} icon={<CreditCard className="h-4 w-4" />} onClick={() => startPlan(p)}>Buy and book</Button>
                        : <span className="text-xs text-fg-muted">Needs an account</span>}
                    </li>
                  ))}
                </ul>
                {!viewer.hasAccount && detail.plans.some((p) => !p.free || p.type === 'recurring') && <p className="mt-3 text-sm text-fg-muted">To buy a membership or pass, create an account first: choose “Not you?” above, then “Create an account”.</p>}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Please get in touch and we will get you set up{site.contact.phone || site.contact.email ? `: ${[site.contact.phone, site.contact.email].filter(Boolean).join(' · ')}` : '.'}</p>
            )}
          </>
        )}
        <Policy site={site} hours={site.policy.classCancelHours} />
      </div>
      <AddPaymentMethodModal base={`${base}/me`} open={addingCard} onClose={() => setAddingCard(false)} onSaved={() => { setAddingCard(false); setProblem('Card saved. Choose the plan again to buy it.') }} />
    </Panel>
  )
}

interface Needed { id: string; name: string; type: string }
type Needs = { documents: Needed[]; retry: () => void } | null
const neededFrom = (err: ClientError): Needed[] | null => {
  const list = err.code === 'documents_required' && err.details && typeof err.details === 'object' ? (err.details as { documents?: Needed[] }).documents : null
  return Array.isArray(list) && list.length ? list : null
}

/**
 * The gym needs something signed before this can be booked. Each document is read and signed
 * here, in place; when the last one is signed the booking carries on by itself. Declining leaves
 * the booking where it is: not made.
 */
function RequiredDocuments({ base, needs, onCancel }: { base: string; needs: NonNullable<Needs>; onCancel: () => void }) {
  const [state, setState] = useState<Record<string, 'signed' | 'declined'>>({})
  const [open, setOpen] = useState<string | null>(needs.documents.length === 1 ? needs.documents[0].id : null)
  const declined = needs.documents.filter((d) => state[d.id] === 'declined')
  const done = (id: string, outcome: 'signed' | 'declined') => {
    const next = { ...state, [id]: outcome }
    setState(next)
    if (needs.documents.every((d) => next[d.id] === 'signed')) needs.retry()
  }
  if (open) {
    const doc = needs.documents.find((d) => d.id === open)!
    return (
      <div>
        <Notice>Before you book, please read and sign <span className="font-semibold">{doc.name}</span>.</Notice>
        <div className="mt-4"><SignDocument compact url={`${base}/me/documents/${open}`} closeLabel={state[open] ? 'Continue' : 'Not now'} onDone={(outcome) => done(open, outcome)} onClose={() => (needs.documents.length > 1 || state[open] === 'declined' ? setOpen(null) : state[open] === 'signed' ? needs.retry() : onCancel())} /></div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {declined.length > 0 ? <Notice tone="warn">You declined {declined.map((d) => d.name).join(' and ')}, so this booking has not been made. If you have questions, please get in touch with us.</Notice> : <Notice>Before you book, {needs.documents.length === 1 ? 'one document needs' : `${needs.documents.length} documents need`} your signature.</Notice>}
      <ul className="space-y-2">
        {needs.documents.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line p-3">
            <span className="min-w-0 flex-1 basis-44 font-semibold text-fg-heading">{d.name}</span>
            {state[d.id] === 'signed' ? <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" aria-hidden />Signed</span> : state[d.id] === 'declined' ? <span className="text-sm text-fg-muted">Declined</span> : <Button variant="primary" className="min-h-11" onClick={() => setOpen(d.id)}>Review and sign</Button>}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} className="bk-plain ui-focus min-h-11 px-1 text-sm font-medium text-fg-muted">Back</button>
    </div>
  )
}

function Policy({ site, hours }: { site: Site; hours: number }) {
  const text = site.policy.cancellation || (hours > 0 ? `Free cancellation up to ${hours} hour${hours === 1 ? '' : 's'} before the start.` : null)
  if (!text) return null
  return <p className="border-t border-line pt-3 text-xs text-fg-muted"><span className="font-medium text-fg">Cancellation policy.</span> {text}</p>
}

/** POST with an Idempotency-Key, so a double tap or a retry after a dropped connection books (and charges) once. */
async function bookWithKey<T>(url: string, body: unknown, key: string): Promise<T> {
  const bearer = (() => { try { return sessionStorage.getItem(`ccbk:${url.split('/')[4]}`) } catch { return null } })()
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(bearer && { Authorization: `Bearer ${bearer}` }) }, body: JSON.stringify(body) })
  } catch {
    throw new ClientError("Can't reach the server. Check your connection and try again.", 0, 'network')
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new ClientError(json?.error || 'Something went wrong. Please try again.', res.status, json?.code, json?.details)
  return json.data as T
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

function AppointmentTypes({ base, viewerKey, onPick }: { base: string; viewerKey: string; onPick: (id: string) => void }) {
  const [types, setTypes] = useState<ApptType[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setError(null)
    api<ApptType[]>(`${base}/appointment-types`).then((t) => { if (live) setTypes(t) }).catch((e: ClientError) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [base, viewerKey, tick])
  return (
    <Panel>
      <h2 className="mb-3 text-sm font-semibold text-fg-heading">Choose an appointment</h2>
      {error ? <div className="space-y-3 py-4 text-center"><p className="text-sm text-fg-muted">{error}</p><Button onClick={() => setTick((t) => t + 1)}>Try again</Button></div>
        : !types ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
        : types.length === 0 ? <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-fg-muted">No appointments can be booked online right now.</p>
        : (
          <ul className="space-y-2">
            {types.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onPick(t.id)} className="bk-plain ui-focus flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line p-4 text-left transition hover:border-accent/60 hover:bg-subtle/50">
                  <span className="min-w-0 flex-1 basis-44"><span className="block break-words font-semibold text-fg-heading">{t.name}</span><span className="block text-sm text-fg-muted">{t.durationMin} min{t.coaches.length === 1 ? ` · with ${t.coaches[0].name}` : ''}</span>{t.description && <span className="mt-0.5 block text-sm text-fg-subtle">{t.description}</span>}</span>
                  <span className="ml-auto shrink-0 text-sm font-semibold text-fg-heading">{t.priceLabel}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  )
}

function AppointmentScreen({ base, site, fmt, typeId, resumeAt, resumeCoach, viewer, onViewer, onBack, onDone }: { base: string; site: Site; fmt: ReturnType<typeof useFormat>; typeId: string; resumeAt?: string; resumeCoach?: string | null; viewer: Viewer | null; onViewer: (token: string | null, who: Viewer | null) => void; onBack: () => void; onDone: (c: Confirmation) => void }) {
  const [types, setTypes] = useState<ApptType[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState(resumeAt ? dayOf(resumeAt, site.timezone) : site.today)
  const [staffId, setStaffId] = useState(resumeCoach || '')
  const [locationId, setLocationId] = useState('')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(resumeAt || null)
  const [notes, setNotes] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [addingCard, setAddingCard] = useState(false)
  const [needs, setNeeds] = useState<Needs>(null)
  const [tick, setTick] = useState(0)
  const key = useRef(newKey())

  useEffect(() => {
    let live = true
    setError(null)
    api<ApptType[]>(`${base}/appointment-types`).then((t) => { if (live) setTypes(t) }).catch((e: ClientError) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [base, viewer?.email, tick])
  const type = types?.find((t) => t.id === typeId) || null

  useEffect(() => {
    if (!type) return
    let live = true
    setSlots(null)
    setSlotError(null)
    const q = new URLSearchParams({ typeId, date, ...(staffId && { staffId }), ...(locationId && { locationId }) })
    api<Slot[]>(`${base}/slots?${q}`).then((s) => { if (live) setSlots(s) }).catch((e: ClientError) => { if (live) setSlotError(e.message) })
    return () => { live = false }
  }, [base, typeId, type, date, staffId, locationId, tick, viewer?.email])

  if (error) return <Panel><BackLink onClick={onBack}>All appointments</BackLink><p className="py-6 text-center text-fg-muted">{error}</p><Button className="mx-auto flex" onClick={() => setTick((t) => t + 1)}>Try again</Button></Panel>
  if (!types) return <Panel><div className="space-y-3" aria-busy="true"><Skeleton className="h-6 w-28" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div></Panel>
  if (!type) return <Panel><BackLink onClick={onBack}>All appointments</BackLink><p className="py-6 text-center text-fg-muted">That appointment is not available to book online.</p></Panel>

  const locations = site.locations.filter((l) => type.locationIds.length === 0 || type.locationIds.includes(l.id))
  const picked = chosen ? slots?.find((s) => s.startsAt === chosen) || null : null
  const last = addDays(site.today, site.advanceDays)

  const book = async () => {
    if (!chosen) return
    setBusy('book')
    setProblem(null)
    try {
      onDone(await bookWithKey<Confirmation>(`${base}/appointments`, { typeId, startsAt: chosen, staffId: staffId || null, locationId: locationId || null, notes: notes || null }, key.current))
    } catch (e) {
      const err = e as ClientError
      const documents = neededFrom(err)
      if (documents) { key.current = newKey(); setNeeds({ documents, retry: () => { setNeeds(null); book() } }); return }
      if (err.code === 'no_payment_method') setAddingCard(true)
      setProblem(err.message)
      key.current = newKey()
      // The time may have just gone, or the card was declined: either way, show what is free now.
      setTick((t) => t + 1)
    } finally {
      setBusy(null)
    }
  }
  const buy = async (packageId: string) => {
    setBusy(packageId)
    setProblem(null)
    try {
      await bookWithKey(`${base}/plans`, { planId: packageId }, `${key.current}:plan:${packageId}`)
      setTick((t) => t + 1)
    } catch (e) {
      const err = e as ClientError
      const documents = neededFrom(err)
      if (documents) setNeeds({ documents, retry: () => { setNeeds(null); buy(packageId) } })
      else if (err.code === 'no_payment_method') setAddingCard(true)
      else setProblem(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel>
      <BackLink onClick={onBack}>All appointments</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="break-words text-xl font-semibold leading-tight text-fg-heading">{type.name}</h2><p className="text-sm text-fg-muted">{type.durationMin} minutes</p></div>
        <span className="text-base font-semibold text-fg-heading">{type.priceLabel}</span>
      </div>
      {type.description && <p className="mt-2 text-sm text-fg-muted">{type.description}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {type.coaches.length > 1 && <Select aria-label="Coach" value={staffId} onChange={(e) => { setStaffId(e.target.value); setChosen(null) }} className="h-11 min-w-0 flex-1 basis-40"><option value="">Any available coach</option>{type.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
        {locations.length > 1 && <Select aria-label="Location" value={locationId} onChange={(e) => { setLocationId(e.target.value); setChosen(null) }} className="h-11 min-w-0 flex-1 basis-40"><option value="">Any location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
      </div>
      <div className="mt-4"><DateStrip value={date} onChange={(d) => { setDate(d); setChosen(null) }} today={site.today} last={last} fmt={fmt} /></div>
      <h3 className="mb-2 mt-5 text-sm font-semibold text-fg-heading">{fmt.monthDay(date)}</h3>
      {slotError ? <div className="space-y-3 py-4 text-center"><p className="text-sm text-fg-muted">{slotError}</p><Button onClick={() => setTick((t) => t + 1)}>Try again</Button></div>
        : !slots ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true" aria-label="Loading times">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
        : slots.length === 0 ? <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-fg-muted">No free times on this day. Try another date{staffId ? ' or any available coach' : ''}.</p>
        : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Available times">
            {slots.map((s) => <button key={s.startsAt} type="button" aria-pressed={s.startsAt === chosen} onClick={() => { setChosen(s.startsAt); setProblem(null) }} className={cn('bk-plain ui-focus min-h-11 rounded-lg border text-sm font-semibold tabular-nums transition', s.startsAt === chosen ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg hover:border-accent/60')}>{fmt.time(s.startsAt)}</button>)}
          </div>
        )}

      {chosen && (
        <div className="mt-5 space-y-3 border-t border-line pt-5">
          <p className="font-semibold text-fg-heading">{fmt.long(chosen)} at {fmt.time(chosen)}{picked && !staffId && picked.coaches.length === 1 ? ` with ${picked.coaches[0].name}` : staffId ? ` with ${type.coaches.find((c) => c.id === staffId)?.name || ''}` : ''}</p>
          {problem && <FormError message={problem} />}
          {needs ? (
            <RequiredDocuments base={base} needs={needs} onCancel={() => setNeeds(null)} />
          ) : slots && !picked ? (
            <Notice tone="warn">That time is no longer free. Please choose another.</Notice>
          ) : !viewer ? (
            <Identify base={base} site={site} resume={{ typeId, startsAt: chosen, ...(staffId && { staffId }) }} accountOnly={type.needsAccount} lead={type.needsAccount ? (type.paymentMode === 'paid' ? 'Sign in or create an account to book and pay.' : 'Sign in or create an account to book this.') : 'Enter your details to book.'} onViewer={onViewer} />
          ) : type.needsAccount && !viewer.hasAccount ? (
            <Notice tone="warn">This needs an account. Choose “Not you?” above, then create an account or sign in.</Notice>
          ) : type.blocked ? (
            <>
              <Notice tone="warn">{type.blocked === 'needs_package' ? 'You need sessions to book this.' : 'This is for members on a particular plan.'}</Notice>
              {type.packages.length > 0 ? (
                <ul className="space-y-2">
                  {type.packages.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line p-3">
                      <div className="min-w-0 flex-1 basis-44"><p className="font-semibold text-fg-heading">{p.name}</p><p className="text-sm text-fg-muted">{p.priceLabel}{p.sessions ? ` · ${p.sessions} sessions` : ''}</p></div>
                      <Button variant="primary" className="min-h-11" loading={busy === p.id} disabled={!!busy} icon={<CreditCard className="h-4 w-4" />} onClick={() => buy(p.id)}>Buy</Button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-fg-muted">Please get in touch and we will get you set up{site.contact.phone || site.contact.email ? `: ${[site.contact.phone, site.contact.email].filter(Boolean).join(' · ')}` : '.'}</p>}
            </>
          ) : (
            <>
              <Field label="Anything we should know? (optional)"><Textarea rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
              {type.paymentMode === 'paid' && <Notice>{type.priceLabel} will be charged to your saved card when you confirm.</Notice>}
              {type.paymentMode === 'credit' && type.creditsAvailable != null && <Notice>You have {type.creditsAvailable} session{type.creditsAvailable === 1 ? '' : 's'}. This uses {type.priceLabel}.</Notice>}
              <Primary loading={busy === 'book'} onClick={book}>{type.paymentMode === 'paid' ? `Pay ${type.priceLabel} and book` : 'Confirm booking'}</Primary>
              <p className="text-center text-xs text-fg-muted">Booking as {viewer.name} ({viewer.email})</p>
            </>
          )}
          <Policy site={site} hours={type.cancelWindowHours} />
        </div>
      )}
      <AddPaymentMethodModal base={`${base}/me`} open={addingCard} onClose={() => setAddingCard(false)} onSaved={() => { setAddingCard(false); setProblem('Card saved. Confirm again to book.') }} />
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Who are you
// ---------------------------------------------------------------------------

function SignIn({ base, onDone }: { base: string; onDone: (token: string, who: Viewer) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ token: string; viewer: Viewer }>(`${base}/session`, { body: { email, password } })
      onDone(r.token, r.viewer)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {problem && <FormError message={problem} />}
      <Field label="Email"><Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" /></Field>
      <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" /></Field>
      <Primary type="submit" loading={busy}>Sign in</Primary>
      <p className="text-center text-sm"><a href="/member/forgot" target="_blank" rel="noopener noreferrer" className="ui-focus inline-flex min-h-11 items-center rounded px-2 text-accent-text underline">Forgot password?</a></p>
    </form>
  )
}

function Identify({ base, site, resume, lead, accountOnly, onViewer }: { base: string; site: Site; resume: Record<string, string>; lead: string; accountOnly?: boolean; onViewer: (token: string | null, who: Viewer | null) => void }) {
  const [wantAccount, setWantAccount] = useState(false)
  const guests = site.options.allowGuests && !accountOnly && !wantAccount
  const [mode, setMode] = useState<'new' | 'signin'>('new')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const r = await api<{ status: 'ok' | 'check_email'; token?: string; viewer?: Viewer }>(`${base}/${guests ? 'guest' : 'account'}`, { body: { name, email, phone: phone || null, resume } })
      if (r.status === 'ok' && r.token && r.viewer) onViewer(r.token, r.viewer)
      else setSent(email)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-3 rounded-xl bg-subtle p-4 text-sm">
        <p className="font-semibold text-fg-heading">Check your email</p>
        <p className="text-fg">We have sent a link to <span className="font-medium">{sent}</span>. Open it to {guests ? 'confirm it is you and ' : 'set your password and '}finish booking. Your choice is saved in the link.</p>
        <p className="text-fg-muted">Nothing is booked yet. No email after a few minutes? Check spam, or <button type="button" onClick={() => setSent(null)} className="bk-plain ui-focus inline-flex min-h-11 items-center px-1 text-accent-text underline">try again</button></p>
      </div>
    )
  }
  return (
    <div>
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
        <button role="tab" type="button" aria-selected={mode === 'new'} onClick={() => setMode('new')} className={cn('bk-plain ui-focus min-h-11 rounded-lg text-sm font-semibold', mode === 'new' ? 'bg-surface text-fg-heading shadow-sm' : 'text-fg-muted')}>{guests ? 'New here' : 'Create an account'}</button>
        <button role="tab" type="button" aria-selected={mode === 'signin'} onClick={() => setMode('signin')} className={cn('bk-plain ui-focus min-h-11 rounded-lg text-sm font-semibold', mode === 'signin' ? 'bg-surface text-fg-heading shadow-sm' : 'text-fg-muted')}>I have an account</button>
      </div>
      {mode === 'signin' ? <SignIn base={base} onDone={onViewer} /> : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-fg-muted">{lead}{!guests ? ' We will email you a link to set a password.' : ''}</p>
          {problem && <FormError message={problem} />}
          <Field label="Full name"><Input autoComplete="name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-base" /></Field>
          <Field label="Email"><Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" /></Field>
          <Field label="Mobile number (optional)" hint="Only used if we need to reach you about this booking. We will not text you unless you ask us to."><Input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 text-base" /></Field>
          <Primary type="submit" loading={busy}>Continue</Primary>
          {site.options.allowGuests && !accountOnly && <p className="text-center text-sm text-fg-muted">{wantAccount ? 'Rather not make an account? ' : 'Want to pay online and manage bookings? '}<button type="button" onClick={() => setWantAccount((v) => !v)} className="bk-plain ui-focus inline-flex min-h-11 items-center px-1 text-accent-text underline">{wantAccount ? 'Book as a guest' : 'Create an account'}</button></p>}
          {site.policy.termsUrl && <p className="text-center text-xs text-fg-muted">By continuing you agree to the <a href={site.policy.termsUrl} target="_blank" rel="noopener noreferrer" className="underline">terms and waiver</a>.</p>}
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirmation, and coming back to it
// ---------------------------------------------------------------------------

const googleUrl = (site: Site, c: Confirmation) => {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const q = new URLSearchParams({ action: 'TEMPLATE', text: `${c.name} at ${site.name}`, dates: `${stamp(c.startsAt)}/${stamp(c.endsAt)}`, location: [site.name, c.location, c.address].filter(Boolean).join(', '), details: [c.coach ? `With ${c.coach}` : null, `Reference ${c.reference}`].filter(Boolean).join('. ') })
  return `https://calendar.google.com/calendar/render?${q}`
}

export function BookingCard({ base, site, fmt, c, onChanged, compact }: { base: string; site: Site; fmt: ReturnType<typeof useFormat>; c: Confirmation; onChanged: (c: Confirmation) => void; compact?: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const cancelled = ['cancelled', 'late_cancelled'].includes(c.status)
  const cancel = async () => {
    setBusy(true)
    setProblem(null)
    try {
      onChanged(await api<Confirmation>(`${base}/manage/${c.manageToken}`, { method: 'POST', body: {} }))
      setConfirming(false)
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn('rounded-xl border border-line', compact ? 'p-3' : 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('break-words font-semibold text-fg-heading', cancelled && 'line-through')}>{c.name}</p>
          <p className="text-sm text-fg">{fmt.long(c.startsAt)}</p>
          <p className="text-sm text-fg-muted">{fmt.range(c.startsAt, c.endsAt)}{c.coach ? ` · ${c.coach}` : ''}</p>
          {(c.location || c.address) && <p className="mt-0.5 flex items-start gap-1 text-sm text-fg-muted"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 break-words">{[c.location, c.address].filter(Boolean).join(', ')}</span></p>}
          {c.payment && <p className="mt-0.5 text-sm text-fg-muted">{c.payment.label}</p>}
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', cancelled ? 'bg-red-500/10 text-red-700 dark:text-red-400' : c.status === 'waitlisted' ? 'bg-sky-500/12 text-sky-800 dark:text-sky-400' : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400')}>{cancelled ? 'Cancelled' : c.status === 'waitlisted' ? `Waitlist${c.waitlistPosition ? ` · #${c.waitlistPosition}` : ''}` : c.status === 'offered' ? 'Spot offered' : 'Confirmed'}</span>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">Reference <span className="font-mono font-medium text-fg">{c.reference}</span></p>
      {problem && <div className="mt-2"><FormError message={problem} /></div>}
      {!cancelled && (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.status !== 'waitlisted' && <a href={googleUrl(site, c)} target="_blank" rel="noopener noreferrer" className="bk-btn ui-focus inline-flex min-h-11 items-center gap-1.5 border border-line px-3 text-sm font-medium text-fg hover:bg-subtle"><CalendarPlus className="h-4 w-4" aria-hidden />Google Calendar</a>}
          {c.status !== 'waitlisted' && <a href={`${base}/manage/${c.manageToken}/calendar`} className="bk-btn ui-focus inline-flex min-h-11 items-center gap-1.5 border border-line px-3 text-sm font-medium text-fg hover:bg-subtle"><Download className="h-4 w-4" aria-hidden />Calendar file (.ics)</a>}
          {c.can.cancel && !confirming && <Button variant="ghost" className="min-h-11 text-red-600" onClick={() => setConfirming(true)}>{c.status === 'waitlisted' ? 'Leave the waitlist' : 'Cancel booking'}</Button>}
        </div>
      )}
      {confirming && (
        <div className="mt-3 space-y-2 rounded-lg bg-subtle p-3 text-sm">
          <p className="font-medium text-fg-heading">{c.status === 'waitlisted' ? 'Leave the waitlist?' : 'Cancel this booking?'}</p>
          {c.cancelNote && <p className="text-amber-800 dark:text-amber-300">{c.cancelNote}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="danger" className="min-h-11" loading={busy} onClick={cancel}>{c.status === 'waitlisted' ? 'Yes, leave' : 'Yes, cancel'}</Button><Button className="min-h-11" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button></div>
        </div>
      )}
      {cancelled && c.late != null && <p className="mt-2 text-sm text-fg-muted">{c.late ? 'This was a late cancellation.' : 'Cancelled in time.'}{c.creditReturned ? ' Your credit has been returned.' : ''}{c.refunded ? ' Your payment is being refunded.' : ''}</p>}
    </div>
  )
}

function Confirmed({ base, site, fmt, confirmation, note, embed, onAgain, onChanged }: { base: string; site: Site; fmt: ReturnType<typeof useFormat>; confirmation: Confirmation; note?: string; embed: boolean; onAgain: () => void; onChanged: (c: Confirmation) => void }) {
  const c = confirmation
  const cancelled = ['cancelled', 'late_cancelled'].includes(c.status)
  return (
    <Panel>
      <div className="mb-4 text-center">
        <span className={cn('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full', cancelled ? 'bg-subtle text-fg-muted' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}><Check className="h-6 w-6" aria-hidden /></span>
        <h2 className="text-xl font-semibold text-fg-heading">{cancelled ? 'Booking cancelled' : c.status === 'waitlisted' ? 'You’re on the waitlist' : 'You’re booked'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{cancelled ? 'We have emailed you a confirmation.' : c.status === 'waitlisted' ? 'We will email you if a spot opens up.' : 'A confirmation is on its way to your email.'}</p>
        {note && <p className="mt-1 text-sm text-fg-muted">{note}</p>}
      </div>
      <BookingCard base={base} site={site} fmt={fmt} c={c} onChanged={onChanged} />
      {!cancelled && <div className="mt-3"><Policy site={site} hours={0} /></div>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
        <button type="button" onClick={onAgain} className="bk-plain ui-focus min-h-11 font-medium text-accent-text">Book something else</button>
        <a href={`/book/${site.slug}/manage/${c.manageToken}`} target={embed ? '_blank' : undefined} rel="noopener noreferrer" className="ui-focus inline-flex min-h-11 items-center rounded font-medium text-fg-muted underline">Link to this booking</a>
      </div>
    </Panel>
  )
}

function Mine({ base, site, fmt, embed, onBack }: { base: string; site: Site; fmt: ReturnType<typeof useFormat>; embed: boolean; onBack: () => void }) {
  const [rows, setRows] = useState<Confirmation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setError(null)
    api<Confirmation[]>(`${base}/me`).then((r) => { if (live) setRows(r) }).catch((e: ClientError) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [base, tick])
  void embed
  return (
    <Panel>
      <BackLink onClick={onBack}>Book</BackLink>
      <h2 className="mb-3 text-xl font-semibold text-fg-heading">Your bookings</h2>
      {error ? <div className="space-y-3 py-4 text-center"><p className="text-sm text-fg-muted">{error}</p><Button onClick={() => setTick((t) => t + 1)}>Try again</Button></div>
        : !rows ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div>
        : rows.length === 0 ? <p className="rounded-xl bg-subtle px-4 py-8 text-center text-sm text-fg-muted">Nothing coming up. When you book, it shows here.</p>
        : <div className="space-y-3">{rows.map((c) => <BookingCard key={`${c.kind}:${c.id}`} base={base} site={site} fmt={fmt} c={c} compact onChanged={(next) => setRows((all) => (all || []).map((x) => (x.id === next.id ? next : x)))} />)}</div>}
    </Panel>
  )
}

/** The page behind a "manage your booking" link: one booking, for whoever holds the link. */
export function ManageBooking({ slug, site, token }: { slug: string; site: Site; token: string }) {
  const base = `/api/public/booking/${slug}`
  const fmt = useFormat(site.timezone)
  useAppearance(site.theme.appearance)
  const [c, setC] = useState<Confirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api<Confirmation>(`${base}/manage/${token}`).then((r) => { if (live) setC(r) }).catch((e: ClientError) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [base, token])
  return (
    <div className="bk-root mx-auto w-full max-w-xl px-4 py-6 text-fg sm:py-10">
      <header className="mb-5 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {site.logoUrl && <img src={site.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-line bg-surface object-contain" />}
        <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight tracking-tight text-fg-heading">{site.name}</h1>
      </header>
      <Panel>
        <h2 className="mb-3 text-lg font-semibold text-fg-heading">Your booking</h2>
        {error ? <p className="py-6 text-center text-fg-muted">{error}</p> : !c ? <div aria-busy="true"><Skeleton className="h-32 rounded-xl" /></div> : <BookingCard base={base} site={site} fmt={fmt} c={c} onChanged={setC} />}
        {c && <Policy site={site} hours={0} />}
        <p className="mt-4 text-center text-sm"><a href={`/book/${slug}`} className="font-medium text-accent-text underline">Book something else</a></p>
      </Panel>
    </div>
  )
}
