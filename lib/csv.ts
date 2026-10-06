import { NextResponse } from 'next/server'

/** Quote a CSV cell, neutralising spreadsheet formula injection (cells starting with = + - @). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n')
}

export function csvResponse(filename: string, headers: string[], rows: unknown[][]) {
  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
