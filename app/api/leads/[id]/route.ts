import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { normalizeLeadStage } from '@/lib/format'
import { leadUpdateSchema, updateLead } from '@/lib/services/leads'

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

// PATCH - edit a lead or move it along the pipeline ("converted" only happens through /convert)
export const PATCH = handler({ permission: 'leads.manage', write: true, body: leadUpdateSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const { lead, from, moved } = await updateLead(ownerId, params.id, body, actor)
  await audit('prospect_update', moved ? `Moved lead ${lead.name} to ${body.status!.replace('_', ' ')}` : `Updated lead ${lead.name}`, { entityType: 'lead', entityId: lead.id, before: { status: from }, after: { status: normalizeLeadStage(lead.status) } })
  return { id: lead.id, status: normalizeLeadStage(lead.status) }
})

export const DELETE = handler({ permission: 'leads.manage', write: true }, async ({ ownerId, params, audit }) => {
  const lead = await prisma.prospect.findFirst({ where: { id: params.id, ownerId }, select: { id: true, name: true } })
  if (!lead) throw notFound('Lead')
  await prisma.prospect.delete({ where: { id: lead.id } })
  await audit('prospect_delete', `Deleted lead ${lead.name}`, { entityType: 'lead', entityId: lead.id })
  return { deleted: true }
})
