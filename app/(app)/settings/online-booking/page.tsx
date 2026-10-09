'use client'

// Settings → Online booking: the gym's public booking page and the widget for its own website.
// Classes, appointment types, prices and rules are managed where they always were; this page only
// chooses which of them the public may see, how the page looks, and who may book.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Globe } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, FormError, Input, Page, PageHeader, Select, SkeletonRows, Stat, Textarea, cn, useToast } from '@/components/ui'

interface SiteFields {
  slug: string; enabled: boolean; displayName: string | null; tagline: string | null; primaryColor: string; buttonStyle: 'rounded' | 'pill' | 'square'; appearance: 'light' | 'dark' | 'auto'; showLogo: boolean
  locationIds: string[]; allClassTypes: boolean; classTypeIds: string[]; appointmentTypeIds: string[]; requireAccount: boolean; allowGuests: boolean; advanceDays: number | null
  cancellationPolicy: string | null; contactEmail: string | null; contactPhone: string | null; termsUrl: string | null
}
interface Data {
  site: SiteFields; origin: string
  business: { name: string; logoUrl: string | null; bookingWindowDays: number; cancelWindowHours: number }
  locations: { id: string; name: string }[]
  classTypes: { id: string; name: string; category: string }[]
  appointmentTypes: { id: string; name: string; durationMin: number; paymentMode: string; memberBookable: boolean }[]
}
interface Stats {
  days: number; visits: number; bookings: number; classBookings: number; appointmentBookings: number; cancellations: number; waitlistJoins: number; newPeople: number; conversionPercent: number | null
  upcoming: { kind: 'class' | 'appointment'; id: string; name: string; startsAt: string; status: string; member: { id: string; name: string }; with: string | null }[]
}

function CopyBox({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) } }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-fg-muted">{label}</p>
      <div className="flex items-stretch gap-2">
        <code data-testid={`copy-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`} className={cn('min-w-0 flex-1 select-all break-all rounded-lg border border-line bg-subtle px-3 py-2 text-xs text-fg-heading', mono && 'font-mono')}>{value}</code>
        <Button onClick={copy} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} aria-label={`Copy ${label.toLowerCase()}`}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  )
}

function Pick({ title, hint, items, chosen, onChange, empty }: { title: string; hint?: string; items: { id: string; label: string; note?: string; disabled?: boolean }[]; chosen: string[]; onChange: (ids: string[]) => void; empty: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg-heading">{title}</legend>
      {hint && <p className="mb-2 text-xs text-fg-muted">{hint}</p>}
      {items.length === 0 ? <p className="text-sm text-fg-muted">{empty}</p> : (
        <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
          {items.map((i) => <Checkbox key={i.id} className="py-1.5" checked={chosen.includes(i.id)} disabled={i.disabled} onChange={() => onChange(chosen.includes(i.id) ? chosen.filter((x) => x !== i.id) : [...chosen, i.id])} label={<span className="text-sm">{i.label}{i.note && <span className="block text-xs text-fg-muted">{i.note}</span>}</span>} />)}
        </div>
      )}
    </fieldset>
  )
}

