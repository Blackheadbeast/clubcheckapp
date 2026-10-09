import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')

// GET - an .ics file so the member can add the appointment to their own calendar
export const GET = portalHandler({}, async ({ member, ownerId, params }) => {
  const a = await prisma.appointment.findFirst({
    where: { id: params.id, memberId: member.id, ownerId },
    include: { type: { select: { name: true } }, staff: { select: { name: true } }, location: { select: { name: true, address: true, city: true } } },
  })
  if (!a) throw notFound('Appointment')
  const settings = await getGymSettings(ownerId)
  const place = [settings.name, a.location?.name, a.location?.address, a.location?.city].filter(Boolean).join(', ')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClubCheck//Member Portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:appointment-${a.id}@clubcheck`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(a.startsAt)}`, `DTEND:${stamp(a.endsAt)}`,
    `SUMMARY:${escape(`${a.type.name} with ${a.staff.name}`)}`, `LOCATION:${escape(place)}`, `DESCRIPTION:${escape(`${a.type.name} at ${settings.name}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${a.type.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics"`, 'Cache-Control': 'no-store' } })
})
