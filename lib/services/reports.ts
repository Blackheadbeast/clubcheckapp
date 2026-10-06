// Dashboard and report queries. Everything here is computed from the live
// tables (transactions, memberships, check-ins, bookings, leads) for the
// requested date range, in the gym's timezone, optionally for one location.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { startOfZonedDay, type DateRange } from '@/lib/dates'
import { normalizeLeadStage, normalizeMemberStatus } from '@/lib/format'

type Loc = string | null | undefined

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null)
/** Percent change vs the previous period; null when there is nothing to compare against. */
const change = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null)

/** Stored timestamps are UTC without a zone: shift them into the gym's timezone before taking the date. */
const localDay = (column: Prisma.Sql, tz: string) => Prisma.sql`to_char((${column} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`
const localMonth = (column: Prisma.Sql, tz: string) => Prisma.sql`to_char((${column} AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM')`
const andLocation = (column: Prisma.Sql, locationId: Loc) => (locationId ? Prisma.sql`AND ${column} = ${locationId}` : Prisma.empty)

/** Long ranges are charted by month so the series stays readable. */
export function bucketing(range: DateRange) {
  const monthly = range.days > 92
  const keys = monthly ? Array.from(new Set(range.dates.map((d) => d.slice(0, 7)))) : range.dates
  return { monthly, keys }
}

function fill(keys: string[], rows: { bucket: string; value: number }[]) {
  const map = new Map(rows.map((r) => [r.bucket, Number(r.value)]))
  return keys.map((key) => ({ date: key, value: map.get(key) || 0 }))
}

async function netRevenue(ownerId: string, start: Date, end: Date, locationId: Loc) {
  const rows = await prisma.transaction.groupBy({
    by: ['type'],
    where: { ownerId, status: 'succeeded', type: { in: ['payment', 'refund'] }, method: { not: 'account_credit' }, createdAt: { gte: start, lt: end }, ...(locationId && { locationId }) },
    _sum: { amountCents: true },
    _count: { _all: true },
  })
  const gross = rows.find((r) => r.type === 'payment')?._sum.amountCents || 0
  const refunds = rows.find((r) => r.type === 'refund')?._sum.amountCents || 0
  return { grossCents: gross, refundsCents: refunds, netCents: gross - refunds, payments: rows.find((r) => r.type === 'payment')?._count._all || 0 }
}

export async function revenueSeries(ownerId: string, range: DateRange, tz: string, locationId: Loc) {
  const { monthly, keys } = bucketing(range)
  const bucket = monthly ? localMonth(Prisma.sql`"createdAt"`, tz) : localDay(Prisma.sql`"createdAt"`, tz)
  const rows = await prisma.$queryRaw<{ bucket: string; value: number }[]>`
    SELECT ${bucket} AS bucket, SUM(CASE WHEN type = 'refund' THEN -"amountCents" ELSE "amountCents" END)::float AS value
    FROM "Transaction"
    WHERE "ownerId" = ${ownerId} AND status = 'succeeded' AND type IN ('payment', 'refund') AND method <> 'account_credit'
      AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end} ${andLocation(Prisma.sql`"locationId"`, locationId)}
    GROUP BY 1`
  return fill(keys, rows)
}

export async function attendanceSeries(ownerId: string, range: DateRange, tz: string, locationId: Loc) {
  const { monthly, keys } = bucketing(range)
  const bucket = monthly ? localMonth(Prisma.sql`"timestamp"`, tz) : localDay(Prisma.sql`"timestamp"`, tz)
  const rows = await prisma.$queryRaw<{ bucket: string; value: number }[]>`
    SELECT ${bucket} AS bucket, COUNT(*)::float AS value
    FROM "Checkin"
    WHERE "ownerId" = ${ownerId} AND "timestamp" >= ${range.start} AND "timestamp" < ${range.end} ${andLocation(Prisma.sql`"locationId"`, locationId)}
    GROUP BY 1`
  return fill(keys, rows)
}

