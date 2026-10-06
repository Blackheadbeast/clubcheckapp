import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')

// GET - an .ics file so the member can add the class to their own calendar
export const GET = portalHandler({}, async ({ member, ownerId, params }) => {
  const booking = await prisma.booking.findFirst({
    where: { id: params.id, memberId: member.id, ownerId },
    include: { session: { include: { classType: { select: { name: true } }, coach: { select: { name: true } }, location: { select: { name: true, address: true, city: true } } } } },
  })
  if (!booking) throw notFound('Booking')
  const settings = await getGymSettings(ownerId)
  const s = booking.session
  const name = s.title || s.classType.name
  const place = [settings.name, s.location?.name, s.room, s.location?.address, s.location?.city].filter(Boolean).join(', ')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClubCheck//Member Portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${booking.id}@clubcheck`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(s.startsAt)}`, `DTEND:${stamp(s.endsAt)}`,
    `SUMMARY:${escape(`${name} at ${settings.name}`)}`, `LOCATION:${escape(place)}`,
    ...(s.coach ? [`DESCRIPTION:${escape(`Coach: ${s.coach.name}`)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics"`, 'Cache-Control': 'no-store' } })
})
