import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { resolveRange } from '@/lib/dates'
import { isDemoOwner } from '@/lib/demo'
import { getOwnerFromCookie } from '@/lib/auth'
import { getGymSettings } from '@/lib/services/core'
import { dashboard } from '@/lib/services/reports'
import { effectiveLocation } from '@/lib/services/today'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/dashboard?range=30d&from=&to=&locationId=
export const GET = handler({ permission: null }, async ({ ownerId, query, can, actor }) => {
  await assertOwned(ownerId, 'location', query.get('locationId'), 'Location')
  const { locationId } = await effectiveLocation(ownerId, actor, query.get('locationId'))
  const settings = await getGymSettings(ownerId)
  const range = resolveRange(query.get('range'), query.get('from'), query.get('to'), settings.timezone)
  const [data, profile, totals] = await Promise.all([
    dashboard({ ownerId, range, tz: settings.timezone, locationId, financial: can('reports.financial'), leads: can('leads.view') }),
    prisma.gymProfile.findUnique({ where: { ownerId }, select: { name: true, kioskPinHash: true, setupDismissedAt: true } }),
    Promise.all([prisma.member.count({ where: { ownerId } }), prisma.checkin.count({ where: { ownerId } }), prisma.membershipPlan.count({ where: { ownerId } }), prisma.classType.count({ where: { ownerId } })]),
  ])
  return {
    ...data,
    staffActivity: can('audit.view') ? data.staffActivity : null,
    setup: {
      gymName: !!profile?.name,
      firstMember: totals[0] > 0,
      membershipPlan: totals[2] > 0,
      firstClass: totals[3] > 0,
      kioskPin: !!profile?.kioskPinHash,
      firstCheckin: totals[1] > 0,
      dismissed: !!profile?.setupDismissedAt || isDemoOwner(ownerId),
    },
  }
})

// PATCH - dismiss the setup checklist
export async function PATCH(request: NextRequest) {
  const owner = await getOwnerFromCookie()
  if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (body.action !== 'dismiss-setup') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  await prisma.gymProfile.upsert({ where: { ownerId: owner.ownerId }, create: { ownerId: owner.ownerId, setupDismissedAt: new Date() }, update: { setupDismissedAt: new Date() } })
  return NextResponse.json({ data: { success: true } })
}
