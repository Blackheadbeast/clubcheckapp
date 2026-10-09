'use client'

// ClubCheck design system: the small set of primitives every screen is built from.

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Inbox, Loader2, Lock, Search, X } from 'lucide-react'
import { RANGE_PRESETS, type RangePreset } from '@/lib/dates'
import { initials, titleCase } from '@/lib/format'

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-[1.04] active:brightness-95 shadow-card font-semibold',
  secondary: 'bg-surface text-fg border border-line hover:bg-subtle hover:border-fg-subtle/40 shadow-card',
  ghost: 'text-fg-muted hover:text-fg hover:bg-subtle',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-card',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'ui-focus inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : size === 'lg' ? 'h-11 px-5 text-sm' : 'h-9 px-3.5 text-sm',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('ui-focus inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-subtle hover:text-fg disabled:opacity-40', className)}
      {...props}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('ui-input h-9', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...props },
  ref
) {
  return <textarea ref={ref} rows={rows} className={cn('ui-input', className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn('ui-input h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
})

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  const box = <input type="checkbox" className={cn('h-4 w-4 rounded border-line accent-amber-500', className)} {...props} />
  if (!label) return box
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
      {box}
      <span>{label}</span>
    </label>
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-fg-muted">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-500">{error}</span> : hint ? <span className="mt-1 block text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  className,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="ui-input h-9 pl-9"
      />
    </div>
  )
}

/** Money input in dollars; reports cents. */
export function MoneyInput({ cents, onChange, ...props }: { cents: number; onChange: (cents: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const [text, setText] = useState((cents / 100).toFixed(2))
  const last = useRef(cents)
  useEffect(() => {
    if (cents !== last.current) {
      last.current = cents
      setText((cents / 100).toFixed(2))
    }
  }, [cents])
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">$</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseFloat(e.target.value)
          const next = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
          last.current = next
          onChange(next)
        }}
        onBlur={() => setText((last.current / 100).toFixed(2))}
        className="ui-input tabular h-9 pl-6"
        {...props}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'violet'

const TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-fg-muted border-transparent',
  green: 'bg-emerald-500/10 text-emerald-700 border-transparent dark:text-emerald-400',
  red: 'bg-red-500/10 text-red-700 border-transparent dark:text-red-400',
  amber: 'bg-amber-500/15 text-amber-800 border-transparent dark:text-amber-400',
  blue: 'bg-sky-500/10 text-sky-700 border-transparent dark:text-sky-400',
  violet: 'bg-violet-500/10 text-violet-700 border-transparent dark:text-violet-400',
}

const DOTS: Record<Tone, string> = { neutral: 'bg-fg-subtle', green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-sky-500', violet: 'bg-violet-500' }

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; /** A coloured dot before the label: for a status, so it reads at a glance. */ dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOTS[tone])} aria-hidden />}
      {children}
    </span>
  )
}

const STATUS_TONES: Record<string, Tone> = {
  active: 'green', paid: 'green', succeeded: 'green', attended: 'green', booked: 'green', sent: 'green', delivered: 'green',
  completed: 'green', converted: 'green', scheduled: 'green', opened: 'green', clicked: 'green',
  trial: 'blue', open: 'blue', offered: 'blue', new: 'blue', pending: 'blue', queued: 'blue', sending: 'blue', contacted: 'blue',
  trial_scheduled: 'violet', trial_completed: 'violet', follow_up: 'amber', waitlisted: 'amber', draft: 'neutral',
  past_due: 'red', overdue: 'red', failed: 'red', no_show: 'red', lost: 'red', uncollectible: 'red',
  frozen: 'amber', paused: 'amber', late_cancelled: 'amber', partially_refunded: 'amber', skipped: 'neutral',
  in_progress: 'amber', missed: 'red', not_started: 'neutral',
  cancelled: 'neutral', inactive: 'neutral', expired: 'neutral', void: 'neutral', refunded: 'neutral', archived: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  past_due: 'Past due', no_show: 'No-show', late_cancelled: 'Late cancel', trial_scheduled: 'Trial scheduled',
  trial_completed: 'Trial completed', follow_up: 'Follow-up', partially_refunded: 'Part refunded', overdue: 'Past due', paused: 'Frozen',
}

