import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { appOrigin } from '@/lib/member-auth-http'
import { getGymSettings } from '@/lib/services/core'
import { getBookingSite, saveBookingSite, siteSchema } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET /api/settings/online-booking - the gym's public booking settings, and what there is to make public
export const GET = handler({ permission: 'settings.manage' }, async ({ ownerId, req }) => {
  const [site, settings, profile, locations, classTypes, appointmentTypes] = await Promise.all([
    getBookingSite(ownerId),
    getGymSettings(ownerId),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { logoUrl: true } }),
    prisma.location.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.classType.findMany({ where: { ownerId, isActive: true, category: { not: 'personal_training' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, category: true } }),
    prisma.appointmentType.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, durationMin: true, paymentMode: true, memberBookable: true } }),
  ])
  const { id: _id, ownerId: _owner, createdAt: _c, updatedAt: _u, ...fields } = site
  return {
    site: fields,
    origin: appOrigin(req),
    business: { name: settings.name, logoUrl: profile?.logoUrl || null, bookingWindowDays: settings.bookingWindowDays, cancelWindowHours: settings.cancelWindowHours },
    locations, classTypes, appointmentTypes,
  }
})

// PUT - save them
export const PUT = handler({ permission: 'settings.manage', write: true, body: siteSchema }, async ({ ownerId, body, audit }) => {
  const before = await getBookingSite(ownerId)
  const site = await saveBookingSite(ownerId, body)
  await audit('online_booking.update', before.enabled !== site.enabled ? `Turned online booking ${site.enabled ? 'on' : 'off'}` : 'Updated online booking settings', { entityType: 'booking_site', entityId: site.id, before: { enabled: before.enabled, slug: before.slug }, after: { enabled: site.enabled, slug: site.slug } })
  return { slug: site.slug, enabled: site.enabled }
})
