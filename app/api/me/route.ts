import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { permissionsFor, ROLES } from '@/lib/permissions'
import { isDemoOwner } from '@/lib/demo'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// Everything the app shell needs about the signed-in user, in one request.
export const GET = handler({ permission: null }, async ({ ownerId, actor }) => {
  const [settings, profile, locations, owner, unread] = await Promise.all([
    getGymSettings(ownerId),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { logoUrl: true } }),
    prisma.location.findMany({ where: { ownerId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    prisma.owner.findUnique({ where: { id: ownerId }, select: { email: true } }),
    prisma.notification.count({ where: { ownerId, readAt: null, OR: [{ staffId: null }, ...(actor.type === 'staff' ? [{ staffId: actor.id }] : [])] } }),
  ])
  return {
    user: {
      type: actor.type,
      id: actor.id,
      name: actor.type === 'owner' ? owner?.email?.split('@')[0] || 'Owner' : actor.name,
      email: actor.type === 'owner' ? owner?.email : actor.email,
      role: actor.role,
      roleLabel: ROLES[actor.role].label,
    },
    permissions: permissionsFor(actor.role),
    gym: { name: settings.name, logoUrl: profile?.logoUrl || null, timezone: settings.timezone, currency: settings.currency },
    locations,
    isDemo: isDemoOwner(ownerId),
    unreadNotifications: unread,
  }
})