export default function OnlineBookingSettingsPage() {
  const toast = useToast()
  const { can, dateTime } = useSession()
  const { data, error, loading, reload } = useApi<Data>('/api/settings/online-booking')
  const stats = useApi<Stats>(data?.site.enabled ? '/api/settings/online-booking/stats' : null)
  const [f, setF] = useState<SiteFields | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (data) setF(data.site) }, [data])
  const dirty = useMemo(() => !!data && !!f && JSON.stringify(f) !== JSON.stringify(data.site), [data, f])

  if (!can('settings.manage')) return <Page width="narrow"><PageHeader title="Online booking" /><Card><EmptyState icon={<Globe className="h-5 w-5" />} title="Not available for your role" description="Online booking is set up by the owner or an admin." /></Card></Page>
  if (loading || (!f && !error)) return <Page><PageHeader title="Online booking" /><Card padded={false}><SkeletonRows rows={8} /></Card></Page>
  if (error || !data || !f) return <Page><PageHeader title="Online booking" /><Card><ErrorState error={error || 'Could not load online booking'} onRetry={reload} /></Card></Page>

  const set = (patch: Partial<SiteFields>) => setF({ ...f, ...patch })
  const url = `${data.origin}/book/${data.site.slug}`
  const embed = `<script src="${data.origin}/embed/booking.js" data-gym="${data.site.slug}" async></script>`
  const frame = `<iframe src="${url}?embed=1" title="Book online" style="width:100%;max-width:760px;height:900px;border:0"></iframe>`

  const save = async (patch?: Partial<SiteFields>) => {
    const body = { ...f, ...patch }
    setBusy(true)
    setProblem(null)
    try {
      await api('/api/settings/online-booking', { method: 'PUT', body })
      toast.success(patch?.enabled === true ? 'Online booking is on' : patch?.enabled === false ? 'Online booking is off' : 'Online booking saved')
      reload()
      stats.reload()
    } catch (err) {
      setProblem((err as ClientError).message)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Online booking" description="A public page, and a widget for your own website, where people book your classes and appointments."
        actions={<><Button onClick={() => save({ enabled: !data.site.enabled })} loading={busy}>{data.site.enabled ? 'Turn off' : 'Turn on'}</Button><Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save()}>Save changes</Button></>} />
      <div className="space-y-5">
        {problem && <FormError message={problem} />}

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={data.site.enabled ? 'green' : 'neutral'}>{data.site.enabled ? 'On' : 'Off'}</Badge>
            <p className="min-w-0 flex-1 text-sm text-fg">{data.site.enabled ? 'Anyone with the link can see your public classes and appointments and book them.' : 'Your booking page shows “not available” until you turn it on. You can set everything up first.'}</p>
            {data.site.enabled && <a href={url} target="_blank" rel="noopener noreferrer" className="ui-focus inline-flex items-center gap-1.5 rounded text-sm font-medium text-accent-text hover:underline">Open booking page<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <CopyBox label="Booking link" value={url} />
            <CopyBox label="Embed code" value={embed} />
          </div>
          <details className="mt-3 text-sm text-fg-muted">
            <summary className="ui-focus cursor-pointer rounded font-medium text-fg">How to add it to your website</summary>
            <div className="mt-2 space-y-2">
              <p>Paste the embed code into your website where the booking widget should appear. It adjusts to the width of the page and to phones, and grows to fit its content. Nothing else needs installing.</p>
              <p>If your website builder does not allow scripts, use a plain frame instead:</p>
              <CopyBox label="Frame code" value={frame} />
              <p>Or simply link a “Book now” button to the booking link.</p>
            </div>
          </details>
        </Card>

        {data.site.enabled && (
          <Card padded={false}>
            <CardHeader title="How it is doing" description="The last 30 days." className="px-4 pt-4 sm:px-5" />
            {stats.loading ? <SkeletonRows rows={2} /> : stats.error || !stats.data ? <ErrorState error={stats.error || 'Could not load'} onRetry={stats.reload} /> : (
              <>
                <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-5">
                  <Stat label="Page visits" value={String(stats.data.visits)} />
                  <Stat label="Online bookings" value={String(stats.data.bookings)} hint={`${stats.data.classBookings} classes, ${stats.data.appointmentBookings} appointments`} />
                  <Stat label="Bookings per 100 visits" value={stats.data.conversionPercent == null ? '—' : String(stats.data.conversionPercent)} hint="A rough guide: visits are page loads" />
                  <Stat label="Cancellations" value={String(stats.data.cancellations)} />
                  <Stat label="Waitlist joins" value={String(stats.data.waitlistJoins)} hint={`${stats.data.newPeople} new ${stats.data.newPeople === 1 ? 'person' : 'people'} from the website`} />
                </div>
                <div className="border-t border-line">
                  <p className="px-4 pt-3 text-sm font-medium text-fg-heading sm:px-5">Coming up from online booking</p>
                  {stats.data.upcoming.length === 0 ? <p className="px-4 pb-4 pt-1 text-sm text-fg-muted sm:px-5">Nothing booked online is coming up yet.</p> : (
                    <ul className="divide-y divide-line/60" aria-label="Upcoming online bookings">
                      {stats.data.upcoming.map((u) => (
                        <li key={`${u.kind}:${u.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
                          <div className="min-w-0 flex-1 basis-56"><Link href={`/members/${u.member.id}`} className="ui-focus rounded text-sm font-medium text-fg-heading hover:underline">{u.member.name}</Link><p className="truncate text-xs text-fg-muted">{u.name}{u.with ? ` with ${u.with}` : ''} · {dateTime(u.startsAt)}</p></div>
                          <Badge tone={u.status === 'waitlisted' ? 'blue' : 'green'}>{u.status === 'waitlisted' ? 'Waitlist' : u.kind === 'class' ? 'Class' : 'Appointment'}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </Card>
        )}

        <Card>
          <CardHeader title="Address and appearance" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Booking address" required hint={`${data.origin}/book/${f.slug || '…'}`}><Input value={f.slug} maxLength={40} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></Field>
            <Field label="Name shown on the page" hint={`Leave empty to use ${data.business.name}.`}><Input value={f.displayName || ''} maxLength={80} placeholder={data.business.name} onChange={(e) => set({ displayName: e.target.value || null })} /></Field>
            <Field label="Tagline (optional)" className="sm:col-span-2"><Input value={f.tagline || ''} maxLength={160} placeholder="Strength and conditioning for everybody" onChange={(e) => set({ tagline: e.target.value || null })} /></Field>
            <Field label="Main colour" hint="Buttons and highlights. Text on it is kept readable automatically.">
              <div className="flex items-center gap-2"><input type="color" aria-label="Pick main colour" value={/^#[0-9a-f]{6}$/i.test(f.primaryColor) ? f.primaryColor : '#2563eb'} onChange={(e) => set({ primaryColor: e.target.value })} className="h-9 w-12 shrink-0 cursor-pointer rounded border border-line bg-surface p-0.5" /><Input aria-label="Main colour" value={f.primaryColor} maxLength={7} onChange={(e) => set({ primaryColor: e.target.value })} className="font-mono" /></div>
            </Field>
            <Field label="Button shape"><Select value={f.buttonStyle} onChange={(e) => set({ buttonStyle: e.target.value as SiteFields['buttonStyle'] })}><option value="rounded">Rounded</option><option value="pill">Pill</option><option value="square">Square</option></Select></Field>
            <Field label="Appearance"><Select value={f.appearance} onChange={(e) => set({ appearance: e.target.value as SiteFields['appearance'] })}><option value="light">Light</option><option value="dark">Dark</option><option value="auto">Match the visitor&apos;s device</option></Select></Field>
            <div className="self-end pb-1"><Checkbox checked={f.showLogo} onChange={() => set({ showLogo: !f.showLogo })} label={<span className="text-sm">Show our logo{!data.business.logoUrl && <span className="block text-xs text-fg-muted">No logo yet. Add one in Business settings.</span>}</span>} /></div>
          </div>
        </Card>

        <Card>
          <CardHeader title="What people can book" description="Only what you tick is shown. Capacity, coaches, prices and membership rules come from the class or appointment itself." />
          <div className="mt-4 space-y-5">
            <Pick title="Locations" hint="Tick none to show every location." items={data.locations.map((l) => ({ id: l.id, label: l.name }))} chosen={f.locationIds} onChange={(locationIds) => set({ locationIds })} empty="You have one location, so there is nothing to choose." />
            <div>
              <Checkbox checked={f.allClassTypes} onChange={() => set({ allClassTypes: !f.allClassTypes })} label={<span className="text-sm font-medium text-fg-heading">All classes, including new ones</span>} />
              {!f.allClassTypes && <div className="mt-2"><Pick title="Classes" items={data.classTypes.map((c) => ({ id: c.id, label: c.name, note: c.category.replace(/_/g, ' ') }))} chosen={f.classTypeIds} onChange={(classTypeIds) => set({ classTypeIds })} empty={<>No class types yet. <Link href="/schedule/classes" className="text-accent-text underline">Add one</Link>.</>} /></div>}
            </div>
            <Pick title="Appointments" hint="An appointment type must also allow members to book it themselves." items={data.appointmentTypes.map((a) => ({ id: a.id, label: a.name, note: `${a.durationMin} min · ${a.paymentMode === 'paid' ? 'paid' : a.paymentMode === 'credit' ? 'uses sessions' : 'included'}${a.memberBookable ? '' : ' · staff-booked only, will not show'}` }))} chosen={f.appointmentTypeIds} onChange={(appointmentTypeIds) => set({ appointmentTypeIds })} empty={<>No appointment types yet. <Link href="/appointments/types" className="text-accent-text underline">Add one</Link>.</>} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Who can book" />
          <div className="mt-4 space-y-3">
            <Checkbox checked={f.requireAccount} onChange={() => set({ requireAccount: !f.requireAccount })} label={<span className="text-sm">Everyone must sign in or create an account<span className="block text-xs text-fg-muted">New people are emailed a link to set a password before they can book.</span></span>} />
            <Checkbox checked={f.allowGuests && !f.requireAccount} disabled={f.requireAccount} onChange={() => set({ allowGuests: !f.allowGuests })} label={<span className="text-sm">New people can book as guests<span className="block text-xs text-fg-muted">Just a name, email and phone. They are added to your members as “inactive” with the source “online_booking”. Anything that needs a membership or payment still needs it.</span></span>} />
            <Field label="How far ahead people can book online" hint={`Your booking window for members is ${data.business.bookingWindowDays} days. Online booking can be shorter, never longer.`} className="max-w-xs">
              <Select value={f.advanceDays == null ? '' : String(f.advanceDays)} onChange={(e) => set({ advanceDays: e.target.value ? Number(e.target.value) : null })}><option value="">Same as members ({data.business.bookingWindowDays} days)</option>{[1, 2, 3, 7, 14, 21, 30, 60].filter((n) => n < data.business.bookingWindowDays).map((n) => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>)}</Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Policy and contact" description="Shown on the booking page and in confirmation emails." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Cancellation policy" className="sm:col-span-2" hint={`What is enforced is your cancellation window (${data.business.cancelWindowHours} hours for classes) and each appointment type's own. This is the wording people see.`}><Textarea rows={2} value={f.cancellationPolicy || ''} maxLength={1000} placeholder={`Free cancellation up to ${data.business.cancelWindowHours} hours before the start.`} onChange={(e) => set({ cancellationPolicy: e.target.value || null })} /></Field>
            <Field label="Contact email"><Input type="email" value={f.contactEmail || ''} maxLength={200} onChange={(e) => set({ contactEmail: e.target.value || null })} /></Field>
            <Field label="Contact phone"><Input type="tel" value={f.contactPhone || ''} maxLength={40} onChange={(e) => set({ contactPhone: e.target.value || null })} /></Field>
            <Field label="Terms or waiver link (optional)" className="sm:col-span-2"><Input type="url" value={f.termsUrl || ''} maxLength={500} placeholder="https://yourgym.com/terms" onChange={(e) => set({ termsUrl: e.target.value || null })} /></Field>
          </div>
        </Card>

        <div className="flex justify-end"><Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save()}>Save changes</Button></div>
      </div>
    </Page>
  )
}
