import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, handler } from '@/lib/api'
import { ROLES } from '@/lib/permissions'
import { staffSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = handler({ permission: 'staff.manage' }, async ({ ownerId }) => {
  const [staff, owner] = await Promise.all([
    prisma.staff.findMany({
      where: { ownerId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, lastLoginAt: true, phone: true, title: true, bio: true, color: true, isCoach: true, locationId: true, location: { select: { name: true } } },
    }),
    prisma.owner.findUnique({ where: { id: ownerId }, select: { gymCode: true, email: true } }),
  ])
  const upcoming = await prisma.classSession.groupBy({ by: ['coachId'], where: { ownerId, status: 'scheduled', startsAt: { gte: new Date(), lt: new Date(Date.now() + 7 * 86_400_000) }, coachId: { not: null } }, _count: { _all: true } })
  return {
    staff: staff.map((s) => ({ ...s, roleLabel: ROLES[s.role as keyof typeof ROLES]?.label || s.role, classesThisWeek: upcoming.find((u) => u.coachId === s.id)?._count._all || 0 })),
    gymCode: owner?.gymCode || null,
    ownerEmail: owner?.email,
  }
})

export const POST = handler({ permission: 'staff.manage', write: true, body: staffSchema.required({ password: true }) }, async ({ ownerId, body, audit }) => {
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  const clash = await prisma.staff.findFirst({ where: { ownerId, email: body.email } })
  if (clash) throw new ApiError(409, 'A staff member with this email already exists.', 'duplicate_email')
  const { password, ...rest } = body
  const staff = await prisma.staff.create({ data: { ownerId, ...rest, password: await bcrypt.hash(password, 10) }, select: { id: true, name: true, role: true } })
  await audit('staff_create', `Added ${staff.name} as ${ROLES[staff.role as keyof typeof ROLES].label}`, { entityType: 'staff', entityId: staff.id })
  return staff
})