/** One consistent look for every status in the product. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge dot tone={STATUS_TONES[status] || 'neutral'} className={className}>
      {STATUS_LABELS[status] || titleCase(status)}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  // min-w-0: inside a grid or flex row a card may shrink to its column, so long names truncate instead of widening the page.
  return <div className={cn('min-w-0 rounded-2xl border border-line bg-surface shadow-card', padded && 'p-4 sm:p-6', className)}>{children}</div>
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="ui-section-title">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back && <div className="mb-1.5">{back}</div>}
        <h1 className="ui-page-title truncate">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-[0.9375rem] leading-6 text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Page({ children, width = 'wide' }: { children: ReactNode; width?: 'wide' | 'narrow' }) {
  return <div className={cn('ui-rise mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8', width === 'wide' ? 'max-w-[1440px]' : 'max-w-3xl')}>{children}</div>
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { key: T; label: string; count?: number | null }[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          type="button"
          aria-selected={tab.key === value}
          onClick={() => onChange(tab.key)}
          className={cn(
            'ui-focus -mb-px flex min-h-10 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition',
            tab.key === value ? 'border-accent text-fg-heading' : 'border-transparent text-fg-muted hover:border-line hover:text-fg'
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && (
            <span className={cn('tabular rounded-full px-1.5 text-xs', tab.key === value ? 'bg-accent/15 text-accent-text' : 'bg-subtle text-fg-muted')}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-max border-collapse text-left text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' }) {
  return (
    <th scope="col" className={cn('whitespace-nowrap border-b border-line bg-subtle/50 px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-fg-muted first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6', align === 'right' && 'text-right', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' }) {
  return (
    <td className={cn('border-b border-line/70 px-3 py-3 align-middle text-fg first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6', align === 'right' && 'tabular text-right', className)}>
      {children}
    </td>
  )
}

export function Pagination({ page, totalPages, total, onPage, noun = 'results' }: { page: number; totalPages: number; total: number; onPage: (page: number) => void; noun?: string }) {
  if (total === 0) return null
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-fg-muted sm:px-5">
      <span className="tabular">
        {total.toLocaleString()} {noun}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="tabular px-1">
            Page {page} of {totalPages}
          </span>
          <IconButton label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// States: loading, empty, error
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-fg-subtle', className)} aria-label="Loading" />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('ui-skeleton rounded-md', className)} />
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent-text ring-1 ring-inset ring-accent/15">{icon || <Inbox className="h-5 w-5" />}</div>
      <p className="text-base font-semibold tracking-tight text-fg-heading">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm leading-6 text-fg-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: { message: string; status?: number } | string; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : error.message
  const forbidden = typeof error !== 'string' && error.status === 403
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
      <div className={cn('mb-4 flex h-12 w-12 items-center justify-center rounded-2xl', forbidden ? 'bg-subtle text-fg-subtle' : 'bg-red-500/10 text-red-500')}>
        {forbidden ? <Lock className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </div>
      <p className="text-base font-semibold tracking-tight text-fg-heading">{forbidden ? "You don't have access to this" : "Couldn't load this"}</p>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-fg-muted">{forbidden ? 'Ask the account owner to change your role if you need it.' : message}</p>
      {onRetry && !forbidden && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** Inline error for forms. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const AVATAR_TINTS = [
  'bg-sky-500/15 text-sky-700 dark:text-sky-300', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-amber-500/20 text-amber-800 dark:text-amber-300', 'bg-rose-500/15 text-rose-700 dark:text-rose-300', 'bg-teal-500/15 text-teal-700 dark:text-teal-300', 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
]
/** The same name always gets the same tint. */
function tintOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % AVATAR_TINTS.length
}

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const dims = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-xl' }[size]
  const [broken, setBroken] = useState(false)
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" onError={() => setBroken(true)} className={cn('shrink-0 rounded-full border border-line object-cover', dims)} />
  }
  return (
    <span aria-hidden className={cn('flex shrink-0 select-none items-center justify-center rounded-full font-semibold', AVATAR_TINTS[tintOf(name)], dims)}>
      {!initials(name) ? '?' : /^[\p{L}\p{N}]/u.test(initials(name)) ? initials(name) : '#'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

const STAT_TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-fg-muted', green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
}

/** One headline number: what it is, the figure, how it is moving, and a line of context. */
export function Stat({
  label,
  value,
  delta,
  goodWhen = 'up',
  hint,
  href,
  icon,
  tone = 'neutral',
  alert,
}: {
  label: string
  value: ReactNode
  /** Percent change against the previous period; null hides it. */
  delta?: number | null
  /** Whether an increase is good news (revenue) or bad (churn). */
  goodWhen?: 'up' | 'down'
  hint?: ReactNode
  href?: string
  /** A small symbol for the figure, tinted by `tone`. */
  icon?: ReactNode
  tone?: Tone
  /** Something here needs looking at: the card carries a red edge. */
  alert?: boolean
}) {
  const showDelta = delta !== undefined && delta !== null && Number.isFinite(delta)
  const good = showDelta && delta !== 0 ? (delta! > 0) === (goodWhen === 'up') : null
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-fg-muted">{label}</p>
        {icon && <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])} aria-hidden>{icon}</span>}
      </div>
      <p className={cn('ui-kpi', icon ? 'mt-1' : 'mt-2')}>{value}</p>
      <p className="mt-1.5 flex min-h-[1.25rem] flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-muted">
        {showDelta && (
          <span className={cn('tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold', good === null ? 'bg-subtle text-fg-muted' : good ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>
            {delta! > 0 ? '↑' : delta! < 0 ? '↓' : ''} {Math.abs(delta!).toFixed(delta! % 1 === 0 || Math.abs(delta!) >= 100 ? 0 : 1)}%
          </span>
        )}
        {hint && <span className="min-w-0 truncate">{hint}</span>}
      </p>
    </>
  )
  const cls = cn('relative block min-w-0 overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5', alert && 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-red-500')
  return href ? (
    <a href={href} className={cn(cls, 'ui-focus transition duration-150 hover:-translate-y-px hover:border-fg-subtle/40 hover:shadow-raised')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'Tab' && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    // Focus the first field, or the panel itself.
    const target = panel.current?.querySelector<HTMLElement>('[autofocus],input:not([type=hidden]),select,textarea') || panel.current
    target?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="ui-fade absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'ui-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-pop outline-none sm:rounded-2xl',
          size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-fg-heading">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  danger,
  loading,
  error,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children?: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  error?: string | null
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-fg-muted">
        {children}
        <FormError message={error} />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number
  message: string
  tone: 'success' | 'error'
}

const ToastContext = createContext<{ success: (message: string) => void; error: (message: string) => void } | null>(null)

export function ToastProvider({ children, aboveBottomNav }: { children: ReactNode; /** Lift toasts clear of a fixed bottom tab bar: always, or only where the bar shows ("mobile"). */ aboveBottomNav?: boolean | 'mobile' }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const push = useCallback((message: string, tone: Toast['tone']) => {
    const id = nextId.current++
    setToasts((list) => [...list.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])
  const value = useRef({ success: (m: string) => push(m, 'success'), error: (m: string) => push(m, 'error') }).current
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={cn('pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end', aboveBottomNav === 'mobile' ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))] pb-2 lg:bottom-0 lg:pb-4' : aboveBottomNav ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))] pb-2' : 'bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))]')} aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className="ui-rise pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-fg shadow-pop"
          >
            {toast.tone === 'success' ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

export interface RangeValue {
  preset: RangePreset
  from: string
  to: string
}

export function rangeQuery(range: RangeValue) {
  return { range: range.preset, ...(range.preset === 'custom' && { from: range.from, to: range.to }) }
}

export function DateRangePicker({ value, onChange }: { value: RangeValue; onChange: (value: RangeValue) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Date range"
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as RangePreset
          onChange({ preset, from: value.from || today, to: value.to || today })
        }}
        className="w-auto"
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </Select>
      {value.preset === 'custom' && (
        <>
          <Input type="date" aria-label="From" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} className="w-auto" />
          <span className="text-xs text-fg-subtle">to</span>
          <Input type="date" aria-label="To" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-auto" />
        </>
      )}
    </div>
  )
}
