import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

// Small reference lists for filters and form dropdowns, in one round trip.
export const GET = handler({ permission: null }, async ({ ownerId }) => {
  const [plans, tags, staff, locations, classTypes] = await Promise.all([
    prisma.membershipPlan.findMany({
      where: { ownerId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, type: true, priceCents: true, billingInterval: true, intervalCount: true, trialDays: true, enrollmentFeeCents: true, credits: true, contractMonths: true },
    }),
    prisma.tag.findMany({ where: { ownerId }, orderBy: { name: 'asc' }, select: { id: true, name: true, color: true } }),
    prisma.staff.findMany({ where: { ownerId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true, isCoach: true } }),
    prisma.location.findMany({ where: { ownerId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    prisma.classType.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, color: true, category: true, defaultDurationMin: true, defaultCapacity: true } }),
  ])
  return { plans, tags, staff, coaches: staff.filter((s) => s.isCoach || ['coach', 'trainer'].includes(s.role)), locations, classTypes }
})
