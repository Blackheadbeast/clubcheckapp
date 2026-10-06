'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import {
  BarChart3, Bell, Building2, CalendarDays, ChevronDown, CreditCard, LayoutDashboard, LogOut, MapPin, Megaphone, Menu,
  ScanLine, Search, Settings, ShoppingBag, Target, UserCog, Users, X, Moon, Sun,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'
import { api, useApi, useDebounced } from '@/lib/client'
import { timeAgo } from '@/lib/format'
import { SessionProvider, useSession } from './Session'
import { Avatar, Button, ErrorState, Spinner, ToastProvider, cn } from './ui'
import { useTheme } from './ThemeProvider'
import DemoBanner from './DemoBanner'
import BillingStatusBanner from './BillingStatusBanner'

interface NavItem {
  href: string
  label: string
  /** Any one of these permissions shows the link. Omitted = everyone. */
  needs?: Permission[]
  ownerOnly?: boolean
}

interface NavGroup {
  label: string
  icon: typeof Users
  href?: string
  needs?: Permission[]
  ownerOnly?: boolean
  items?: NavItem[]
}

const NAV: NavGroup[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Check-in', icon: ScanLine, href: '/checkin', needs: ['attendance.manage'] },
  {
    label: 'Members', icon: Users,
    items: [
      { href: '/members', label: 'All members', needs: ['members.view'] },
      { href: '/members?status=trial', label: 'Trials', needs: ['members.view'] },
      { href: '/memberships', label: 'Memberships', needs: ['memberships.manage', 'settings.manage'] },
      { href: '/attendance', label: 'Attendance', needs: ['members.view'] },
    ],
  },
  {
    label: 'Schedule', icon: CalendarDays,
    items: [
      { href: '/schedule', label: 'Calendar', needs: ['classes.view'] },
      { href: '/schedule/classes', label: 'Classes', needs: ['classes.manage'] },
      { href: '/schedule/bookings', label: 'Bookings', needs: ['classes.view'] },
      { href: '/schedule/bookings?status=waitlisted', label: 'Waitlists', needs: ['classes.view'] },
    ],
  },
  {
    label: 'Sales', icon: Target,
    items: [
      { href: '/leads', label: 'Pipeline', needs: ['leads.view'] },
      { href: '/reports/sales', label: 'Sales', needs: ['reports.view'] },
      { href: '/billing/coupons', label: 'Offers', needs: ['billing.manage'] },
    ],
  },
  {
    label: 'Billing', icon: CreditCard,
    items: [
      { href: '/billing', label: 'Transactions', needs: ['billing.view'] },
      { href: '/billing/invoices', label: 'Invoices', needs: ['billing.view'] },
      { href: '/billing/memberships', label: 'Membership billing', needs: ['billing.view'] },
      { href: '/billing/failed', label: 'Failed payments', needs: ['billing.view'] },
    ],
  },
  {
    label: 'POS', icon: ShoppingBag,
    items: [
      { href: '/pos', label: 'Checkout', needs: ['pos.sell'] },
      { href: '/pos/products', label: 'Products & inventory', needs: ['pos.manage'] },
      { href: '/pos/orders', label: 'Orders', needs: ['pos.sell', 'pos.manage'] },
    ],
  },
  {
    label: 'Communication', icon: Megaphone,
    items: [
      { href: '/communication', label: 'Messages', needs: ['communication.send'] },
      { href: '/communication/campaigns', label: 'Campaigns', needs: ['communication.send'] },
      { href: '/communication/automations', label: 'Automations', needs: ['automations.manage'] },
      { href: '/communication/templates', label: 'Templates', needs: ['communication.send'] },
    ],
  },
  {
    label: 'Reports', icon: BarChart3,
    items: [
      { href: '/reports/financial', label: 'Financial', needs: ['reports.financial'] },
      { href: '/reports/members', label: 'Members', needs: ['reports.view'] },
      { href: '/reports/attendance', label: 'Attendance', needs: ['reports.view'] },
      { href: '/reports/sales', label: 'Sales', needs: ['reports.view'] },
    ],
  },
  {
    label: 'Staff', icon: UserCog,
    items: [
      { href: '/staff', label: 'Employees', needs: ['staff.manage'] },
      { href: '/staff?coaches=1', label: 'Coaches', needs: ['staff.manage'] },
      { href: '/staff/permissions', label: 'Permissions', needs: ['staff.manage'] },
    ],
  },
  { label: 'Locations', icon: MapPin, href: '/locations', needs: ['locations.manage'] },
  {
    label: 'Settings', icon: Settings,
    items: [
      { href: '/settings', label: 'Business settings', needs: ['settings.manage'] },
      { href: '/settings/rules', label: 'Booking & billing rules', needs: ['settings.manage'] },
      { href: '/settings/subscription', label: 'ClubCheck plan', ownerOnly: true },
      { href: '/audit-logs', label: 'Audit log', needs: ['audit.view'] },
    ],
  },
]

