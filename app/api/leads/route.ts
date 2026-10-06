import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { LEAD_STAGES, normalizeLeadStage } from '@/lib/format'
import { dateInput, optionalText } from '@/lib/schemas'
import { logActivity } from '@/lib/services/core'
import { fireTrigger, flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

// GET /api/leads?search=&assignedStaffId=&source= - the whole pipeline (open leads plus recent wins and losses)
export const GET = handler({ permission: 'leads.view' }, async ({ ownerId, query }) => {
  const search = (query.get('search') || '').trim()
  const recent = new Date(Date.now() - 60 * 86_400_000)
  const where: Prisma.ProspectWhereInput = {
    ownerId,
    ...(query.get('assignedStaffId') && { assignedStaffId: query.get('assignedStaffId')! }),
    ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    ...(search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search, mode: 'insensitive' } }] }
      : { OR: [{ status: { notIn: ['converted', 'lost'] } }, { updatedAt: { gte: recent } }] }),
  }
  const leads = await prisma.prospect.findMany({
    where,
    orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 500,
    select: {
      id: true, name: true, email: true, phone: true, status: true, source: true, interest: true, createdAt: true, updatedAt: true, trialDate: true,
      nextFollowUpAt: true, estimatedValueCents: true, convertedMemberId: true, lostReason: true,
      assignedStaff: { select: { id: true, name: true } },
    },
  })
  const counts = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, 0])) as Record<string, number>
  const shaped = leads.map((l) => {
    const stage = normalizeLeadStage(l.status)
    counts[stage]++
    return { ...l, status: stage }
  })
  return { leads: shaped, counts }
})

const createSchema = z.object({
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

export const POST = handler({ permission: 'leads.manage', write: true, body: createSchema }, async ({ ownerId, body, actor, audit }) => {
  await assertOwned(ownerId, 'staff', body.assignedStaffId, 'Staff member')
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const lead = await prisma.$transaction(async (db) => {
    const created = await db.prospect.create({ data: { ownerId, ...body } })
    await logActivity(db, { ownerId, prospectId: created.id, type: 'lead_created', title: 'Lead created', detail: body.source ? `Source: ${body.source}` : undefined, actor })
    await fireTrigger(db, ownerId, 'lead_created', { prospectId: created.id, dedupeKey: created.id })
    return created
  })
  await audit('prospect_create', `Added lead ${lead.name}`, { entityType: 'lead', entityId: lead.id })
  await flushOutbox(ownerId)
  return { id: lead.id }
})
