import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { LEAD_STAGES, normalizeLeadStage } from '@/lib/format'
import { createLead, leadCreateSchema } from '@/lib/services/leads'
import { effectiveLocation } from '@/lib/services/today'

export const dynamic = 'force-dynamic'

// GET /api/leads?search=&assignedStaffId=&source= - the whole pipeline (open leads plus recent wins and losses)
export const GET = handler({ permission: 'leads.view' }, async ({ ownerId, query, actor }) => {
  const scope = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const search = (query.get('search') || '').trim()
  const recent = new Date(Date.now() - 60 * 86_400_000)
  const where: Prisma.ProspectWhereInput = {
    ownerId,
    ...(query.get('assignedStaffId') && { assignedStaffId: query.get('assignedStaffId')! }),
    // A lead with no location yet belongs to everyone, so locked staff still see it.
    ...(scope.locationId && (scope.locked ? { AND: [{ OR: [{ locationId: scope.locationId }, { locationId: null }] }] } : { locationId: scope.locationId })),
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

export const POST = handler({ permission: 'leads.manage', write: true, body: leadCreateSchema }, async ({ ownerId, body, actor, audit }) => {
  // Staff locked to a location create leads there, whatever the form sent.
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const scope = await effectiveLocation(ownerId, actor, body.locationId)
  const lead = await createLead(ownerId, body, actor, { lockedLocationId: scope.locked ? scope.locationId : null })
  await audit('prospect_create', `Added lead ${lead.name}`, { entityType: 'lead', entityId: lead.id })
  return { id: lead.id }
})
