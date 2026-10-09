import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { leadOut } from '@/lib/public-api/serialize'
import { leadUpdateSchema, updateLead } from '@/lib/services/leads'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'leads:read' }, async ({ ownerId, params }) => {
  const lead = await prisma.prospect.findFirst({ where: { id: params.id, ownerId } })
  if (!lead) throw notFound('Lead')
  return leadOut(lead)
})

// PATCH /api/v1/leads/:id - change details or move it along the pipeline
export const PATCH = publicHandler({ scope: 'leads:write', write: true, body: leadUpdateSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const { lead, moved } = await updateLead(ownerId, params.id, body, actor)
  await audit('prospect_update', moved ? `Moved lead ${lead.name} to ${body.status!.replace('_', ' ')} through the API` : `Updated lead ${lead.name} through the API`, { entityType: 'lead', entityId: lead.id })
  return leadOut(lead)
})