function useVisibleNav() {
  const { can, user } = useSession()
  return useMemo(() => {
    const allowed = (item: { needs?: Permission[]; ownerOnly?: boolean }) =>
      (!item.ownerOnly || user.type === 'owner') && (!item.needs || item.needs.some(can))
    return NAV.map((group) => (group.items ? { ...group, items: group.items.filter(allowed) } : group)).filter((group) =>
      group.items ? group.items.length > 0 : allowed(group)
    )
  }, [can, user.type])
}

function isCurrent(pathname: string, search: string, href: string) {
  const [path, query] = href.split('?')
  if (query) return pathname === path && search.includes(query)
  if (path === '/billing' || path === '/schedule' || path === '/pos' || path === '/communication' || path === '/members' || path === '/staff' || path === '/settings') {
    return pathname === path || (path === '/members' && /^\/members\/[^/]+$/.test(pathname))
  }
  return pathname === path || pathname.startsWith(path + '/')
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const [search, setSearch] = useState('')
  useEffect(() => setSearch(window.location.search), [pathname])
  const groups = useVisibleNav()
  const { gym } = useSession()
  const activeGroup = groups.find((g) => g.items?.some((i) => isCurrent(pathname, search, i.href)))?.label
  const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (activeGroup) setOpen((o) => ({ ...o, [activeGroup]: true }))
  }, [activeGroup])

  return (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" onClick={onNavigate} className="ui-focus flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        {gym.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gym.logoUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
        ) : (
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md" />
        )}
        <span className="truncate text-sm font-semibold text-fg-heading">{gym.name}</span>
      </Link>
      <nav aria-label="Main" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {groups.map((group) => {
          const Icon = group.icon
          if (!group.items) {
            const current = isCurrent(pathname, search, group.href!)
            return (
              <Link
                key={group.label}
                href={group.href!}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                className={cn('ui-focus flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition', current ? 'bg-subtle text-fg-heading' : 'text-fg-muted hover:bg-subtle hover:text-fg')}
              >
                <Icon className={cn('h-4 w-4', current && 'text-accent-text')} aria-hidden />
                {group.label}
              </Link>
            )
          }
          const expanded = !!open[group.label]
          return (
            <div key={group.label}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [group.label]: !expanded }))}
                className={cn('ui-focus flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition hover:bg-subtle', activeGroup === group.label ? 'text-fg-heading' : 'text-fg-muted hover:text-fg')}
              >
                <Icon className={cn('h-4 w-4', activeGroup === group.label && 'text-accent-text')} aria-hidden />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-fg-subtle transition-transform', expanded && 'rotate-180')} aria-hidden />
              </button>
              {expanded && (
                <div className="mb-1 ml-[18px] mt-0.5 space-y-0.5 border-l border-line pl-2.5">
                  {group.items.map((item) => {
                    const current = isCurrent(pathname, search, item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={current ? 'page' : undefined}
                        className={cn('ui-focus block rounded-md px-2.5 py-1.5 text-sm transition', current ? 'bg-subtle font-medium text-fg-heading' : 'text-fg-muted hover:bg-subtle hover:text-fg')}
                      >
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

interface Hit {
  type: string
  id: string
  title: string
  subtitle: string
  href: string
}

function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const debounced = useDebounced(query.trim(), 200)
  const { data, loading } = useApi<Hit[]>(open && debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null)
  const hits = debounced.length >= 2 ? data || [] : []
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0)
    else setQuery('')
  }, [open])
  useEffect(() => setActive(0), [debounced])

  const go = (hit: Hit) => {
    setOpen(false)
    router.push(hit.href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ui-focus flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-3 text-sm text-fg-subtle transition hover:border-fg-subtle/40 sm:max-w-sm"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">Search members, leads, invoices…</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] font-medium text-fg-subtle md:block">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[10vh]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Search" className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="h-4 w-4 text-fg-subtle" aria-hidden />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false)
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                  if (e.key === 'Enter' && hits[active]) go(hits[active])
                }}
                placeholder="Search members, leads, classes, invoices, products"
                aria-label="Search"
                className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
              {loading && <Spinner className="h-4 w-4" />}
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {debounced.length < 2 ? (
                <p className="px-3 py-6 text-center text-sm text-fg-subtle">Type at least two characters.</p>
              ) : hits.length === 0 && !loading ? (
                <p className="px-3 py-6 text-center text-sm text-fg-subtle">Nothing matches “{debounced}”.</p>
              ) : (
                hits.map((hit, i) => (
                  <button
                    key={`${hit.type}-${hit.id}`}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-subtle')}
                  >
                    <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{hit.type}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg-heading">{hit.title}</span>
                      <span className="block truncate text-xs capitalize text-fg-muted">{hit.subtitle}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface Notice {
  id: string
  title: string
  body: string | null
  href: string | null
  readAt: string | null
  createdAt: string
}

function Notifications() {
  const session = useSession()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(session.unreadNotifications)
  const { data, loading, reload } = useApi<Notice[]>(open ? '/api/notifications' : null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setUnread(session.unreadNotifications), [session.unreadNotifications])
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markAll = async () => {
    await api('/api/notifications', { body: {} }).catch(() => {})
    setUnread(0)
    reload()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ui-focus relative flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-subtle hover:text-fg"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" />}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-fg-heading">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="ui-focus rounded text-xs font-medium text-accent-text hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && !data ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : !data || data.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-fg-subtle">You're all caught up.</p>
            ) : (
              data.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={async () => {
                    if (!n.readAt) {
                      api('/api/notifications', { body: { id: n.id } }).catch(() => {})
                      setUnread((u) => Math.max(0, u - 1))
                    }
                    setOpen(false)
                    if (n.href) router.push(n.href)
                  }}
                  className="flex w-full gap-2.5 border-b border-line/60 px-4 py-3 text-left last:border-0 hover:bg-subtle"
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg-heading">{n.title}</span>
                    {n.body && <span className="block text-xs text-fg-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-fg-subtle">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, isDemo } = useSession()
  const { effectiveTheme: resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    window.location.href = '/login'
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="ui-focus flex items-center gap-2 rounded-lg p-1 transition hover:bg-subtle">
        <Avatar name={user.name} size="sm" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-fg-heading">{user.name}</p>
            <p className="truncate text-xs text-fg-muted">{user.roleLabel}{user.email ? ` · ${user.email}` : ''}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <button type="button" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className="ui-focus flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg hover:bg-subtle">
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4 text-fg-muted" /> : <Moon className="h-4 w-4 text-fg-muted" />}
            {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" onClick={logout} className="ui-focus flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg hover:bg-subtle">
            <LogOut className="h-4 w-4 text-fg-muted" />
            {isDemo ? 'Exit demo' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}

function LocationSwitcher() {
  const { locations, locationId, setLocationId } = useSession()
  if (locations.length < 2) return null
  return (
    <label className="relative hidden items-center sm:flex">
      <Building2 className="pointer-events-none absolute left-2.5 h-4 w-4 text-fg-subtle" aria-hidden />
      <select
        aria-label="Location"
        value={locationId || ''}
        onChange={(e) => setLocationId(e.target.value || null)}
        className="ui-focus h-9 max-w-[11rem] appearance-none truncate rounded-lg border border-line bg-surface pl-8 pr-7 text-sm text-fg"
      >
        <option value="">All locations</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-fg-subtle" aria-hidden />
    </label>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { isDemo, can, locations, locationId, setLocationId } = useSession()
  const [drawer, setDrawer] = useState(false)
  useEffect(() => setDrawer(false), [pathname])
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawer])

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-pop">
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="ui-focus absolute right-2 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle">
              <X className="h-4 w-4" />
            </button>
            <div className="min-h-0 flex-1"><Sidebar onNavigate={() => setDrawer(false)} /></div>
            {locations.length > 1 && (
              <label className="block border-t border-line p-3 text-xs font-medium text-fg-muted sm:hidden">
                Location
                <select value={locationId || ''} onChange={(e) => setLocationId(e.target.value || null)} className="ui-input mt-1 h-9">
                  <option value="">All locations</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        {isDemo && <DemoBanner />}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-5">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="ui-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <LocationSwitcher />
            {can('attendance.manage') && pathname !== '/checkin' && (
              <Link href="/checkin" className="hidden sm:block">
                <Button variant="primary" size="md" icon={<ScanLine className="h-4 w-4" />}>Check in</Button>
              </Link>
            )}
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <BillingStatusBanner />
        <main>{children}</main>
      </div>
    </div>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider
        fallback={<div className="flex min-h-dvh items-center justify-center bg-canvas"><Spinner className="h-6 w-6" /></div>}
        errorFallback={(message, retry) => (
          <div className="flex min-h-dvh items-center justify-center bg-canvas"><ErrorState error={message} onRetry={retry} /></div>
        )}
      >
        <Shell>{children}</Shell>
      </SessionProvider>
    </ToastProvider>
  )
}
