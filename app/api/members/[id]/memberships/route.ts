import { emailNewDocuments, requireDocuments } from '@/lib/services/documents'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { dateInput } from '@/lib/schemas'
import { sellMembership } from '@/lib/services/memberships'
import { collectInvoice } from '@/lib/services/collections'
import { flushOutbox } from '@/lib/services/automations'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'

const sellSchema = z.object({
  planId: z.string().uuid(),
  startDate: dateInput.optional(),
  paymentMethod: z.enum(['card', 'cash', 'check', 'ach', 'other']),
  discountPercent: z.number().int().min(0).max(100).optional(),
  couponCode: z.string().trim().max(40).optional(),
  collectNow: z.boolean().optional(),
  skipTrial: z.boolean().optional(),
  locationId: z.string().uuid().nullish(),
  // Who gets the commission, if not the person making the sale
  soldByStaffIds: z.array(z.string().uuid()).max(5).optional(),
})

// POST /api/members/:id/memberships - sell a membership, pack or drop-in
export const POST = handler({ permission: 'memberships.manage', write: true, body: sellSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const result = await prisma.$transaction((db) => sellMembership(db, { ownerId, memberId: params.id, ...body, actor }), { timeout: 15_000 })
  await audit('membership.sell', `Sold ${result.plan.name}${result.invoice ? ` (${formatMoney(result.invoice.totalCents)})` : ''}`, {
    entityType: 'membership',
    entityId: result.membership.id,
    metadata: { memberId: params.id, planId: result.plan.id, invoiceId: result.invoice?.id },
  })
  // The sale is committed; now charge the saved card or bank account if that is how they are paying.
  let charge = null
  if (body.collectNow && result.invoice?.status === 'open' && (body.paymentMethod === 'card' || body.paymentMethod === 'ach')) {
    charge = await collectInvoice({ ownerId, invoiceId: result.invoice.id, actor }).catch((error) => ({ status: 'failed' as const, message: error instanceof Error ? error.message : 'The charge could not be attempted.' }))
  }
  // The agreement for this plan is sent to the member to sign. A sale at the desk is not held up for it.
  const documents = await requireDocuments(ownerId, params.id, { trigger: 'membership_purchase', planId: result.plan.id }, { enforce: false }).catch(() => [])
  if (documents.length) await emailNewDocuments(ownerId, params.id).catch(() => {})
  await flushOutbox(ownerId)
  const invoice = result.invoice && (await prisma.invoice.findUnique({ where: { id: result.invoice.id }, select: { id: true, number: true, status: true, totalCents: true } }))
  return { membershipId: result.membership.id, status: result.membership.status, invoice, charge: charge && { status: charge.status, message: charge.message || null }, documentsToSign: documents.map((d) => ({ id: d.id, name: d.name })) }
})
