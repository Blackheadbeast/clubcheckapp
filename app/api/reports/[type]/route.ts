import { ApiError, assertOwned, handler, notFound } from '@/lib/api'
import { resolveRange } from '@/lib/dates'
import { csvResponse } from '@/lib/csv'
import { getGymSettings } from '@/lib/services/core'
import { attendanceReport, financialReport, membersReport, salesReport } from '@/lib/services/reports'

export const dynamic = 'force-dynamic'

const REPORTS = { financial: financialReport, members: membersReport, attendance: attendanceReport, sales: salesReport }

// GET /api/reports/:type?range=&from=&to=&locationId=&format=csv&section=
export const GET = handler({ permission: ['reports.view', 'reports.financial'] }, async ({ ownerId, params, query, can }) => {
  const type = params.type as keyof typeof REPORTS
  if (!REPORTS[type]) throw notFound('Report')
  if (type === 'financial' && !can('reports.financial')) throw new ApiError(403, 'You do not have permission to view financial reports.', 'forbidden')
  if (type !== 'financial' && !can('reports.view')) throw new ApiError(403, 'You do not have permission to view this report.', 'forbidden')
  const locationId = query.get('locationId')
  await assertOwned(ownerId, 'location', locationId, 'Location')
  const settings = await getGymSettings(ownerId)
  const range = resolveRange(query.get('range'), query.get('from'), query.get('to'), settings.timezone)
  const report = (await REPORTS[type](ownerId, range, settings.timezone, locationId)) as Record<string, unknown>

  if (query.get('format') === 'csv') {
    // Export one section of the report: any array of flat rows.
    const section = query.get('section') || 'series'
    const rows = report[section]
    if (!Array.isArray(rows) || rows.length === 0) return csvResponse(`${type}-${section}`, ['No data'], [])
    const money = /cents$/i
    const columns = Object.keys(rows[0]).filter((k) => k !== 'id')
    const isMoney = (key: string) => money.test(key) || (key === 'value' && type === 'financial')
    return csvResponse(
      `${type}-${section}`,
      columns.map((c) => c.replace(/Cents$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase()).trim()),
      rows.map((row: Record<string, unknown>) => columns.map((c) => (isMoney(c) && typeof row[c] === 'number' ? (row[c] as number) / 100 : row[c])))
    )
  }
  return { range: { preset: range.preset, start: range.start, end: range.end, days: range.days }, ...report }
})
