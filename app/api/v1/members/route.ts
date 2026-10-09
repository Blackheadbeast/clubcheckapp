import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Created, Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { memberOut, memberStatusValues } from '@/lib/public-api/serialize'
import { addMember, memberFieldsSchema } from '@/lib/services/members'

export const dynamic = 'force-dynamic'

const STATUSES = ['active', 'trial', 'past_due', 'frozen', 'cancelled', 'inactive'] as const

// GET /api/v1/members?updatedSince=&createdSince=&status=&locationId=&email=&search=&archived=
export const GET = publicHandler({ scope: 'members:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const updatedSince = dateParam(query, 'updatedSince')
  const createdSince = dateParam(query, 'createdSince')
  const status = oneOf(query, 'status', STATUSES)
  const archived = oneOf(query, 'archived', ['true', 'false', 'all'] as const) || 'false'
  const search = (query.get('search') || '').trim().slice(0, 100)
  const where: Prisma.MemberWhereInput = {
    ownerId,
    ...(archived === 'true' ? { archivedAt: { not: null } } : archived === 'false' ? { archivedAt: null } : {}),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
    ...(createdSince && { createdAt: { gte: createdSince } }),
    ...(status && { status: { in: memberStatusValues(status) } }),
    ...(query.get('locationId') && { homeLocationId: query.get('locationId')! }),
    ...(query.get('email') && { email: query.get('email')!.trim().toLowerCase() }),
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] }),
  }
  // Oldest change first when syncing, so a caller can walk forward and never miss a row.
  const orderBy: Prisma.MemberOrderByWithRelationInput[] = updatedSince ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }]
  const [rows, total] = await Promise.all([prisma.member.findMany({ where, orderBy, skip, take }), prisma.member.count({ where })])
  return new Page(rows.map(memberOut), total, page, pageSize)
})

// POST /api/v1/members
export const POST = publicHandler({ scope: 'members:write', write: true, body: memberFieldsSchema, idempotent: true }, async ({ ownerId, body, actor, audit }) => {
  // Outside software decides for itself whether to welcome someone; the gym's own welcome email is not sent on its behalf.
  const { member } = await addMember(ownerId, body, actor, { welcomeEmail: false })
  await audit('member.create', `Added member ${member.name} through the API`, { entityType: 'member', entityId: member.id })
  return new Created(memberOut(await prisma.member.findUniqueOrThrow({ where: { id: member.id } })))
})
