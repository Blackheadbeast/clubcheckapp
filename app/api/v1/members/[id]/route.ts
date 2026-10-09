import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { memberOut } from '@/lib/public-api/serialize'
import { memberUpdateSchema, updateMember } from '@/lib/services/members'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'members:read' }, async ({ ownerId, params }) => {
  const member = await prisma.member.findFirst({ where: { id: params.id, ownerId } })
  if (!member) throw notFound('Member')
  return memberOut(member)
})

// PATCH /api/v1/members/:id - change details; `archived: false` restores an archived member
export const PATCH = publicHandler({ scope: 'members:write', write: true, body: memberUpdateSchema }, async ({ ownerId, params, body, actor, audit }) => {
  const { member, changed, archived } = await updateMember(ownerId, params.id, body, { actor, mayArchive: true })
  await audit(archived !== undefined ? (archived ? 'member.archive' : 'member.restore') : 'member.update', `${archived !== undefined ? (archived ? 'Archived' : 'Restored') : 'Updated'} ${member.name} through the API${changed.length ? ` (${changed.join(', ')})` : ''}`, { entityType: 'member', entityId: member.id })
  return memberOut(member)
})

// DELETE /api/v1/members/:id - archive. Nothing is erased: history, invoices and payments stay.
export const DELETE = publicHandler({ scope: 'members:write', write: true }, async ({ ownerId, params, actor, audit }) => {
  const { member } = await updateMember(ownerId, params.id, { archived: true }, { actor, mayArchive: true })
  await audit('member.archive', `Archived ${member.name} through the API`, { entityType: 'member', entityId: member.id })
  return memberOut(member)
})
