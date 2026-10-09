import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { checkInMember } from '@/lib/services/checkin'
import { getGymSettings } from '@/lib/services/core'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const WINDOW_MS = 60 * 60_000

// GET - what the check-in screen shows: whether self check-in is on, the class they would be
// checked into right now, and their recent visits
export const GET = portalHandler({}, async ({ member, ownerId }) => {
  const now = new Date()
  const [settings, current, recent, today] = await Promise.all([
    getGymSettings(ownerId),
    // The same window checkInMember uses to decide a check-in counts as class attendance.
    prisma.booking.findFirst({
      where: { memberId: member.id, status: 'booked', session: { status: 'scheduled', startsAt: { lte: new Date(now.getTime() + WINDOW_MS) }, endsAt: { gt: now } } },
      orderBy: { session: { startsAt: 'asc' } },
      select: { id: true, session: { select: { id: true, title: true, startsAt: true, endsAt: true, room: true, classType: { select: { name: true, color: true } }, coach: { select: { name: true } }, location: { select: { name: true } } } } },
    }),
    prisma.checkin.findMany({ where: { memberId: member.id }, orderBy: { timestamp: 'desc' }, take: 10, select: { id: true, timestamp: true, type: true, session: { select: { title: true, classType: { select: { name: true } } } } } }),
    prisma.checkin.findFirst({ where: { memberId: member.id, timestamp: { gt: new Date(now.getTime() - 3 * 3_600_000) } }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
  ])
  return {
    selfCheckin: settings.memberSelfCheckin,
    qrCode: member.qrCode,
    lastCheckinAt: today?.timestamp || null,
    currentClass: current && {
      bookingId: current.id, sessionId: current.session.id, name: current.session.title || current.session.classType.name, color: current.session.classType.color,
      startsAt: current.session.startsAt, endsAt: current.session.endsAt, coach: current.session.coach?.name || null,
      location: [current.session.location?.name, current.session.room].filter(Boolean).join(' · ') || null,
    },
    recent: recent.map((c) => ({ id: c.id, at: c.timestamp, label: c.session ? c.session.title || c.session.classType.name : c.type === 'personal_training' ? 'Personal training' : 'Open gym' })),
  }
})

// POST - the member checks themselves in. Exactly the front-desk rules (checkInMember) with no
// staff override: a frozen, cancelled or inactive member is refused here just as at the kiosk.
export const POST = portalHandler({ write: true }, async ({ member, ownerId, actor }) => {
  const settings = await getGymSettings(ownerId)
  if (!settings.memberSelfCheckin) throw new ApiError(403, 'Self check-in is turned off. Show your code at the front desk.', 'self_checkin_disabled')
  const result = await prisma.$transaction((db) => checkInMember(db, { ownerId, memberId: member.id, source: 'member_app', actor }), { timeout: 15_000 })
  await flushOutbox(ownerId)
  return { checkedInAt: result.checkin.timestamp, duplicate: result.duplicate, attended: result.attended, streak: result.streak }
})
