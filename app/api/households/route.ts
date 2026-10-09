import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertAllOwned, assertOwned, handler } from '@/lib/api'
import { createHousehold } from '@/lib/services/households'

export const dynamic = 'force-dynamic'

// GET /api/households?search= - households at this gym, with who pays
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, query }) => {
  const search = (query.get('search') || '').trim()
  const households = await prisma.household.findMany({
    where: { ownerId, ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { members: { some: { name: { contains: search, mode: 'insensitive' } } } }] }) },
    orderBy: { name: 'asc' }, take: 100,
    select: { id: true, name: true, payerMemberId: true, members: { select: { id: true, name: true }, orderBy: { name: 'asc' } } },
  })
  return households.map((h) => ({ id: h.id, name: h.name, payer: h.members.find((m) => m.id === h.payerMemberId) || null, members: h.members }))
})

const schema = z.object({
  name: z.string().trim().max(80).nullish(),
  payerMemberId: z.string().uuid(),
  memberIds: z.array(z.string().uuid()).max(19).optional(),
})

// POST - bill some members together, with one of them paying
export const POST = handler({ permission: 'billing.households', write: true, body: schema }, async ({ ownerId, body, actor, audit }) => {
  await assertOwned(ownerId, 'member', body.payerMemberId, 'Member')
  await assertAllOwned(ownerId, 'member', body.memberIds, 'Member')
  const result = await prisma.$transaction((db) => createHousehold(db, { ownerId, ...body, actor }), { timeout: 15_000 })
  await audit('household.create', `Created the ${result.household.name}, paid by ${result.payer.name}`, {
    entityType: 'household', entityId: result.household.id, after: { payer: result.payer.name, members: result.members.map((m) => m.name) },
    metadata: { payerMemberId: result.payer.id, memberIds: result.members.map((m) => m.id) },
  })
  return { id: result.household.id, name: result.household.name }
})
