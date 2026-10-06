// Formatting helpers shared by server and client code.

export function formatMoney(cents: number | null | undefined, currency = 'usd'): string {
  const value = (cents || 0) / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Compact money for KPI tiles: $12.4k */
export function formatMoneyCompact(cents: number | null | undefined, currency = 'usd'): string {
  const value = (cents || 0) / 100
  if (Math.abs(value) < 10_000) return formatMoney(cents, currency)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function dollarsToCents(input: string | number): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function centsToDollars(cents: number | null | undefined): string {
  return ((cents || 0) / 100).toFixed(2)
}

export function formatDate(value: string | Date | null | undefined, tz?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz })
}

export function formatDateShort(value: string | Date | null | undefined, tz?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })
}

export function formatTime(value: string | Date | null | undefined, tz?: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
}

export function formatDateTime(value: string | Date | null | undefined, tz?: string): string {
  if (!value) return '—'
  return `${formatDateShort(value, tz)}, ${formatTime(value, tz)}`
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return 'Never'
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 0) return formatDateShort(value)
  if (seconds < 60) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(value)
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function titleCase(value: string): string {
  return value.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Member lifecycle statuses. "overdue" and "paused" are legacy values still present in older rows. */
export const MEMBER_STATUSES = ['active', 'trial', 'past_due', 'frozen', 'cancelled', 'inactive'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export function normalizeMemberStatus(status: string): MemberStatus {
  if (status === 'overdue') return 'past_due'
  if (status === 'paused') return 'frozen'
  return (MEMBER_STATUSES as readonly string[]).includes(status) ? (status as MemberStatus) : 'inactive'
}

/** Stored values that a status filter should match, including legacy aliases. */
export function memberStatusValues(status: string): string[] {
  if (status === 'past_due') return ['past_due', 'overdue']
  if (status === 'frozen') return ['frozen', 'paused']
  return [status]
}

export const LEAD_STAGES = [
  { key: 'new', label: 'New Lead' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'trial_scheduled', label: 'Trial Scheduled' },
  { key: 'trial_completed', label: 'Trial Completed' },
  { key: 'follow_up', label: 'Follow-Up' },
  { key: 'converted', label: 'Converted' },
  { key: 'lost', label: 'Lost' },
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]['key']

/** "toured" is the legacy name for a completed trial visit. */
export function normalizeLeadStage(stage: string): LeadStage {
  if (stage === 'toured') return 'trial_completed'
  return LEAD_STAGES.some((s) => s.key === stage) ? (stage as LeadStage) : 'new'
}
