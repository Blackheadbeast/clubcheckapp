import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export const DAY = 86_400_000
export const HOUR = 3_600_000

/** A fresh, verified, subscribed gym so every test is isolated from the others. */
export async function createGym(overrides: Record<string, unknown> = {}) {
  const id = randomUUID()
  await prisma.owner.create({
    data: {
      id,
      email: `owner-${id}@test.local`,
      password: 'x',
      emailVerified: new Date(),
      subscriptionStatus: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      planType: 'pro',
      gymProfile: { create: { name: 'Test Gym', timezone: 'America/New_York', ...overrides } },
    },
  })
  return id
}

export async function destroyGym(ownerId: string) {
  await prisma.owner.delete({ where: { id: ownerId } }).catch(() => {})
}

let n = 0
export async function createMember(ownerId: string, data: Record<string, unknown> = {}) {
  n++
  return prisma.member.create({
    data: { ownerId, name: `Member ${n}`, email: `m${n}-${randomUUID()}@test.local`, qrCode: `clubcheck-member-${randomUUID()}`, status: 'active', ...data },
  })
}

export async function createPlan(ownerId: string, data: Record<string, unknown> = {}) {
  return prisma.membershipPlan.create({ data: { ownerId, name: 'Unlimited', type: 'recurring', priceCents: 15000, ...data } })
}

export async function createSession(ownerId: string, data: Record<string, unknown> = {}) {
  const classType = await prisma.classType.create({ data: { ownerId, name: 'CrossFit' } })
  const startsAt = (data.startsAt as Date) || new Date(Date.now() + 2 * DAY)
  return prisma.classSession.create({
    data: { ownerId, classTypeId: classType.id, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), capacity: 2, waitlistCapacity: 2, ...data },
    include: { classType: true },
  })
}

/** Run a service function in a transaction, as the API routes do. */
export function tx<T>(fn: (db: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) {
  return prisma.$transaction(fn, { timeout: 20_000 })
}
