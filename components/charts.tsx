'use client'

// Chart primitives. One measure per chart, one axis, thin marks, a hover
// readout on every mark, and a table view behind every chart.

import { useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Table2 } from 'lucide-react'
import { formatMoney, formatMoneyCompact } from '@/lib/format'
import { cn } from './ui'

export type ValueFormat = 'money' | 'number' | 'percent'

export function formatValue(value: number | null | undefined, format: ValueFormat, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (format === 'money') return compact ? formatMoneyCompact(value) : formatMoney(value)
  if (format === 'percent') return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
  return compact && Math.abs(value) >= 10_000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : value.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/** "2026-03-14" -> "Mar 14"; "2026-03" -> "Mar 2026". Parsed as plain calendar dates, never shifted by timezone. */
export function bucketLabel(key: string, long = false): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d || 1))
  if (!d) return date.toLocaleDateString('en-US', { month: 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(long && { weekday: 'short' }), timeZone: 'UTC' })
}

function ChartFrame({ label, table, children, height }: { label: string; table: { head: [string, string]; rows: [string, string][] }; children: ReactNode; height: number }) {
  const [showTable, setShowTable] = useState(false)
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <button type="button" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable} className="ui-hit ui-focus inline-flex items-center gap-1 rounded text-xs text-fg-subtle hover:text-fg">
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {showTable ? (
        <div className="overflow-y-auto rounded-lg border border-line" style={{ maxHeight: height }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr><th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-fg-subtle">{table.head[0]}</th><th scope="col" className="px-3 py-1.5 text-right text-xs font-medium text-fg-subtle">{table.head[1]}</th></tr>
            </thead>
            <tbody>
              {table.rows.map(([a, b]) => (
                <tr key={a} className="border-t border-line/60"><td className="px-3 py-1.5 text-fg-muted">{a}</td><td className="tabular px-3 py-1.5 text-right text-fg">{b}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={label} style={{ height }}>{children}</div>
      )}
    </div>
  )
}

function Readout({ active, payload, label, format, name, labelFormat }: { active?: boolean; payload?: { value: number }[]; label?: string | number; format: ValueFormat; name: string; labelFormat: (l: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-pop">
      <p className="tabular text-sm font-semibold text-fg-heading">{formatValue(payload[0].value, format)}</p>
      <p className="text-xs text-fg-muted">{name} · {labelFormat(String(label))}</p>
    </div>
  )
}

const AXIS = { fontSize: 11, fill: 'rgb(var(--color-text-muted))' }

/** Change over time for a single measure. */
export function TrendChart({ data, format, name, height = 240 }: { data: { date: string; value: number }[]; format: ValueFormat; name: string; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (data.length === 0 || total === 0) return <ChartEmpty height={height} />
  return (
    <ChartFrame
      height={height}
      label={`${name} over time. ${data.length} points, total ${formatValue(total, format)}.`}
      table={{ head: ['Date', name], rows: data.map((d) => [bucketLabel(d.date, true), formatValue(d.value, format)]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickFormatter={(v) => bucketLabel(v)} tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} minTickGap={36} />
          <YAxis tickFormatter={(v) => formatValue(v, format, true)} tick={AXIS} tickLine={false} axisLine={false} width={format === 'money' ? 56 : 36} allowDecimals={false} />
          <Tooltip cursor={{ stroke: 'rgb(var(--color-text-muted))', strokeWidth: 1 }} content={<Readout format={format} name={name} labelFormat={(l) => bucketLabel(l, true)} />} />
          <Area type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} fill="url(#trend-fill)" isAnimationActive={false} dot={data.length <= 2 ? { r: 4, fill: 'var(--series-1)' } : false} activeDot={{ r: 4, stroke: 'rgb(var(--color-bg-card))', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/** Magnitude across a small ordered set (e.g. hour of day). */
export function ColumnChart({ data, format, name, height = 200 }: { data: { label: string; value: number }[]; format: ValueFormat; name: string; height?: number }) {
  if (data.every((d) => d.value === 0)) return <ChartEmpty height={height} />
  return (
    <ChartFrame height={height} label={`${name} by category.`} table={{ head: ['', name], rows: data.map((d) => [d.label, formatValue(d.value, format)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickFormatter={(v) => formatValue(v, format, true)} tick={AXIS} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgb(var(--color-bg-lighter))' }} content={<Readout format={format} name={name} labelFormat={(l) => l} />} />
          <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function ChartEmpty({ height }: { height: number }) {
  return <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-sm text-fg-subtle" style={{ height }}>No data in this period</div>
}

/** Ranked horizontal bars with the value written on every row. */
export function BarList({ rows, format, emptyLabel = 'No data in this period', max }: { rows: { label: string; value: number; hint?: string; href?: string }[]; format: ValueFormat; emptyLabel?: string; max?: number }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-fg-subtle">{emptyLabel}</p>
  const top = max ?? Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg">
              {row.href ? <a href={row.href} className="ui-focus rounded hover:underline">{row.label}</a> : row.label}
              {row.hint && <span className="ml-2 text-xs text-fg-subtle">{row.hint}</span>}
            </span>
            <span className="tabular shrink-0 font-medium text-fg-heading">{formatValue(row.value, format)}</span>
          </div>
          <div className="h-2 rounded-full bg-subtle">
            <div className={cn('h-2 rounded-full')} style={{ width: `${Math.max(1.5, Math.min(100, (row.value / top) * 100))}%`, background: 'var(--series-1)' }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