/** Monthly recurring revenue from memberships that will actually renew. */
export async function recurringRevenue(ownerId: string, locationId: Loc) {
  const memberships = await prisma.membership.findMany({
    where: {
      ownerId, status: { in: ['active', 'past_due'] }, autoRenew: true, cancelAt: null, plan: { type: 'recurring' },
      ...(locationId && { member: { homeLocationId: locationId } }),
    },
    select: { priceCents: true, plan: { select: { id: true, name: true, billingInterval: true, intervalCount: true } } },
  })
  const byPlan = new Map<string, { name: string; mrrCents: number; members: number }>()
  let mrr = 0
  for (const m of memberships) {
    const perMonth = m.plan.billingInterval === 'week' ? 52 / 12 : m.plan.billingInterval === 'year' ? 1 / 12 : 1
    const monthly = (m.priceCents * perMonth) / m.plan.intervalCount
    mrr += monthly
    const entry = byPlan.get(m.plan.id) || { name: m.plan.name, mrrCents: 0, members: 0 }
    entry.mrrCents += monthly
    entry.members++
    byPlan.set(m.plan.id, entry)
  }
  return {
    mrrCents: Math.round(mrr),
    arrCents: Math.round(mrr * 12),
    subscriptions: memberships.length,
    byPlan: Array.from(byPlan.values()).map((p) => ({ ...p, mrrCents: Math.round(p.mrrCents) })).sort((a, b) => b.mrrCents - a.mrrCents),
  }
}

async function utilization(ownerId: string, start: Date, end: Date, locationId: Loc) {
  const now = new Date()
  const sessions = await prisma.classSession.findMany({
    where: { ownerId, status: 'scheduled', startsAt: { gte: start, lt: end < now ? end : now }, ...(locationId && { locationId }) },
    select: { capacity: true, _count: { select: { bookings: { where: { status: { in: ['attended', 'booked', 'no_show'] } } } } } },
  })
  const capacity = sessions.reduce((s, x) => s + x.capacity, 0)
  const filled = sessions.reduce((s, x) => s + Math.min(x.capacity, x._count.bookings), 0)
  return { sessions: sessions.length, capacity, filled, percent: pct(filled, capacity) }
}

async function memberMovement(ownerId: string, start: Date, end: Date, locationId: Loc) {
  const location = locationId ? { homeLocationId: locationId } : {}
  const [joined, cancelled] = await Promise.all([
    prisma.member.count({ where: { ownerId, createdAt: { gte: start, lt: end }, ...location } }),
    prisma.membership.count({ where: { ownerId, status: 'cancelled', cancelledAt: { gte: start, lt: end }, plan: { type: 'recurring' }, ...(locationId && { member: location }) } }),
  ])
  return { joined, cancelled }
}

export interface DashboardOptions {
  ownerId: string
  range: DateRange
  tz: string
  locationId: Loc
  financial: boolean
  leads: boolean
}

