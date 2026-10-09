// Leads: adding one and moving it along the pipeline. The staff app and the public API both come
// through here, so a lead from a website form is treated exactly like one typed in at the desk.

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, badRequest, notFound } from '@/lib/api'
import { LEAD_STAGES, formatDateTime, normalizeLeadStage } from '@/lib/format'
import { dateInput, optionalText } from '@/lib/schemas'
import { ActorRef, getGymSettings, logActivity } from './core'
import { fireTrigger, flushOutbox } from './automations'
import { leadEvent } from './events'

export const leadCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: optionalText(30),
  source: optionalText(100),
  interest: optionalText(200),
  notes: optionalText(2000),
  assignedStaffId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  estimatedValueCents: z.number().int().min(0).max(100_000_000).nullish(),
  nextFollowUpAt: dateInput.nullish(),
})

export const leadUpdateSchema = z.object({
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

/** `lockedLocationId`: staff tied to one location create leads there, whatever the form sent. */
export async function createLead(ownerId: string, input: z.infer<typeof leadCreateSchema>, actor?: ActorRef, opts: { lockedLocationId?: string | null } = {}) {
  await assertOwned(ownerId, 'staff', input.assignedStaffId, 'Staff member')
  await assertOwned(ownerId, 'location', input.locationId, 'Location')
  const lead = await prisma.$transaction(async (db) => {
    const created = await db.prospect.create({ data: { ownerId, ...input, ...(opts.lockedLocationId && { locationId: opts.lockedLocationId }) } })
    await logActivity(db, { ownerId, prospectId: created.id, type: 'lead_created', title: 'Lead created', detail: input.source ? `Source: ${input.source}` : undefined, actor })
    await fireTrigger(db, ownerId, 'lead_created', { prospectId: created.id, dedupeKey: created.id })
    await leadEvent(db, ownerId, 'lead.created', created.id)
    return created
  })
  await flushOutbox(ownerId)
  return lead
}

/** Edit a lead or move it along the pipeline. "Converted" only happens by converting it to a member. */
export async function updateLead(ownerId: string, id: string, input: z.infer<typeof leadUpdateSchema>, actor?: ActorRef) {
  const before = await prisma.prospect.findFirst({ where: { id, ownerId } })
  if (!before) throw notFound('Lead')
  const from = normalizeLeadStage(before.status)
  if (from === 'converted' && input.status) throw badRequest('This lead is already a member.', 'already_converted')
  await assertOwned(ownerId, 'staff', input.assignedStaffId, 'Staff member')
  await assertOwned(ownerId, 'location', input.locationId, 'Location')
  const settings = await getGymSettings(ownerId)
  const to = input.status
  const now = new Date()

  const lead = await prisma.$transaction(async (db) => {
    const updated = await db.prospect.update({
      where: { id: before.id },
      data: {
        ...input,
        ...(to && to !== 'new' && !before.contactedAt && { contactedAt: now }),
        ...(to === 'trial_completed' && { touredAt: now }),
        ...(to && to !== 'lost' && { lostReason: null }),
      },
    })
    if (to && to !== from) {
      const label = LEAD_STAGES.find((s) => s.key === to)!.label
      await logActivity(db, { ownerId, prospectId: before.id, type: 'lead_stage', title: `Moved to ${label}`, detail: to === 'lost' ? input.lostReason : to === 'trial_scheduled' && updated.trialDate ? formatDateTime(updated.trialDate, settings.timezone) : undefined, actor })
      if (to === 'trial_scheduled') {
        await fireTrigger(db, ownerId, 'trial_booked', {
          prospectId: before.id, dedupeKey: `${before.id}:${updated.trialDate?.toISOString() || 'unscheduled'}`,
          context: { date: updated.trialDate ? formatDateTime(updated.trialDate, settings.timezone) : 'a time we will confirm with you' },
        })
      }
      if (to === 'trial_completed') await fireTrigger(db, ownerId, 'trial_completed', { prospectId: before.id, dedupeKey: `${before.id}:completed` })
    }
    await leadEvent(db, ownerId, 'lead.updated', before.id)
    return updated
  })
  await flushOutbox(ownerId)
  return { lead, from, moved: !!to && to !== from }
}
