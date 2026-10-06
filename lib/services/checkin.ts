// Front-desk check-in: find the member, validate, record the visit, and return
// everything the desk needs to see at a glance.

import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { startOfZonedDay, zonedParts, addDaysToDate } from '@/lib/dates'
import { formatDate, formatMoney, normalizeMemberStatus } from '@/lib/format'
import { Db, ActorRef, GymSettings, getGymSettings, logActivity } from './core'
import { memberBalance } from './payments'
import { LIVE_STATUSES } from './memberships'

export const CHECKIN_SOURCES = ['qr', 'phone', 'kiosk', 'manual', 'search', 'barcode'] as const

/** Statuses that may not check in without a staff override. */
const BLOCKED: Record<string, string> = {
  frozen: 'membership is frozen',
  cancelled: 'membership has been cancelled',
  inactive: 'is not an active member',
}

export function nextStreak(member: Pick<Member, 'currentStreak' | 'longestStreak' | 'lastStreakCheckDate'>, at: Date, tz: string) {
  const today = zonedParts(at, tz).date
  const last = member.lastStreakCheckDate ? zonedParts(member.lastStreakCheckDate, tz).date : null
  let current = member.currentStreak
  if (last === today) {
    current = Math.max(1, current)
  } else if (last && addDaysToDate(last, 1) === today) {
    current = current + 1
  } else if (!last || last < today) {
    current = 1
  }
  return { current, longest: Math.max(member.longestStreak, current) }
}

interface VisitInput {
  ownerId: string
  member: Member
  settings: GymSettings
  source: string
  type?: string
  sessionId?: string | null
  locationId?: string | null
  deviceName?: string | null
  actor?: ActorRef
  title?: string
  at?: Date
}

/** Write the Checkin row, update streaks and the timeline. Shared by desk check-in and roster attendance. */
export async function recordVisit(db: Db, input: VisitInput) {
  const at = input.at || new Date()
  const streak = nextStreak(input.member, at, input.settings.timezone)
  const isLatest = !input.member.lastCheckInAt || at >= input.member.lastCheckInAt
  const checkin = await db.checkin.create({
    data: {
      ownerId: input.ownerId,
      memberId: input.member.id,
      timestamp: at,
      source: input.source,
      type: input.type || 'open_gym',
      sessionId: input.sessionId || null,
      locationId: input.locationId || null,
      deviceName: input.deviceName || null,
      staffId: input.actor && input.actor.type !== 'member' && input.actor.type !== 'system' ? input.actor.id : null,
    },
  })
  if (isLatest) {
    await db.member.update({
      where: { id: input.member.id },
      data: {
        lastCheckInAt: at,
        currentStreak: streak.current,
        longestStreak: streak.longest,
        lastStreakCheckDate: startOfZonedDay(at, input.settings.timezone),
      },
    })
  }
  await logActivity(db, {
    ownerId: input.ownerId,
    memberId: input.member.id,
    type: input.sessionId ? 'class_attended' : 'checkin',
    title: input.title || 'Checked in',
    metadata: { checkinId: checkin.id, sessionId: input.sessionId, source: input.source },
    actor: input.actor,
    createdAt: at,
  })
  return { checkin, streak: isLatest ? streak : { current: input.member.currentStreak, longest: input.member.longestStreak } }
}

export interface CheckInInput {
  ownerId: string
  memberId: string
  source: string
  locationId?: string | null
  deviceName?: string | null
  /** Staff override for a member who would otherwise be refused. */
  force?: boolean
  actor?: ActorRef
}

