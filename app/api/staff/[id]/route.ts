import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, handler, notFound } from '@/lib/api'
import { ROLES } from '@/lib/permissions'
import { staffSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const PATCH = handler({ permission: 'staff.manage', write: true, body: staffSchema.partial() }, async ({ ownerId, params, body, actor, audit }) => {
  const before = await prisma.staff.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Staff member')
  // Nobody locks themselves out or quietly changes their own access.
  if (actor.type === 'staff' && actor.id === before.id && (body.active === false || (body.role && body.role !== before.role))) {
    throw new ApiError(403, "You can't change your own role or deactivate yourself.", 'self_change')
  }
  await assertOwned(ownerId, 'location', body.locationId, 'Location')
  if (body.email && body.email !== before.email) {
    const clash = await prisma.staff.findFirst({ where: { ownerId, email: body.email, id: { not: before.id } } })
    if (clash) throw new ApiError(409, 'A staff member with this email already exists.', 'duplicate_email')
  }
  const { password, ...rest } = body
  const staff = await prisma.staff.update({
    where: { id: before.id },
    data: { ...rest, ...(password && { password: await bcrypt.hash(password, 10) }) },
    select: { id: true, name: true, role: true, active: true },
  })
  const changes = [
    body.role && body.role !== before.role && `role ${ROLES[before.role as keyof typeof ROLES]?.label || before.role} → ${ROLES[staff.role as keyof typeof ROLES].label}`,
    body.active !== undefined && body.active !== before.active && (staff.active ? 'reactivated' : 'deactivated'),
    password && 'password reset',
  ].filter(Boolean)
  await audit('staff_update', `Updated ${staff.name}${changes.length ? `: ${changes.join(', ')}` : ''}`, {
    entityType: 'staff', entityId: staff.id, before: { role: before.role, active: before.active }, after: { role: staff.role, active: staff.active },
  })
  return staff
})

export const DELETE = handler({ permission: 'staff.manage', write: true }, async ({ ownerId, params, actor, audit }) => {
  const staff = await prisma.staff.findFirst({ where: { id: params.id, ownerId } })
  if (!staff) throw notFound('Staff member')
  if (actor.type === 'staff' && actor.id === staff.id) throw new ApiError(403, "You can't delete your own account.", 'self_change')
  await prisma.staff.delete({ where: { id: staff.id } })
  await audit('staff_delete', `Removed ${staff.name}`, { entityType: 'staff', entityId: staff.id })
  return { deleted: true }
})