export async function dashboard({ ownerId, range, tz, locationId, financial, leads }: DashboardOptions) {
  const now = new Date()
  const location = locationId ? { locationId } : {}
  const home = locationId ? { homeLocationId: locationId } : {}

  const [
    revenue, previousRevenue, recurring, movement, previousMovement, statusCounts, checkins, previousCheckins, util,
    upcoming, openInvoices, failed, pastDue, trend, attendance,
  ] = await Promise.all([
    financial ? netRevenue(ownerId, range.start, range.end, locationId) : null,
    financial ? netRevenue(ownerId, range.prevStart, range.prevEnd, locationId) : null,
    financial ? recurringRevenue(ownerId, locationId) : null,
    memberMovement(ownerId, range.start, range.end, locationId),
    memberMovement(ownerId, range.prevStart, range.prevEnd, locationId),
    prisma.member.groupBy({ by: ['status'], where: { ownerId, archivedAt: null, ...home }, _count: { _all: true } }),
    prisma.checkin.count({ where: { ownerId, timestamp: { gte: range.start, lt: range.end }, ...location } }),
    prisma.checkin.count({ where: { ownerId, timestamp: { gte: range.prevStart, lt: range.prevEnd }, ...location } }),
    utilization(ownerId, range.start, range.end, locationId),
    prisma.classSession.findMany({
      where: { ownerId, status: 'scheduled', endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 36 * 3_600_000) }, ...location },
      orderBy: { startsAt: 'asc' },
      take: 6,
      select: {
        id: true, title: true, startsAt: true, capacity: true,
        classType: { select: { name: true, color: true } }, coach: { select: { name: true } },
        _count: { select: { bookings: { where: { status: { in: ['booked', 'attended', 'offered'] } } } } },
      },
    }),
    financial ? prisma.invoice.aggregate({ where: { ownerId, status: 'open' }, _sum: { totalCents: true, amountPaidCents: true }, _count: true }) : null,
    financial ? prisma.transaction.aggregate({ where: { ownerId, type: 'payment', status: 'failed', createdAt: { gte: range.start, lt: range.end } }, _sum: { amountCents: true }, _count: true }) : null,
    prisma.membership.count({ where: { ownerId, status: 'past_due', ...(locationId && { member: home }) } }),
    financial ? revenueSeries(ownerId, range, tz, locationId) : null,
    attendanceSeries(ownerId, range, tz, locationId),
  ])

  const members: Record<string, number> = {}
  for (const row of statusCounts) {
    const key = normalizeMemberStatus(row.status)
    members[key] = (members[key] || 0) + row._count._all
  }
  const active = members.active || 0
  // Churn: recurring cancellations in the period over the members who could have cancelled.
  const churn = pct(movement.cancelled, active + movement.cancelled)

  const todayStart = startOfZonedDay(now, tz)
  const [leadStats, recentTransactions, staffActivity, activeMemberships, checkinsToday] = await Promise.all([
    leads
      ? Promise.all([
          prisma.prospect.count({ where: { ownerId, createdAt: { gte: range.start, lt: range.end } } }),
          prisma.prospect.count({ where: { ownerId, createdAt: { gte: range.prevStart, lt: range.prevEnd } } }),
          prisma.prospect.count({ where: { ownerId, status: { notIn: ['converted', 'lost'] } } }),
          prisma.prospect.count({ where: { ownerId, convertedAt: { gte: range.start, lt: range.end } } }),
          prisma.prospect.count({ where: { ownerId, status: 'trial_scheduled' } }),
        ])
      : null,
    financial
      ? prisma.transaction.findMany({
          where: { ownerId, ...location },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, type: true, status: true, amountCents: true, method: true, createdAt: true, member: { select: { id: true, name: true } } },
        })
      : null,
    prisma.auditLog.findMany({ where: { ownerId, actorType: { in: ['staff', 'owner'] } }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, description: true, actorEmail: true, createdAt: true } }),
    prisma.membership.count({ where: { ownerId, status: { in: ['active', 'trial', 'past_due'] }, ...(locationId && { member: home }) } }),
    prisma.checkin.count({ where: { ownerId, timestamp: { gte: todayStart }, ...location } }),
  ])

  return {
    range: { preset: range.preset, start: range.start, end: range.end, days: range.days },
    revenue: revenue && {
      netCents: revenue.netCents, grossCents: revenue.grossCents, refundsCents: revenue.refundsCents,
      change: change(revenue.netCents, previousRevenue!.netCents),
    },
    recurring: recurring && { mrrCents: recurring.mrrCents, arrCents: recurring.arrCents, subscriptions: recurring.subscriptions },
    members: {
      active, trial: members.trial || 0, pastDue: members.past_due || 0, frozen: members.frozen || 0,
      total: Object.values(members).reduce((s, n) => s + n, 0), activeMemberships,
      joined: movement.joined, joinedChange: change(movement.joined, previousMovement.joined),
      cancelled: movement.cancelled, cancelledChange: change(movement.cancelled, previousMovement.cancelled),
      churnPercent: churn,
    },
    attendance: { checkins, change: change(checkins, previousCheckins), today: checkinsToday, utilizationPercent: util.percent, sessions: util.sessions },
    billing: financial
      ? {
          outstandingCents: (openInvoices!._sum.totalCents || 0) - (openInvoices!._sum.amountPaidCents || 0),
          openInvoices: openInvoices!._count,
          failedCents: failed!._sum.amountCents || 0,
          failedCount: failed!._count,
          pastDueMemberships: pastDue,
        }
      : null,
    leads: leadStats && {
      created: leadStats[0], createdChange: change(leadStats[0], leadStats[1]), open: leadStats[2], converted: leadStats[3],
      conversionPercent: pct(leadStats[3], leadStats[0]), trialsScheduled: leadStats[4],
    },
    upcomingClasses: upcoming.map((s) => ({ id: s.id, name: s.title || s.classType.name, color: s.classType.color, startsAt: s.startsAt, coach: s.coach?.name || null, booked: s._count.bookings, capacity: s.capacity })),
    recentTransactions,
    staffActivity,
    trends: { monthly: bucketing(range).monthly, revenue: trend, attendance },
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function financialReport(ownerId: string, range: DateRange, tz: string, locationId: Loc) {
  const paidIn = Prisma.sql`i."ownerId" = ${ownerId} AND i.status = 'paid' AND i."paidAt" >= ${range.start} AND i."paidAt" < ${range.end}`
  const [revenue, previous, recurring, series, byCategory, byPlan, byProduct, byLocation, byMethod, failed, outstanding] = await Promise.all([
    netRevenue(ownerId, range.start, range.end, locationId),
    netRevenue(ownerId, range.prevStart, range.prevEnd, locationId),
    recurringRevenue(ownerId, locationId),
    revenueSeries(ownerId, range, tz, locationId),
    prisma.$queryRaw<{ label: string; value: number }[]>`
      SELECT it.type AS label, SUM(it."amountCents")::float AS value FROM "InvoiceItem" it JOIN "Invoice" i ON i.id = it."invoiceId"
      WHERE ${paidIn} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ label: string; value: number; count: number }[]>`
      SELECT p.name AS label, SUM(it."amountCents")::float AS value, COUNT(DISTINCT i.id)::int AS count
      FROM "InvoiceItem" it JOIN "Invoice" i ON i.id = it."invoiceId" JOIN "MembershipPlan" p ON p.id = it."planId"
      WHERE ${paidIn} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ label: string; value: number; count: number }[]>`
      SELECT oi.name AS label, SUM(oi."amountCents")::float AS value, SUM(oi.quantity)::int AS count
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."ownerId" = ${ownerId} AND o."createdAt" >= ${range.start} AND o."createdAt" < ${range.end} ${andLocation(Prisma.sql`o."locationId"`, locationId)}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    prisma.$queryRaw<{ label: string; value: number }[]>`
      SELECT COALESCE(l.name, 'No location') AS label, SUM(CASE WHEN t.type = 'refund' THEN -t."amountCents" ELSE t."amountCents" END)::float AS value
      FROM "Transaction" t LEFT JOIN "Location" l ON l.id = t."locationId"
      WHERE t."ownerId" = ${ownerId} AND t.status = 'succeeded' AND t.type IN ('payment', 'refund') AND t.method <> 'account_credit'
        AND t."createdAt" >= ${range.start} AND t."createdAt" < ${range.end}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.transaction.groupBy({
      by: ['method'],
      where: { ownerId, type: 'payment', status: 'succeeded', createdAt: { gte: range.start, lt: range.end }, ...(locationId && { locationId }) },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.transaction.aggregate({ where: { ownerId, type: 'payment', status: 'failed', createdAt: { gte: range.start, lt: range.end } }, _sum: { amountCents: true }, _count: true }),
    prisma.invoice.aggregate({ where: { ownerId, status: 'open' }, _sum: { totalCents: true, amountPaidCents: true }, _count: true }),
  ])
  const labels: Record<string, string> = { membership: 'Memberships', enrollment_fee: 'Enrollment fees', class_pack: 'Class packs & PT', product: 'Products', fee: 'Fees', other: 'Other' }
  return {
    summary: {
      netCents: revenue.netCents, grossCents: revenue.grossCents, refundsCents: revenue.refundsCents, payments: revenue.payments,
      netChange: change(revenue.netCents, previous.netCents),
      mrrCents: recurring.mrrCents, arrCents: recurring.arrCents,
      failedCents: failed._sum.amountCents || 0, failedCount: failed._count,
      outstandingCents: (outstanding._sum.totalCents || 0) - (outstanding._sum.amountPaidCents || 0),
    },
    monthly: bucketing(range).monthly,
    series,
    byCategory: byCategory.map((r) => ({ label: labels[r.label] || r.label, value: Number(r.value) })),
    byPlan: byPlan.map((r) => ({ label: r.label, value: Number(r.value), count: Number(r.count) })),
    byProduct: byProduct.map((r) => ({ label: r.label, value: Number(r.value), count: Number(r.count) })),
    byLocation: byLocation.map((r) => ({ label: r.label, value: Number(r.value) })),
    byMethod: byMethod.map((r) => ({ label: r.method, value: r._sum.amountCents || 0, count: r._count._all })).sort((a, b) => b.value - a.value),
    mrrByPlan: recurring.byPlan.map((p) => ({ label: p.name, value: p.mrrCents, count: p.members })),
  }
}

export async function membersReport(ownerId: string, range: DateRange, tz: string, locationId: Loc) {
  const home = locationId ? { homeLocationId: locationId } : {}
  const { monthly, keys } = bucketing(range)
  const bucket = monthly ? localMonth(Prisma.sql`"createdAt"`, tz) : localDay(Prisma.sql`"createdAt"`, tz)
  const [statusCounts, movement, previous, joinedSeries, byPlan, cancelReasons, lifetime, activeAtStart, retained] = await Promise.all([
    prisma.member.groupBy({ by: ['status'], where: { ownerId, archivedAt: null, ...home }, _count: { _all: true } }),
    memberMovement(ownerId, range.start, range.end, locationId),
    memberMovement(ownerId, range.prevStart, range.prevEnd, locationId),
    prisma.$queryRaw<{ bucket: string; value: number }[]>`
      SELECT ${bucket} AS bucket, COUNT(*)::float AS value FROM "Member"
      WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end} ${andLocation(Prisma.sql`"homeLocationId"`, locationId)}
      GROUP BY 1`,
    prisma.membership.groupBy({ by: ['planId'], where: { ownerId, status: { in: ['active', 'trial', 'past_due', 'frozen'] }, ...(locationId && { member: home }) }, _count: { _all: true } }),
    prisma.membership.groupBy({ by: ['cancelReason'], where: { ownerId, status: 'cancelled', cancelledAt: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
    prisma.$queryRaw<{ members: number; total: number }[]>`
      SELECT COUNT(DISTINCT "memberId")::int AS members, COALESCE(SUM(CASE WHEN type = 'refund' THEN -"amountCents" ELSE "amountCents" END), 0)::float AS total
      FROM "Transaction" WHERE "ownerId" = ${ownerId} AND status = 'succeeded' AND type IN ('payment', 'refund') AND "memberId" IS NOT NULL`,
    // Members holding a recurring membership when the period opened...
    prisma.membership.count({ where: { ownerId, plan: { type: 'recurring' }, startDate: { lt: range.start }, OR: [{ cancelledAt: null }, { cancelledAt: { gte: range.start } }], ...(locationId && { member: home }) } }),
    // ...and those of them still holding it when it closed.
    prisma.membership.count({ where: { ownerId, plan: { type: 'recurring' }, startDate: { lt: range.start }, OR: [{ cancelledAt: null }, { cancelledAt: { gte: range.end } }], ...(locationId && { member: home }) } }),
  ])
  const plans = await prisma.membershipPlan.findMany({ where: { ownerId }, select: { id: true, name: true } })
  const status: Record<string, number> = {}
  for (const row of statusCounts) {
    const key = normalizeMemberStatus(row.status)
    status[key] = (status[key] || 0) + row._count._all
  }
  const active = status.active || 0
  const ltv = lifetime[0] && lifetime[0].members > 0 ? Math.round(Number(lifetime[0].total) / lifetime[0].members) : 0
  return {
    summary: {
      active, total: Object.values(status).reduce((s, n) => s + n, 0),
      joined: movement.joined, joinedChange: change(movement.joined, previous.joined),
      cancelled: movement.cancelled, cancelledChange: change(movement.cancelled, previous.cancelled),
      churnPercent: pct(movement.cancelled, activeAtStart || active + movement.cancelled),
      retentionPercent: pct(retained, activeAtStart),
      lifetimeValueCents: ltv,
    },
    monthly,
    series: fill(keys, joinedSeries),
    byStatus: Object.entries(status).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    byPlan: byPlan.map((r) => ({ label: plans.find((p) => p.id === r.planId)?.name || 'Unknown', value: r._count._all })).sort((a, b) => b.value - a.value),
    cancelReasons: cancelReasons.map((r) => ({ label: r.cancelReason || 'No reason given', value: r._count._all })).sort((a, b) => b.value - a.value),
  }
}

export async function attendanceReport(ownerId: string, range: DateRange, tz: string, locationId: Loc) {
  const location = locationId ? { locationId } : {}
  const now = new Date()
  const sessionWhere = Prisma.sql`s."ownerId" = ${ownerId} AND s.status = 'scheduled' AND s."startsAt" >= ${range.start} AND s."startsAt" < ${range.end < now ? range.end : now} ${andLocation(Prisma.sql`s."locationId"`, locationId)}`
  const grouped = (key: Prisma.Sql, join: Prisma.Sql) => prisma.$queryRaw<{ label: string; sessions: number; capacity: number; attended: number; booked: number; no_shows: number; late_cancels: number }[]>`
    SELECT ${key} AS label, COUNT(*)::int AS sessions, SUM(s.capacity)::int AS capacity,
      SUM(b.attended)::int AS attended, SUM(b.booked)::int AS booked, SUM(b.no_shows)::int AS no_shows, SUM(b.late_cancels)::int AS late_cancels
    FROM "ClassSession" s ${join}
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE status = 'attended') AS attended,
             COUNT(*) FILTER (WHERE status IN ('attended', 'booked', 'no_show')) AS booked,
             COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
             COUNT(*) FILTER (WHERE status = 'late_cancelled') AS late_cancels
      FROM "Booking" WHERE "sessionId" = s.id
    ) b ON true
    WHERE ${sessionWhere} GROUP BY 1 ORDER BY 4 DESC NULLS LAST`

  const [checkins, previous, unique, series, byType, byClass, byCoach, byLocation, byHour, topMembers] = await Promise.all([
    prisma.checkin.count({ where: { ownerId, timestamp: { gte: range.start, lt: range.end }, ...location } }),
    prisma.checkin.count({ where: { ownerId, timestamp: { gte: range.prevStart, lt: range.prevEnd }, ...location } }),
    prisma.checkin.findMany({ where: { ownerId, timestamp: { gte: range.start, lt: range.end }, ...location }, distinct: ['memberId'], select: { memberId: true } }),
    attendanceSeries(ownerId, range, tz, locationId),
    prisma.checkin.groupBy({ by: ['type'], where: { ownerId, timestamp: { gte: range.start, lt: range.end }, ...location }, _count: { _all: true } }),
    grouped(Prisma.sql`ct.name`, Prisma.sql`JOIN "ClassType" ct ON ct.id = s."classTypeId"`),
    grouped(Prisma.sql`COALESCE(st.name, 'Unassigned')`, Prisma.sql`LEFT JOIN "Staff" st ON st.id = s."coachId"`),
    grouped(Prisma.sql`COALESCE(l.name, 'No location')`, Prisma.sql`LEFT JOIN "Location" l ON l.id = s."locationId"`),
    prisma.$queryRaw<{ hour: number; value: number }[]>`
      SELECT EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS hour, COUNT(*)::float AS value FROM "Checkin"
      WHERE "ownerId" = ${ownerId} AND "timestamp" >= ${range.start} AND "timestamp" < ${range.end} ${andLocation(Prisma.sql`"locationId"`, locationId)}
      GROUP BY 1 ORDER BY 1`,
    prisma.checkin.groupBy({ by: ['memberId'], where: { ownerId, timestamp: { gte: range.start, lt: range.end }, ...location }, _count: { _all: true }, orderBy: { _count: { memberId: 'desc' } }, take: 10 }),
  ])
  const names = await prisma.member.findMany({ where: { id: { in: topMembers.map((t) => t.memberId) } }, select: { id: true, name: true } })
  const shape = (rows: Awaited<ReturnType<typeof grouped>>) =>
    rows.map((r) => ({
      label: r.label, sessions: r.sessions, capacity: r.capacity, attended: r.attended || 0, booked: r.booked || 0, noShows: r.no_shows || 0,
      lateCancels: r.late_cancels || 0, utilizationPercent: pct(Math.min(r.booked || 0, r.capacity), r.capacity), noShowPercent: pct(r.no_shows || 0, r.booked || 0),
    }))
  const classes = shape(byClass)
  const totals = classes.reduce((t, c) => ({ capacity: t.capacity + c.capacity, booked: t.booked + c.booked, noShows: t.noShows + c.noShows, lateCancels: t.lateCancels + c.lateCancels, sessions: t.sessions + c.sessions }), { capacity: 0, booked: 0, noShows: 0, lateCancels: 0, sessions: 0 })
  const hourMap = new Map(byHour.map((h) => [h.hour, Number(h.value)]))
  return {
    summary: {
      checkins, checkinsChange: change(checkins, previous), uniqueMembers: unique.length,
      averagePerDay: range.days > 0 ? checkins / range.days : 0,
      classSessions: totals.sessions, utilizationPercent: pct(Math.min(totals.booked, totals.capacity), totals.capacity),
      noShows: totals.noShows, noShowPercent: pct(totals.noShows, totals.booked), lateCancels: totals.lateCancels,
    },
    monthly: bucketing(range).monthly,
    series,
    byType: byType.map((r) => ({ label: r.type, value: r._count._all })).sort((a, b) => b.value - a.value),
    byClass: classes,
    byCoach: shape(byCoach),
    byLocation: shape(byLocation),
    byHour: Array.from({ length: 18 }, (_, i) => i + 5).map((hour) => ({ hour, value: hourMap.get(hour) || 0 })),
    topMembers: topMembers.map((t) => ({ id: t.memberId, label: names.find((n) => n.id === t.memberId)?.name || 'Unknown', value: t._count._all })),
  }
}

export async function salesReport(ownerId: string, range: DateRange, tz: string, locationId: Loc) {
  const location = locationId ? { locationId } : {}
  const created = { ownerId, createdAt: { gte: range.start, lt: range.end }, ...location }
  const { monthly, keys } = bucketing(range)
  const bucket = monthly ? localMonth(Prisma.sql`"createdAt"`, tz) : localDay(Prisma.sql`"createdAt"`, tz)
  const [leads, previousLeads, cohort, pipeline, converted, series, staffRows, posByStaff, membershipsSold] = await Promise.all([
    prisma.prospect.count({ where: created }),
    prisma.prospect.count({ where: { ownerId, createdAt: { gte: range.prevStart, lt: range.prevEnd }, ...location } }),
    prisma.prospect.findMany({ where: created, select: { status: true, source: true, contactedAt: true, trialDate: true, touredAt: true, convertedAt: true, convertedMemberId: true, assignedStaffId: true } }),
    prisma.prospect.groupBy({ by: ['status'], where: { ownerId, ...location }, _count: { _all: true } }),
    prisma.prospect.findMany({ where: { ownerId, convertedAt: { gte: range.start, lt: range.end }, convertedMemberId: { not: null }, ...location }, select: { convertedMemberId: true } }),
    prisma.$queryRaw<{ bucket: string; value: number }[]>`
      SELECT ${bucket} AS bucket, COUNT(*)::float AS value FROM "Prospect"
      WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end} ${andLocation(Prisma.sql`"locationId"`, locationId)}
      GROUP BY 1`,
    prisma.staff.findMany({ where: { ownerId }, select: { id: true, name: true } }),
    prisma.order.groupBy({ by: ['staffName'], where: { ownerId, createdAt: { gte: range.start, lt: range.end }, ...location }, _sum: { totalCents: true }, _count: { _all: true } }),
    prisma.membership.count({ where: { ownerId, createdAt: { gte: range.start, lt: range.end } } }),
  ])
  const memberIds = converted.map((c) => c.convertedMemberId!)
  const leadRevenue = memberIds.length
    ? await prisma.transaction.aggregate({ where: { ownerId, memberId: { in: memberIds }, type: 'payment', status: 'succeeded' }, _sum: { amountCents: true, refundedCents: true } })
    : null

  const contacted = cohort.filter((l) => l.contactedAt || !['new'].includes(normalizeLeadStage(l.status))).length
  const trialed = cohort.filter((l) => l.touredAt || ['trial_completed', 'follow_up', 'converted'].includes(normalizeLeadStage(l.status))).length
  const won = cohort.filter((l) => normalizeLeadStage(l.status) === 'converted').length
  const bySource = new Map<string, { leads: number; converted: number }>()
  const byStaff = new Map<string, { leads: number; converted: number }>()
  for (const l of cohort) {
    const source = bySource.get(l.source || 'Unknown') || { leads: 0, converted: 0 }
    source.leads++
    if (normalizeLeadStage(l.status) === 'converted') source.converted++
    bySource.set(l.source || 'Unknown', source)
    const name = staffRows.find((s) => s.id === l.assignedStaffId)?.name || 'Unassigned'
    const person = byStaff.get(name) || { leads: 0, converted: 0 }
    person.leads++
    if (normalizeLeadStage(l.status) === 'converted') person.converted++
    byStaff.set(name, person)
  }
  const stageCounts: Record<string, number> = {}
  for (const row of pipeline) {
    const key = normalizeLeadStage(row.status)
    stageCounts[key] = (stageCounts[key] || 0) + row._count._all
  }
  return {
    summary: {
      leads, leadsChange: change(leads, previousLeads),
      contactPercent: pct(contacted, cohort.length), trialPercent: pct(trialed, cohort.length),
      trialConversionPercent: pct(won, trialed), conversionPercent: pct(won, cohort.length),
      converted: converted.length, membershipsSold,
      leadRevenueCents: (leadRevenue?._sum.amountCents || 0) - (leadRevenue?._sum.refundedCents || 0),
    },
    monthly,
    series: fill(keys, series),
    funnel: [
      { label: 'Leads', value: cohort.length }, { label: 'Contacted', value: contacted }, { label: 'Trial completed', value: trialed }, { label: 'Converted', value: won },
    ],
    pipeline: stageCounts,
    bySource: Array.from(bySource.entries()).map(([label, v]) => ({ label, ...v, conversionPercent: pct(v.converted, v.leads) })).sort((a, b) => b.leads - a.leads),
    byStaff: Array.from(byStaff.entries()).map(([label, v]) => ({ label, ...v, conversionPercent: pct(v.converted, v.leads) })).sort((a, b) => b.leads - a.leads),
    posByStaff: posByStaff.map((r) => ({ label: r.staffName || 'Unknown', value: r._sum.totalCents || 0, count: r._count._all })).sort((a, b) => b.value - a.value),
  }
}