export async function checkInMember(db: Db, input: CheckInInput) {
  const member = await db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } })
  if (!member) throw notFound('Member')
  if (member.archivedAt) throw new ApiError(422, `${member.name} is archived.`, 'member_archived')
  const status = normalizeMemberStatus(member.status)
  if (BLOCKED[status] && !input.force) {
    throw new ApiError(422, `${member.name}${status === 'inactive' ? ' ' : "'s "}${BLOCKED[status]}.`, `member_${status}`, { memberId: member.id, canOverride: true })
  }
  const settings = await getGymSettings(input.ownerId, db)
  const now = new Date()

  // A double scan or double tap should not create two visits.
  const recent = await db.checkin.findFirst({
    where: { memberId: member.id, timestamp: { gt: new Date(now.getTime() - 2 * 60_000) } },
    orderBy: { timestamp: 'desc' },
  })
  if (recent) {
    return { member, checkin: recent, duplicate: true, streak: { current: member.currentStreak, longest: member.longestStreak }, attended: null }
  }

  // If they are booked into a class starting soon (or in progress), this check-in is their attendance.
  const booking = await db.booking.findFirst({
    where: {
      memberId: member.id,
      status: 'booked',
      session: { status: 'scheduled', startsAt: { lte: new Date(now.getTime() + 60 * 60_000) }, endsAt: { gt: now } },
    },
    orderBy: { session: { startsAt: 'asc' } },
    include: { session: { include: { classType: { select: { name: true, category: true } } } } },
  })

  const className = booking ? booking.session.title || booking.session.classType.name : null
  const { checkin, streak } = await recordVisit(db, {
    ownerId: input.ownerId,
    member,
    settings,
    source: input.source,
    type: booking ? (booking.session.classType.category === 'personal_training' ? 'personal_training' : 'class') : 'open_gym',
    sessionId: booking?.sessionId,
    locationId: booking?.session.locationId || input.locationId,
    deviceName: input.deviceName,
    actor: input.actor,
    title: className ? `Checked in for ${className}` : 'Checked in',
  })
  if (booking) {
    await db.booking.update({ where: { id: booking.id }, data: { status: 'attended', checkedInAt: now } })
  }
  return { member, checkin, duplicate: false, streak, attended: booking ? { sessionId: booking.sessionId, name: className! } : null }
}

export interface Alert {
  level: 'danger' | 'warning' | 'info'
  message: string
}

