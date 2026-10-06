// Audience segments for campaigns and bulk messages.

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { memberStatusValues } from '@/lib/format'

export const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all_members') }),
  z.object({ type: z.literal('status'), status: z.enum(['active', 'trial', 'past_due', 'frozen', 'cancelled', 'inactive']) }),
  z.object({ type: z.literal('plan'), planId: z.string().uuid() }),
  z.object({ type: z.literal('tag'), tagId: z.string().uuid() }),
  z.object({ type: z.literal('class_type'), classTypeId: z.string().uuid() }),
  z.object({ type: z.literal('coach'), staffId: z.string().uuid() }),
  z.object({ type: z.literal('inactive'), days: z.number().int().min(1).max(365) }),
  z.object({ type: z.literal('members'), ids: z.array(z.string().uuid()).min(1).max(1000) }),
  z.object({ type: z.literal('leads'), stage: z.string().optional() }),
])

export type Audience = z.infer<typeof audienceSchema>

export function describeAudience(audience: Audience): string {
  switch (audience.type) {
    case 'all_members': return 'All members'
    case 'status': return `${audience.status.replace('_', ' ')} members`
    case 'plan': return 'Members on a membership plan'
    case 'tag': return 'Members with a tag'
    case 'class_type': return 'Members who attend a class'
    case 'coach': return "A coach's members"
    case 'inactive': return `No visit in ${audience.days}+ days`
    case 'members': return `${audience.ids.length} selected member${audience.ids.length === 1 ? '' : 's'}`
    case 'leads': return audience.stage ? `Leads: ${audience.stage.replace('_', ' ')}` : 'All open leads'
  }
}

function memberWhere(ownerId: string, audience: Exclude<Audience, { type: 'leads' }>): Prisma.MemberWhereInput {
  const base: Prisma.MemberWhereInput = { ownerId, archivedAt: null }
  const since = (days: number) => new Date(Date.now() - days * 86_400_000)
  switch (audience.type) {
    case 'all_members': return base
    case 'status': return { ...base, status: { in: memberStatusValues(audience.status) } }
    case 'plan': return { ...base, memberships: { some: { planId: audience.planId, status: { in: ['active', 'trial', 'past_due', 'frozen'] } } } }
    case 'tag': return { ...base, tags: { some: { tagId: audience.tagId } } }
    case 'class_type':
      return { ...base, bookings: { some: { status: { in: ['booked', 'attended'] }, session: { classTypeId: audience.classTypeId, startsAt: { gte: since(60) } } } } }
    case 'coach':
      return {
        ...base,
        OR: [
          { assignedStaffId: audience.staffId },
          { bookings: { some: { status: { in: ['booked', 'attended'] }, session: { coachId: audience.staffId, startsAt: { gte: since(60) } } } } },
        ],
      }
    case 'inactive':
      return { ...base, status: { in: ['active', 'trial'] }, OR: [{ lastCheckInAt: { lt: since(audience.days) } }, { lastCheckInAt: null }] }
    case 'members': return { ...base, id: { in: audience.ids } }
  }
}

export async function resolveAudience(ownerId: string, audience: Audience) {
  if (audience.type === 'leads') {
    const prospects = await prisma.prospect.findMany({
      where: { ownerId, status: audience.stage ? audience.stage : { notIn: ['converted', 'lost'] } },
      select: { id: true },
      take: 5000,
    })
    return { memberIds: [] as string[], prospectIds: prospects.map((p) => p.id) }
  }
  const members = await prisma.member.findMany({ where: memberWhere(ownerId, audience), select: { id: true }, take: 5000 })
  return { memberIds: members.map((m) => m.id), prospectIds: [] as string[] }
}

export async function countAudience(ownerId: string, audience: Audience): Promise<number> {
  if (audience.type === 'leads') {
    return prisma.prospect.count({ where: { ownerId, status: audience.stage ? audience.stage : { notIn: ['converted', 'lost'] } } })
  }
  return prisma.member.count({ where: memberWhere(ownerId, audience) })
}
