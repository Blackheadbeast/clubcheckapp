// Timezone-aware date helpers. The server runs in UTC, but "today", class
// times and report ranges are defined by the gym's own timezone.

export const DEFAULT_TZ = 'America/New_York'
const DAY = 86_400_000

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday */
  weekday: number
  /** YYYY-MM-DD */
  date: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function zonedParts(instant: Date, tz: string): ZonedParts {
  const p: Record<string, string> = {}
  for (const part of formatter(tz).formatToParts(instant)) p[part.type] = part.value
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    second: +p.second,
    weekday: WEEKDAYS.indexOf(p.weekday),
    date: `${p.year}-${p.month}-${p.day}`,
  }
}

function offsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** Convert a wall-clock time in `tz` to the UTC instant it represents. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h || 0, min || 0)
  const first = offsetMs(new Date(guess), tz)
  let utc = guess - first
  // Re-check across a DST boundary
  const second = offsetMs(new Date(utc), tz)
  if (second !== first) utc = guess - second
  return new Date(utc)
}

export function startOfZonedDay(instant: Date, tz: string): Date {
  return zonedToUtc(zonedParts(instant, tz).date, '00:00', tz)
}

/** Add calendar days to a YYYY-MM-DD string. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY)
}

/** Add billing intervals to a date, clamping to month length (Jan 31 + 1 month = Feb 28/29). */
export function addInterval(from: Date, interval: string, count = 1): Date {
  const d = new Date(from)
  if (interval === 'week') return addDays(d, 7 * count)
  if (interval === 'year') return addMonths(d, 12 * count)
  if (interval === 'month') return addMonths(d, count)
  return d
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

export const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]['key']

export interface DateRange {
  preset: RangePreset
  /** Inclusive start, exclusive end, both UTC instants on gym-local day boundaries. */
  start: Date
  end: Date
  /** The immediately preceding period of equal length, for comparisons. */
  prevStart: Date
  prevEnd: Date
  days: number
  /** Gym-local YYYY-MM-DD for each day in the range. */
  dates: string[]
}

export function resolveRange(
  preset: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
  tz: string,
  now = new Date()
): DateRange {
  const today = zonedParts(now, tz).date
  let startDate = addDaysToDate(today, -29)
  let endDate = today // inclusive
  let key: RangePreset = '30d'
  const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

  switch (preset) {
    case 'today':
      key = 'today'
      startDate = today
      break
    case 'yesterday':
      key = 'yesterday'
      startDate = endDate = addDaysToDate(today, -1)
      break
    case '7d':
      key = '7d'
      startDate = addDaysToDate(today, -6)
      break
    case 'month':
      key = 'month'
      startDate = today.slice(0, 8) + '01'
      break
    case 'last_month': {
      key = 'last_month'
      const firstOfThis = today.slice(0, 8) + '01'
      endDate = addDaysToDate(firstOfThis, -1)
      startDate = endDate.slice(0, 8) + '01'
      break
    }
    case 'year':
      key = 'year'
      startDate = today.slice(0, 4) + '-01-01'
      break
    case 'custom':
      if (isDate(from) && isDate(to) && from <= to) {
        key = 'custom'
        startDate = from
        endDate = to
      }
      break
  }

  const dates: string[] = []
  for (let d = startDate; d <= endDate && dates.length < 800; d = addDaysToDate(d, 1)) dates.push(d)
  const days = dates.length
  const start = zonedToUtc(startDate, '00:00', tz)
  const end = zonedToUtc(addDaysToDate(endDate, 1), '00:00', tz)
  const prevStart = zonedToUtc(addDaysToDate(startDate, -days), '00:00', tz)
  return { preset: key, start, end, prevStart, prevEnd: start, days, dates }
}
