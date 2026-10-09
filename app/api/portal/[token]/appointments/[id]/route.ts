import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { dateInput, optionalText } from '@/lib/schemas'
import { cancelAppointment, getAppointment, memberView, rescheduleAppointment } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

async function own(ownerId: string, memberId: string, id: string) {
  const row = await prisma.appointment.findFirst({ where: { id, ownerId, memberId }, select: { id: true } })
  if (!row) throw notFound('Appointment')
  return row.id
}

export const GET = portalHandler({}, async ({ member, ownerId, params }) => memberView(await getAppointment(ownerId, await own(ownerId, member.id, params.id))))

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: optionalText(300) }),
  z.object({ action: z.literal('reschedule'), startsAt: dateInput, staffId: z.string().uuid().nullish() }),
])

// POST { action } - cancel or move the member's own appointment, under the type's cancellation policy
export const POST = portalHandler({ write: true, body: schema }, async ({ member, ownerId, params, body, actor }) => {
  const id = await own(ownerId, member.id, params.id)
  if (body.action === 'cancel') {
    const r = await cancelAppointment({ ownerId, appointmentId: id, by: 'member', memberId: member.id, reason: body.reason, actor })
    return { appointment: memberView(await getAppointment(ownerId, id)), late: r.late, creditsReturned: r.creditsReturned, refunded: r.refunded }
  }
  await rescheduleAppointment({ ownerId, appointmentId: id, startsAt: body.startsAt, staffId: body.staffId, by: 'member', memberId: member.id, actor })
  return { appointment: memberView(await getAppointment(ownerId, id)) }
})
