import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertOwned } from '@/lib/api'
import { Created, Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { invoiceOut, membershipOut } from '@/lib/public-api/serialize'
import { dateInput } from '@/lib/schemas'
import { getGymSettings } from '@/lib/services/core'
import { sellMembership } from '@/lib/services/memberships'
import { collectInvoice } from '@/lib/services/collections'
import { flushOutbox } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

const STATUSES = ['trial', 'active', 'past_due', 'frozen', 'cancelled', 'expired'] as const

// GET /api/v1/memberships?memberId=&planId=&status=&updatedSince=
export const GET = publicHandler({ scope: 'memberships:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const updatedSince = dateParam(query, 'updatedSince')
  const status = oneOf(query, 'status', STATUSES)
  const where: Prisma.MembershipWhereInput = {
    ownerId,
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('planId') && { planId: query.get('planId')! }),
    ...(status && { status }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
  }
  const [rows, total] = await Promise.all([
    prisma.membership.findMany({ where, orderBy: updatedSince ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }], skip, take, include: { plan: true } }),
    prisma.membership.count({ where }),
  ])
  return new Page(rows.map(membershipOut), total, page, pageSize)
})

const createSchema = z.object({
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
  startDate: dateInput.optional(),
  /** How the member will pay. "card" and "ach" use the payment method they have saved with the gym. */
  paymentMethod: z.enum(['card', 'cash', 'check', 'ach', 'other']).default('other'),
  discountPercent: z.number().int().min(0).max(100).optional(),
  couponCode: z.string().trim().max(40).optional(),
  /** Charge the first invoice to the saved card or bank account straight away. Otherwise it is left open. */
  collectNow: z.boolean().optional(),
  skipTrial: z.boolean().optional(),
  locationId: z.string().uuid().nullish(),
})

// POST /api/v1/memberships - start a membership for a member, by the same rules as selling one at the desk
export const POST = publicHandler({ scope: 'memberships:write', write: true, body: createSchema, idempotent: true }, async ({ ownerId, body, actor, audit }) => {
  const { memberId, collectNow, ...rest } = body
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const charging = !!collectNow && (body.paymentMethod === 'card' || body.paymentMethod === 'ach')
  // Cash, cheque and "other" are money the gym takes in person; software cannot say it was received.
  const result = await prisma.$transaction((db) => sellMembership(db, { ownerId, memberId, ...rest, collectNow: charging, actor }), { timeout: 15_000 })
  await audit('membership.sell', `Sold ${result.plan.name} through the API`, { entityType: 'membership', entityId: result.membership.id, metadata: { memberId, planId: result.plan.id, invoiceId: result.invoice?.id } })
  let charge = null
  if (charging && result.invoice?.status === 'open') {
    charge = await collectInvoice({ ownerId, invoiceId: result.invoice.id, actor }).catch((error) => ({ status: 'failed' as const, message: error instanceof Error ? error.message : 'The charge could not be attempted.' }))
  }
  await flushOutbox(ownerId)
  const [membership, invoice, settings] = await Promise.all([
    prisma.membership.findUniqueOrThrow({ where: { id: result.membership.id }, include: { plan: true } }),
    result.invoice ? prisma.invoice.findUnique({ where: { id: result.invoice.id }, include: { items: true } }) : null,
    getGymSettings(ownerId),
  ])
  return new Created({ ...membershipOut(membership), invoice: invoice ? invoiceOut(invoice, settings.currency) : null, charge: charge && { status: charge.status, message: charge.message || null } })
})
