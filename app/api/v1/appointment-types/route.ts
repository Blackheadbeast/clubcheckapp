import { prisma } from '@/lib/prisma'
import { Page, pageOf, publicHandler } from '@/lib/public-api/handler'

export const dynamic = 'force-dynamic'

// GET /api/v1/appointment-types - what can be booked, and with whom
export const GET = publicHandler({ scope: 'appointments:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const where = { ownerId, ...(query.get('active') === 'false' ? {} : { isActive: true }) }
  const [rows, total] = await Promise.all([
    prisma.appointmentType.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take, include: { staff: { select: { staff: { select: { id: true, name: true, active: true } } } } } }),
    prisma.appointmentType.count({ where }),
  ])
  return new Page(rows.map((t) => ({
    id: t.id, object: 'appointment_type' as const, name: t.name, description: t.description, durationMin: t.durationMin, paymentMode: t.paymentMode, priceCents: t.priceCents, creditsRequired: t.creditsRequired,
    cancelWindowHours: t.cancelWindowHours, minNoticeMinutes: t.minNoticeMinutes, maxAdvanceDays: t.maxAdvanceDays, locationIds: t.locationIds, isActive: t.isActive,
    staff: t.staff.filter((s) => s.staff.active).map((s) => ({ id: s.staff.id, name: s.staff.name })),
  })), total, page, pageSize)
})
