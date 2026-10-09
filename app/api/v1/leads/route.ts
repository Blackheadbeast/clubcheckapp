import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Created, Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { leadOut } from '@/lib/public-api/serialize'
import { createLead, leadCreateSchema } from '@/lib/services/leads'

export const dynamic = 'force-dynamic'

const STAGES = ['new', 'contacted', 'trial_scheduled', 'trial_completed', 'follow_up', 'converted', 'lost'] as const

// GET /api/v1/leads?status=&source=&email=&search=&locationId=&createdSince=&updatedSince=
export const GET = publicHandler({ scope: 'leads:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const createdSince = dateParam(query, 'createdSince')
  const updatedSince = dateParam(query, 'updatedSince')
  const status = oneOf(query, 'status', STAGES)
  const search = (query.get('search') || '').trim().slice(0, 100)
  const where: Prisma.ProspectWhereInput = {
    ownerId,
    ...(status && { status: status === 'trial_completed' ? { in: ['trial_completed', 'toured'] } : status }),
    ...(query.get('source') && { source: query.get('source')! }),
    ...(query.get('email') && { email: query.get('email')!.trim().toLowerCase() }),
    ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    ...(createdSince && { createdAt: { gte: createdSince } }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] }),
  }
  const [rows, total] = await Promise.all([
    prisma.prospect.findMany({ where, orderBy: updatedSince ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
    prisma.prospect.count({ where }),
  ])
  return new Page(rows.map(leadOut), total, page, pageSize)
})

// POST /api/v1/leads - for a website form, an ad platform, a chat widget
export const POST = publicHandler({ scope: 'leads:write', write: true, body: leadCreateSchema, idempotent: true }, async ({ ownerId, body, actor, audit }) => {
  const lead = await createLead(ownerId, body, actor)
  await audit('prospect_create', `Added lead ${lead.name} through the API`, { entityType: 'lead', entityId: lead.id })
  return new Created(leadOut(lead))
})
