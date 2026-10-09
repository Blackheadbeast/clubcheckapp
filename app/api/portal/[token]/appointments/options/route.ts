import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'
import { formatMoney } from '@/lib/format'
import { getGymSettings } from '@/lib/services/core'
import { getConnectStatus } from '@/lib/payments/stripe-connect'
import { appointmentTypeAccess } from '@/lib/services/appointments'

export const dynamic = 'force-dynamic'

// GET - what this member can book: appointment types, who offers them, where, what each costs
// them, how many sessions they have left, and which packages they could buy
export const GET = portalHandler({}, async ({ member, ownerId }) => {
  const now = new Date()
  const [types, memberships, plans, locations, settings, connect, hasMethod] = await Promise.all([
    prisma.appointmentType.findMany({ where: { ownerId, isActive: true, memberBookable: true }, orderBy: { name: 'asc' }, include: { staff: { select: { staff: { select: { id: true, name: true, title: true, bio: true, active: true } } } } } }),
    prisma.membership.findMany({ where: { ownerId, memberId: member.id, status: { in: ['active', 'trial'] }, OR: [{ endDate: null }, { endDate: { gte: now } }] }, include: { plan: { select: { id: true, name: true, type: true } } } }),
    prisma.membershipPlan.findMany({ where: { ownerId, isActive: true, isPublic: true, type: 'pt_package' }, orderBy: { priceCents: 'asc' }, select: { id: true, name: true, description: true, priceCents: true, credits: true, expiresAfterDays: true } }),
    prisma.location.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    getGymSettings(ownerId),
    getConnectStatus(ownerId),
    prisma.paymentMethod.count({ where: { ownerId, memberId: member.id } }),
  ])
  const money = (c: number) => formatMoney(c, settings.currency)
  const canBuyOnline = connect.chargesEnabled && hasMethod > 0

  return {
    canBuyOnline,
    canPayOnline: connect.chargesEnabled,
    locations,
    types: types.filter((t) => t.staff.some((s) => s.staff.active)).map((t) => {
      const { credits, blocked } = appointmentTypeAccess(t, memberships)
      const packages = t.paymentMode === 'credit' ? plans.filter((p) => t.requiredPlanIds.length === 0 || t.requiredPlanIds.includes(p.id)) : []
      return {
        id: t.id, name: t.name, description: t.description, color: t.color, durationMin: t.durationMin, paymentMode: t.paymentMode,
        priceLabel: t.paymentMode === 'paid' ? money(t.priceCents) : t.paymentMode === 'credit' ? `${t.creditsRequired} session${t.creditsRequired === 1 ? '' : 's'}` : 'Included',
        creditsRequired: t.paymentMode === 'credit' ? t.creditsRequired : 0,
        creditsAvailable: credits,
        cancelWindowHours: t.cancelWindowHours, maxAdvanceDays: t.maxAdvanceDays, canReschedule: t.memberReschedule,
        locationIds: t.locationIds,
        coaches: t.staff.map((s) => s.staff).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, title: s.title, bio: s.bio })),
        // Why they cannot book yet, and what would fix it.
        blocked,
        packages: packages.map((p) => ({ id: p.id, name: p.name, description: p.description, priceLabel: money(p.priceCents), priceCents: p.priceCents, sessions: p.credits, expiresAfterDays: p.expiresAfterDays })),
      }
    }),
    // Session packages the member holds, for "9 sessions remaining".
    packages: memberships.filter((m) => m.plan.type === 'pt_package').map((m) => ({ id: m.id, name: m.plan.name, sessionsRemaining: m.creditsRemaining ?? 0, expiresAt: m.endDate })),
  }
})
