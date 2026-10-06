import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, handler, notFound } from '@/lib/api'
import { checkMemberLimit } from '@/lib/billing'
import { normalizeLeadStage } from '@/lib/format'
import { logActivity } from '@/lib/services/core'
import { createMember } from '@/lib/services/members'
import { sellMembership } from '@/lib/services/memberships'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const schema = z.object({
  planId: z.string().uuid().nullish(),
  paymentMethod: z.enum(['card', 'cash', 'check', 'ach', 'other']).default('cash'),
  collectNow: z.boolean().optional(),
})

// POST - turn a lead into a member, optionally selling a membership in the same step
export const POST = handler({ permission: 'leads.manage', write: true, body: schema }, async ({ ownerId, params, body, actor, audit, can }) => {
  const lead = await prisma.prospect.findFirst({ where: { id: params.id, ownerId } })
  if (!lead) throw notFound('Lead')
  if (normalizeLeadStage(lead.status) === 'converted') throw badRequest('This lead has already been converted.', 'already_converted')
  if (body.planId && !can('memberships.manage')) throw new ApiError(403, 'You do not have permission to sell memberships.', 'forbidden')
  const limit = await checkMemberLimit(ownerId)
  if (!limit.allowed) throw new ApiError(403, limit.error, 'member_limit')
  const existing = await prisma.member.findFirst({ where: { ownerId, email: lead.email.toLowerCase(), archivedAt: null }, select: { id: true, name: true } })
  if (existing) throw new ApiError(409, `${existing.name} is already a member with that email address.`, 'duplicate_email', { memberId: existing.id })

  const result = await prisma.$transaction(async (db) => {
    const member = await createMember(db, ownerId, {
      name: lead.name, email: lead.email.toLowerCase(), phone: lead.phone, leadSource: lead.source, homeLocationId: lead.locationId, goals: lead.interest,
    }, actor, { status: body.planId ? 'active' : 'inactive' })
    await db.prospect.update({ where: { id: lead.id }, data: { status: 'converted', convertedAt: new Date(), convertedMemberId: member.id, nextFollowUpAt: null } })
    await logActivity(db, { ownerId, prospectId: lead.id, type: 'lead_converted', title: 'Converted to member', actor })
    await logActivity(db, { ownerId, memberId: member.id, type: 'lead_converted', title: 'Converted from lead', detail: lead.source ? `Source: ${lead.source}` : undefined, actor })
    const sale = body.planId ? await sellMembership(db, { ownerId, memberId: member.id, planId: body.planId, paymentMethod: body.paymentMethod, collectNow: body.collectNow, locationId: lead.locationId, actor }) : null
    return { member, sale }
  }, { timeout: 20_000 })

  await audit('prospect_convert', `Converted lead ${lead.name} to a member${result.sale ? ` on ${result.sale.plan.name}` : ''}`, { entityType: 'lead', entityId: lead.id, metadata: { memberId: result.member.id } })
  await flushOutbox(ownerId)
  return { memberId: result.member.id }
})
