import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { addHouseholdMember, dissolveHousehold, getHousehold, removeHouseholdMember, renameHousehold, setHouseholdPayer } from '@/lib/services/households'

export const dynamic = 'force-dynamic'

// GET /api/households/:id - members, what each is on, what is owed, invoices and payments. Billing only.
export const GET = handler({ permission: 'billing.view' }, async ({ ownerId, params, can }) => ({ ...(await getHousehold(ownerId, params.id)), canManage: can('billing.households') }))

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), memberId: z.string().uuid() }),
  z.object({ action: z.literal('remove'), memberId: z.string().uuid() }),
  z.object({ action: z.literal('payer'), memberId: z.string().uuid() }),
  z.object({ action: z.literal('rename'), name: z.string().trim().min(1, 'Give the household a name').max(80) }),
  z.object({ action: z.literal('dissolve') }),
])

// POST { action } - add or remove a member, choose who pays, rename, or stop billing them together
export const POST = handler({ permission: 'billing.households', write: true, body: schema }, async ({ ownerId, params, body, actor, audit }) => {
  if ('memberId' in body) await assertOwned(ownerId, 'member', body.memberId, 'Member')
  const householdId = params.id
  return prisma.$transaction(async (db) => {
    switch (body.action) {
      case 'add': {
        const r = await addHouseholdMember(db, { ownerId, householdId, memberId: body.memberId, actor })
        if (r.added) await audit('household.add_member', `Added ${r.member!.name} to the ${r.household.name}`, { entityType: 'household', entityId: householdId, metadata: { memberId: body.memberId, payerMemberId: r.household.payerMemberId } })
        return { added: r.added }
      }
      case 'remove': {
        const r = await removeHouseholdMember(db, { ownerId, householdId, memberId: body.memberId, actor })
        await audit('household.remove_member', `Removed ${r.member.name} from the ${r.household.name}${r.dissolved ? ' (household closed)' : ''}`, { entityType: 'household', entityId: householdId, metadata: { memberId: body.memberId, dissolved: r.dissolved } })
        return { removed: true, dissolved: r.dissolved }
      }
      case 'payer': {
        const r = await setHouseholdPayer(db, { ownerId, householdId, payerMemberId: body.memberId, actor })
        if (r.changed) await audit('household.change_payer', `Changed who pays for the ${r.household.name} to ${r.payer.name}`, { entityType: 'household', entityId: householdId, before: { payer: r.previous?.name || null }, after: { payer: r.payer.name }, metadata: { payerMemberId: r.payer.id, previousPayerMemberId: r.previous?.id || null } })
        return { changed: r.changed }
      }
      case 'rename':
        await renameHousehold(db, { ownerId, householdId, name: body.name })
        return { renamed: true }
      case 'dissolve': {
        const h = await dissolveHousehold(db, { ownerId, householdId, actor })
        await audit('household.dissolve', `Closed the ${h.name}`, { entityType: 'household', entityId: householdId, metadata: { memberIds: h.members.map((m) => m.id) } })
        return { dissolved: true }
      }
    }
  }, { timeout: 15_000 })
})