/** Everything the desk wants to know about a member before (or just after) checking them in. */
export async function memberCard(ownerId: string, memberId: string) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, ownerId },
    select: {
      id: true, name: true, email: true, phone: true, photoUrl: true, status: true, lastCheckInAt: true,
      currentStreak: true, dateOfBirth: true, waiverSignedAt: true, creditBalanceCents: true, archivedAt: true,
      medicalNotes: true,
      memberships: {
        where: { status: { in: LIVE_STATUSES } },
        orderBy: { createdAt: 'desc' },
        include: { plan: { select: { name: true, type: true } } },
      },
    },
  })
  if (!member) throw notFound('Member')
  const settings = await getGymSettings(ownerId)
  const now = new Date()
  const dayStart = startOfZonedDay(now, settings.timezone)
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)

  const [balance, profile, bookings, visitsThisMonth] = await Promise.all([
    memberBalance(ownerId, memberId),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { waiverEnabled: true } }),
    prisma.booking.findMany({
      where: { memberId, status: { in: ['booked', 'attended', 'offered', 'waitlisted'] }, session: { startsAt: { gte: dayStart, lt: dayEnd }, status: 'scheduled' } },
      orderBy: { session: { startsAt: 'asc' } },
      select: { id: true, status: true, session: { select: { id: true, title: true, startsAt: true, classType: { select: { name: true, color: true } } } } },
    }),
    prisma.checkin.count({ where: { memberId, timestamp: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
  ])

  const status = normalizeMemberStatus(member.status)
  const primary = member.memberships[0] || null
  const alerts: Alert[] = []
  if (member.archivedAt) alerts.push({ level: 'danger', message: 'Archived member' })
  if (status === 'past_due') alerts.push({ level: 'danger', message: 'Membership is past due' })
  if (status === 'frozen') alerts.push({ level: 'danger', message: 'Membership is frozen' })
  if (status === 'cancelled') alerts.push({ level: 'danger', message: 'Membership cancelled' })
  if (status === 'inactive') alerts.push({ level: 'danger', message: 'Not an active member' })
  if (balance.overdueCents > 0) alerts.push({ level: 'danger', message: `${formatMoney(balance.overdueCents)} overdue` })
  else if (balance.balanceCents > 0) alerts.push({ level: 'warning', message: `${formatMoney(balance.balanceCents)} balance due` })
  if (profile?.waiverEnabled && !member.waiverSignedAt) alerts.push({ level: 'warning', message: 'Waiver not signed' })
  if (member.medicalNotes) alerts.push({ level: 'info', message: 'Has medical notes on file' })
  for (const m of member.memberships) {
    if (m.creditsRemaining !== null && m.creditsRemaining <= 1 && m.status !== 'frozen') {
      alerts.push({ level: 'warning', message: m.creditsRemaining === 0 ? `No sessions left on ${m.plan.name}` : `1 session left on ${m.plan.name}` })
    }
    const ends = m.cancelAt || m.endDate
    if (ends && ends.getTime() - now.getTime() < 7 * 86_400_000 && ends > now) {
      alerts.push({ level: 'warning', message: `${m.plan.name} ends ${formatDate(ends, settings.timezone)}` })
    }
  }
  if (member.dateOfBirth) {
    const today = zonedParts(now, settings.timezone)
    if (member.dateOfBirth.getUTCMonth() + 1 === today.month && member.dateOfBirth.getUTCDate() === today.day) {
      alerts.push({ level: 'info', message: 'Birthday today' })
    }
  }

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    photoUrl: member.photoUrl,
    status,
    lastCheckInAt: member.lastCheckInAt,
    currentStreak: member.currentStreak,
    visitsLast30Days: visitsThisMonth,
    balanceCents: balance.balanceCents,
    creditBalanceCents: member.creditBalanceCents,
    membership: primary
      ? {
          id: primary.id,
          name: primary.plan.name,
          status: primary.status,
          creditsRemaining: primary.creditsRemaining,
          renewsAt: primary.plan.type === 'recurring' && primary.autoRenew && !primary.cancelAt ? primary.currentPeriodEnd : null,
          endsAt: primary.cancelAt || primary.endDate,
        }
      : null,
    canCheckIn: !member.archivedAt && !BLOCKED[status],
    alerts,
    todaysBookings: bookings.map((b) => ({
      id: b.id,
      status: b.status,
      sessionId: b.session.id,
      name: b.session.title || b.session.classType.name,
      color: b.session.classType.color,
      startsAt: b.session.startsAt,
    })),
  }
}

/** Fast lookup for the check-in box: QR/barcode value, phone digits, name or email. */
export async function findMembers(ownerId: string, query: string, limit = 8) {
  const q = query.trim()
  if (!q) return []
  const select = { id: true, name: true, email: true, phone: true, photoUrl: true, status: true, lastCheckInAt: true } as const
  // Scanned codes are exact matches: check those first.
  if (q.startsWith('clubcheck-member-') || q.length > 24) {
    const exact = await prisma.member.findFirst({ where: { ownerId, qrCode: q, archivedAt: null }, select })
    if (exact) return [{ ...exact, exact: true }]
  }
  const digits = q.replace(/\D/g, '')
  const looksLikePhone = digits.length >= 4 && /^[\d\s()+.-]+$/.test(q)
  if (looksLikePhone) {
    // Stored phone numbers have mixed formatting, so compare digits only.
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Member"
      WHERE "ownerId" = ${ownerId} AND "archivedAt" IS NULL AND phone IS NOT NULL
        AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
      ORDER BY name LIMIT ${limit}`
    if (rows.length === 0) return []
    const members = await prisma.member.findMany({ where: { id: { in: rows.map((r) => r.id) }, ownerId }, select, orderBy: { name: 'asc' } })
    return members.map((m) => ({ ...m, exact: members.length === 1 && (m.phone || '').replace(/\D/g, '').endsWith(digits) && digits.length >= 10 }))
  }
  const members = await prisma.member.findMany({
    where: {
      ownerId,
      archivedAt: null,
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
    },
    select,
    orderBy: [{ lastCheckInAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    take: limit,
  })
  return members.map((m) => ({ ...m, exact: false }))
}
