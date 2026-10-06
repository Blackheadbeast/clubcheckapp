// Member directory queries and member creation.

import { randomBytes, randomUUID } from 'crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { memberStatusValues } from '@/lib/format'
import { optionalText } from '@/lib/schemas'
import { Db, ActorRef, logActivity } from './core'
import { LIVE_STATUSES } from './memberships'

export const memberFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  phone: optionalText(30),
  photoUrl: z.string().trim().url('Photo must be a valid URL').max(1000).nullish().or(z.literal('').transform(() => null)),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullish().or(z.literal('').transform(() => null)),
  addressLine1: optionalText(200),
  city: optionalText(100),
  state: optionalText(50),
  postalCode: optionalText(20),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(30),
  goals: optionalText(2000),
  medicalNotes: optionalText(2000),
  leadSource: optionalText(100),
  emailOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
  homeLocationId: z.string().uuid().nullish(),
  assignedStaffId: z.string().uuid().nullish(),
})

export type MemberFields = z.infer<typeof memberFieldsSchema>

/** Translate validated form fields into Prisma column values. */
export function memberData(fields: Partial<MemberFields>) {
  const { dateOfBirth, ...rest } = fields
  return {
    ...rest,
    ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null }),
  }
}

/** Build the directory filter from query parameters. Shared by the list and the CSV export. */
export function memberWhere(ownerId: string, query: URLSearchParams): Prisma.MemberWhereInput {
  const and: Prisma.MemberWhereInput[] = []
  const status = query.get('status')
  const where: Prisma.MemberWhereInput = { ownerId, archivedAt: status === 'archived' ? { not: null } : null }
  if (status && status !== 'archived' && status !== 'all') where.status = { in: memberStatusValues(status) }

  const search = (query.get('search') || '').trim()
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    })
  }
  const planId = query.get('planId')
  if (planId === 'none') and.push({ memberships: { none: { status: { in: LIVE_STATUSES } } } })
  else if (planId) and.push({ memberships: { some: { planId, status: { in: LIVE_STATUSES } } } })

  const tagId = query.get('tagId')
  if (tagId) and.push({ tags: { some: { tagId } } })
  const locationId = query.get('locationId')
  if (locationId) where.homeLocationId = locationId
  const coachId = query.get('coachId')
  if (coachId) where.assignedStaffId = coachId

  const payment = query.get('payment')
  if (payment === 'balance') and.push({ invoices: { some: { status: 'open' } } })
  if (payment === 'overdue') and.push({ invoices: { some: { status: 'open', dueDate: { lt: new Date() } } } })

  const attendance = query.get('attendance')
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000)
  if (attendance === 'week') where.lastCheckInAt = { gte: ago(7) }
  if (attendance === 'inactive14') and.push({ OR: [{ lastCheckInAt: { lt: ago(14) } }, { lastCheckInAt: null }] })
  if (attendance === 'inactive30') and.push({ OR: [{ lastCheckInAt: { lt: ago(30) } }, { lastCheckInAt: null }] })
  if (attendance === 'never') where.lastCheckInAt = null

  const from = query.get('joinedFrom')
  const to = query.get('joinedTo')
  if (from || to) {
    where.createdAt = {
      ...(from && !Number.isNaN(Date.parse(from)) && { gte: new Date(from) }),
      ...(to && !Number.isNaN(Date.parse(to)) && { lt: new Date(new Date(to).getTime() + 86_400_000) }),
    }
  }
  if (and.length) where.AND = and
  return where
}

const SORTS = ['name', 'email', 'status', 'createdAt', 'lastCheckInAt'] as const

export function memberOrder(query: URLSearchParams): Prisma.MemberOrderByWithRelationInput[] {
  const sort = SORTS.find((s) => s === query.get('sort')) || 'createdAt'
  const order = query.get('order') === 'asc' ? 'asc' : 'desc'
  if (sort === 'lastCheckInAt') return [{ lastCheckInAt: { sort: order, nulls: 'last' } }, { id: 'asc' }]
  return [{ [sort]: order }, { id: 'asc' }]
}

export function newQrCode() {
  return `clubcheck-member-${randomUUID()}`
}

export function newAccessToken() {
  return { accessToken: randomBytes(32).toString('hex'), accessTokenExpiry: new Date(Date.now() + 365 * 86_400_000) }
}

export async function createMember(db: Db, ownerId: string, fields: Pick<MemberFields, 'name' | 'email'> & Partial<MemberFields>, actor?: ActorRef, extra: { status?: string } = {}) {
  const member = await db.member.create({
    data: { ownerId, qrCode: newQrCode(), ...newAccessToken(), status: extra.status || 'active', ...memberData(fields), name: fields.name, email: fields.email },
  })
  await logActivity(db, { ownerId, memberId: member.id, type: 'joined', title: 'Joined', detail: fields.leadSource ? `Source: ${fields.leadSource}` : undefined, actor })
  return member
}

/** Open-invoice balance per member, for a page of the directory. */
export async function balancesFor(ownerId: string, memberIds: string[]) {
  if (memberIds.length === 0) return new Map<string, number>()
  const rows = await prisma.invoice.groupBy({
    by: ['memberId'],
    where: { ownerId, status: 'open', memberId: { in: memberIds } },
    _sum: { totalCents: true, amountPaidCents: true },
  })
  return new Map(rows.map((r) => [r.memberId!, (r._sum.totalCents || 0) - (r._sum.amountPaidCents || 0)]))
}
