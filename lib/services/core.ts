// Shared building blocks for the domain services.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TZ, isValidTimeZone } from '@/lib/dates'
import type { Actor } from '@/lib/api'

/** Either the root client or an interactive transaction. */
export type Db = Prisma.TransactionClient

export type ActorRef = Pick<Actor, 'type' | 'id' | 'name'> | { type: 'member' | 'system'; id?: string; name?: string }

export const SYSTEM: ActorRef = { type: 'system', name: 'System' }

export interface GymSettings {
  ownerId: string
  name: string
  timezone: string
  currency: string
  defaultTaxRateBps: number
  bookingWindowDays: number
  bookingCutoffMinutes: number
  cancelWindowHours: number
  waitlistOfferMinutes: number
  lateCancelUsesCredit: boolean
  pastDueGraceDays: number
}

export async function getGymSettings(ownerId: string, db: Db = prisma): Promise<GymSettings> {
  const profile = await db.gymProfile.findUnique({ where: { ownerId } })
  const timezone = profile?.timezone && isValidTimeZone(profile.timezone) ? profile.timezone : DEFAULT_TZ
  return {
    ownerId,
    name: profile?.name || 'Your Gym',
    timezone,
    currency: profile?.currency || 'usd',
    defaultTaxRateBps: profile?.defaultTaxRateBps ?? 0,
    bookingWindowDays: profile?.bookingWindowDays ?? 14,
    bookingCutoffMinutes: profile?.bookingCutoffMinutes ?? 0,
    cancelWindowHours: profile?.cancelWindowHours ?? 2,
    waitlistOfferMinutes: profile?.waitlistOfferMinutes ?? 30,
    lateCancelUsesCredit: profile?.lateCancelUsesCredit ?? true,
    pastDueGraceDays: profile?.pastDueGraceDays ?? 7,
  }
}

/** Atomically allocate the next invoice/order number for an account. */
export async function nextNumber(db: Db, ownerId: string, kind: 'invoice' | 'order'): Promise<string> {
  const field = kind === 'invoice' ? 'invoiceSequence' : 'orderSequence'
  const profile = await db.gymProfile.upsert({
    where: { ownerId },
    create: { ownerId, [field]: 1 },
    update: { [field]: { increment: 1 } },
    select: { invoiceSequence: true, orderSequence: true },
  })
  const n = kind === 'invoice' ? profile.invoiceSequence : profile.orderSequence
  return `${kind === 'invoice' ? 'INV' : 'ORD'}-${String(n).padStart(5, '0')}`
}

export interface ActivityInput {
  ownerId: string
  memberId?: string | null
  prospectId?: string | null
  type: string
  title: string
  detail?: string | null
  metadata?: Record<string, unknown>
  actor?: ActorRef
  createdAt?: Date
}

/** Append an entry to a member's or lead's timeline. */
export async function logActivity(db: Db, input: ActivityInput) {
  const actor = input.actor || SYSTEM
  await db.activity.create({
    data: {
      ownerId: input.ownerId,
      memberId: input.memberId || null,
      prospectId: input.prospectId || null,
      type: input.type,
      title: input.title,
      detail: input.detail || null,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      actorType: actor.type,
      actorId: actor.id || null,
      actorName: actor.name || null,
      ...(input.createdAt && { createdAt: input.createdAt }),
    },
  })
}

export async function notify(
  db: Db,
  input: { ownerId: string; type: string; title: string; body?: string; href?: string; staffId?: string | null }
) {
  await db.notification.create({ data: input })
}

/** Lock a row for the rest of the transaction so concurrent requests serialize on it. */
export async function lockRow(db: Db, table: 'ClassSession' | 'Product' | 'Member' | 'Invoice' | 'Transaction' | 'Membership', id: string) {
  await db.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id)
}
