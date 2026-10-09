import { prisma } from '@/lib/prisma'
import { badRequest, notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { getSlots } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

// GET ?typeId=&date=YYYY-MM-DD&staffId=&locationId=&reschedule=<appointmentId>
// Times this member could actually book: free for the coach and free for the member.
export const GET = portalHandler({}, async ({ req, member, ownerId }) => {
  const query = req.nextUrl.searchParams
  const typeId = query.get('typeId')
  const date = query.get('date')
  if (!typeId || !date) throw badRequest('typeId and date are required.')
  const type = await prisma.appointmentType.findFirst({ where: { id: typeId, ownerId, isActive: true }, select: { id: true } })
  if (!type) throw notFound('Appointment type')
  const moving = query.get('reschedule')
  // A member can only exclude one of their own appointments from the clash check.
  const own = moving ? await prisma.appointment.findFirst({ where: { id: moving, ownerId, memberId: member.id }, select: { id: true } }) : null
  if (moving && !own) throw notFound('Appointment')
  const slots = await getSlots({ ownerId, typeId, date, staffId: query.get('staffId'), locationId: query.get('locationId'), memberId: member.id, ignoreAppointmentId: own?.id })
  return slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, coaches: s.staff.map((p) => ({ id: p.id, name: p.name })) }))
})
