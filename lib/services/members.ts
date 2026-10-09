// Member directory queries and member creation.

import { randomBytes, randomUUID } from 'crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, badRequest, notFound } from '@/lib/api'
import { checkMemberLimit } from '@/lib/billing'
import { memberStatusValues } from '@/lib/format'
import { optionalText } from '@/lib/schemas'
import { Db, ActorRef, logActivity } from './core'
import { memberEvent } from './events'
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
  // SMS consent is not an ordinary field: it is changed through setSmsConsent so every change is recorded.
  const { dateOfBirth, smsOptIn: _consent, ...rest } = fields
  return {
    ...rest,
    ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null }),
  }
}

/** Build the directory filter from query parameters. Shared by the list and the CSV export. */
export function memberWhere(ownerId: string, query: URLSearchParams, home?: Prisma.MemberWhereInput): Prisma.MemberWhereInput {
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
  // The caller passes the location rule for the person asking (see homeScope); the raw parameter is only a fallback.
  const locationId = query.get('locationId')
  if (home) and.push(home)
  else if (locationId) where.homeLocationId = locationId
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
  await memberEvent(db, ownerId, 'member.created', member.id)
  // Anything the gym requires of every new member is given to them now; they are told how to sign it once this is saved.
  const { assignSignupDocuments } = await import('./documents')
  await assignSignupDocuments(db, ownerId, member.id, actor)
  if (fields.smsOptIn) {
    const { setSmsConsent } = await import('./sms')
    await setSmsConsent(db, { ownerId, memberId: member.id, scope: 'operational', optedIn: true, source: 'staff', method: 'Recorded when the member was added', actorName: actor?.name })
    return { ...member, smsOptIn: true }
  }
  return member
}

/**
 * Add a member the way the directory does: the plan's member limit, ownership of anything named,
 * one live member per email address, then the welcome email. Used by the staff app and the public API.
 */
export async function addMember(ownerId: string, fields: MemberFields, actor?: ActorRef, opts: { welcomeEmail?: boolean } = {}) {
  const limit = await checkMemberLimit(ownerId)
  if (!limit.allowed) throw new ApiError(403, limit.error, 'member_limit')
  await assertOwned(ownerId, 'location', fields.homeLocationId, 'Location')
  await assertOwned(ownerId, 'staff', fields.assignedStaffId, 'Coach')
  const duplicate = await prisma.member.findFirst({ where: { ownerId, email: fields.email, archivedAt: null }, select: { id: true, name: true } })
  if (duplicate) throw new ApiError(409, `${duplicate.name} already uses that email address.`, 'duplicate_email', { memberId: duplicate.id })
  const member = await prisma.$transaction((db) => createMember(db, ownerId, fields, actor))
  await import('./documents').then((d) => d.emailNewDocuments(ownerId, member.id)).catch(() => {})

  // Welcome email with their QR code. Delivery problems never fail the request.
  let emailSent = false
  if (opts.welcomeEmail !== false) {
    try {
      const QRCode = (await import('qrcode')).default
      const qrCodeUrl = await QRCode.toDataURL(member.qrCode, { width: 300, margin: 2 })
      const { sendMemberWelcomeEmail } = await import('@/lib/email')
      emailSent = (await sendMemberWelcomeEmail(member.email, member.name, qrCodeUrl, member.accessToken || undefined)).success
    } catch (error) {
      console.error('Welcome email failed:', error)
    }
  }
  return { member, emailSent }
}

export const memberUpdateSchema = memberFieldsSchema.partial().extend({
  status: z.enum(['active', 'trial', 'past_due', 'frozen', 'cancelled', 'inactive']).optional(),
  archived: z.boolean().optional(),
})

/** Edit a member's profile, set a status by hand (only for someone with no membership), archive or restore. */
export async function updateMember(ownerId: string, id: string, input: z.infer<typeof memberUpdateSchema>, opts: { actor?: ActorRef; mayArchive: boolean }) {
  const before = await prisma.member.findFirst({ where: { id, ownerId }, include: { _count: { select: { memberships: true } } } })
  if (!before) throw notFound('Member')
  const { status, archived, ...fields } = input
  if (archived !== undefined && !opts.mayArchive) throw new ApiError(403, 'You do not have permission to archive members.', 'forbidden')
  if (status && before._count.memberships > 0) {
    throw badRequest("This member's status follows their membership. Freeze or cancel the membership instead.", 'status_derived')
  }
  await assertOwned(ownerId, 'location', fields.homeLocationId, 'Location')
  await assertOwned(ownerId, 'staff', fields.assignedStaffId, 'Coach')
  if (fields.email && fields.email !== before.email) {
    const clash = await prisma.member.findFirst({ where: { ownerId, email: fields.email, archivedAt: null, id: { not: before.id } }, select: { name: true } })
    if (clash) throw new ApiError(409, `${clash.name} already uses that email address.`, 'duplicate_email')
  }

  const member = await prisma.$transaction(async (db) => {
    await db.member.update({
      where: { id: before.id },
      data: {
        ...memberData(fields),
        ...(status && { status }),
        ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
      },
    })
    if (fields.smsOptIn !== undefined && fields.smsOptIn !== before.smsOptIn) {
      // Recorded with who changed it. Opting someone back in after they replied STOP is refused.
      const { setSmsConsent } = await import('./sms')
      await setSmsConsent(db, { ownerId, memberId: before.id, scope: 'operational', optedIn: fields.smsOptIn, source: 'staff', method: 'Changed on the member profile', actorName: opts.actor?.name })
    }
    if (status && status !== before.status) {
      await logActivity(db, { ownerId, memberId: before.id, type: 'status_changed', title: `Status changed to ${status.replace('_', ' ')}`, actor: opts.actor })
    }
    const archiving = archived !== undefined && !!before.archivedAt !== archived
    if (archiving) {
      await logActivity(db, { ownerId, memberId: before.id, type: archived ? 'archived' : 'restored', title: archived ? 'Archived' : 'Restored from archive', actor: opts.actor })
    }
    // One event for the request: archived if that is what it did, otherwise updated.
    await memberEvent(db, ownerId, archiving && archived ? 'member.archived' : 'member.updated', before.id)
    return db.member.findUniqueOrThrow({ where: { id: before.id } })
  })
  const changed = Object.keys(fields).filter((k) => String((before as any)[k] ?? '') !== String((member as any)[k] ?? ''))
  return { before, member, changed, archived }
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
