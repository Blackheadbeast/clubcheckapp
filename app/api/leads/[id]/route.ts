import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, badRequest, handler, notFound } from '@/lib/api'
import { LEAD_STAGES, formatDateTime, normalizeLeadStage } from '@/lib/format'
import { dateInput, optionalText } from '@/lib/schemas'
import { getGymSettings, logActivity } from '@/lib/services/core'
import { fireTrigger, flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'leads.view' }, async ({ ownerId, params }) => {
  const lead = await prisma.prospect.findFirst({
    where: { id: params.id, ownerId },
    include: {
      assignedStaff: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: 'desc' }, take: 100 },
      messages: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, channel: true, subject: true, body: true, status: true, error: true, createdAt: true } },
    },
  })
  if (!lead) throw notFound('Lead')
  return { ...lead, status: normalizeLeadStage(lead.status) }
})

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: optionalText(30),
  source: optionalText(100),
  interest: optionalText(200),
  notes: optionalText(2000),
  assignedStaffId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  estimatedValueCents: z.number().int().min(0).max(100_000_000).nullish(),
  nextFollowUpAt: dateInput.nullish(),
  trialDate: dateInput.nullish(),
  lostReason: optionalText(300),
  status: z.enum(['new', 'contacted', 'trial_scheduled', 'trial_completed', 'follow_up', 'lost']).optional(),
})

// PATCH - edit a lead or move it along the pipeline ("converted" only happens through /convert)
export const PATCH = handler({ permission: 'leads.manage', write: true, body: patchSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const before = await prisma.prospect.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Lead')
  const from = normalizeLeadStage(before.status)
  if (from === 'converted' && body.status) throw badRequest('This lead is already a member.', 'already_converted')
  await assertOwned(ownerId, 'staff', body.assignedStaffId, 'Staff member')
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const settings = await getGymSettings(ownerId)
  const to = body.status
  const now = new Date()

  const lead = await prisma.$transaction(async (db) => {
    const updated = await db.prospect.update({
      where: { id: before.id },
      data: {
        ...body,
        ...(to && to !== 'new' && !before.contactedAt && { contactedAt: now }),
        ...(to === 'trial_completed' && { touredAt: now }),
        ...(to && to !== 'lost' && { lostReason: null }),
      },
    })
    if (to && to !== from) {
      const label = LEAD_STAGES.find((s) => s.key === to)!.label
      await logActivity(db, { ownerId, prospectId: before.id, type: 'lead_stage', title: `Moved to ${label}`, detail: to === 'lost' ? body.lostReason : to === 'trial_scheduled' && updated.trialDate ? formatDateTime(updated.trialDate, settings.timezone) : undefined, actor })
      if (to === 'trial_scheduled') {
        await fireTrigger(db, ownerId, 'trial_booked', {
          prospectId: before.id, dedupeKey: `${before.id}:${updated.trialDate?.toISOString() || 'unscheduled'}`,
          context: { date: updated.trialDate ? formatDateTime(updated.trialDate, settings.timezone) : 'a time we will confirm with you' },
        })
      }
      if (to === 'trial_completed') await fireTrigger(db, ownerId, 'trial_completed', { prospectId: before.id, dedupeKey: `${before.id}:completed` })
    }
    return updated
  })
  await audit('prospect_update', to && to !== from ? `Moved lead ${lead.name} to ${to.replace('_', ' ')}` : `Updated lead ${lead.name}`, { entityType: 'lead', entityId: lead.id, before: { status: from }, after: { status: normalizeLeadStage(lead.status) } })
  await flushOutbox(ownerId)
  return { id: lead.id, status: normalizeLeadStage(lead.status) }
})

export const DELETE = handler({ permission: 'leads.manage', write: true }, async ({ ownerId, params, audit }) => {
  const lead = await prisma.prospect.findFirst({ where: { id: params.id, ownerId }, select: { id: true, name: true } })
  if (!lead) throw notFound('Lead')
  await prisma.prospect.delete({ where: { id: lead.id } })
  await audit('prospect_delete', `Deleted lead ${lead.name}`, { entityType: 'lead', entityId: lead.id })
  return { deleted: true }
})
