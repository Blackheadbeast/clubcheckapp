import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { ensureSessions, listSessions } from '@/lib/services/classes'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET ?date=YYYY-MM-DD&days=7&classTypeId= - bookable classes with this member's own booking state
export const GET = portalHandler({}, async ({ req, member, ownerId }) => {
  const settings = await getGymSettings(ownerId)
  const query = req.nextUrl.searchParams
  const now = new Date()
  const today = zonedParts(now, settings.timezone).date
  const requested = query.get('date')
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested >= today ? requested : today
  const days = Math.min(14, Math.max(1, parseInt(query.get('days') || '7', 10) || 7))
  const from = date === today ? now : zonedToUtc(date, '00:00', settings.timezone)
  const to = zonedToUtc(addDaysToDate(date, days), '00:00', settings.timezone)
  await ensureSessions(ownerId, to, now)

  const [sessions, mine, classTypes] = await Promise.all([
    listSessions(ownerId, { from, to, classTypeId: query.get('classTypeId') }),
    prisma.booking.findMany({ where: { memberId: member.id, status: { in: ['booked', 'offered', 'waitlisted', 'attended'] }, session: { startsAt: { gte: from, lt: to } } }, select: { id: true, sessionId: true, status: true } }),
    prisma.classType.findMany({ where: { ownerId, isActive: true, category: { not: 'personal_training' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, color: true, description: true } }),
  ])
  const opensBefore = new Date(now.getTime() + settings.bookingWindowDays * 86_400_000)
  const closesWithin = settings.bookingCutoffMinutes * 60_000
  return {
    today,
    classTypes,
    sessions: sessions
      // One-to-one sessions are arranged with the trainer, not booked from the public schedule.
      .filter((s) => s.classType.category !== 'personal_training')
      .map((s) => {
        const booking = mine.find((b) => b.sessionId === s.id)
        return {
          id: s.id, name: s.title, color: s.classType.color, classTypeId: s.classType.id, startsAt: s.startsAt, endsAt: s.endsAt,
          coach: s.coach?.name || null, location: [s.location?.name, s.room].filter(Boolean).join(' · ') || null,
          capacity: s.capacity, spotsLeft: s.spotsLeft, waitlisted: s.waitlisted, waitlistOpen: s.waitlisted < s.waitlistCapacity,
          // Members see availability, never who else is booked.
          myBooking: booking ? { id: booking.id, status: booking.status } : null,
          bookable: s.startsAt.getTime() - closesWithin > now.getTime() && s.startsAt <= opensBefore,
          opensAt: s.startsAt > opensBefore ? new Date(s.startsAt.getTime() - settings.bookingWindowDays * 86_400_000) : null,
        }
      }),
  }
})
