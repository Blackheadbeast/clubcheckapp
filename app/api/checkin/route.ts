import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, Paginated, assertOwned, handler, notFound, paging } from '@/lib/api'
import { resolveRange } from '@/lib/dates'
import { checkInMember, findMembers, memberCard } from '@/lib/services/checkin'
import { getGymSettings } from '@/lib/services/core'
import { CHECKIN_RATE_LIMIT } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const checkinSchema = z
  .object({
    memberId: z.string().uuid().optional(),
    qrCode: z.string().trim().max(200).optional(),
    phoneNumber: z.string().trim().max(40).optional(),
    source: z.enum(['qr', 'phone', 'kiosk', 'manual', 'search', 'barcode']).optional(),
    deviceName: z.string().trim().max(80).optional(),
    locationId: z.string().uuid().nullish(),
    force: z.boolean().optional(),
  })
  .refine((d) => d.memberId || d.qrCode || d.phoneNumber, { message: 'Scan a code, enter a phone number or pick a member' })

// POST /api/checkin - check a member in by id, scanned code or phone number
export const POST = handler(
  { permission: 'attendance.manage', write: true, body: checkinSchema, rateLimit: { key: 'checkin', ...CHECKIN_RATE_LIMIT } },
  async ({ ownerId, body, actor, can }) => {
    await assertOwned(ownerId, 'location', body.locationId, 'Location')
    let memberId = body.memberId
    if (!memberId) {
      const matches = await findMembers(ownerId, (body.qrCode || body.phoneNumber)!, 5)
      if (matches.length === 0) throw notFound('Member')
      if (matches.length > 1) {
        // Never guess between people who share part of a phone number.
        throw new ApiError(409, 'More than one member matches. Enter the full phone number or search by name.', 'multiple_matches', {
          matches: matches.map((m) => ({ id: m.id, name: m.name })),
        })
      }
      memberId = matches[0].id
    }
    if (body.force && !can('members.manage')) throw new ApiError(403, 'Only staff who manage members can override a check-in.', 'forbidden')

    const source = body.source || (body.qrCode ? 'qr' : body.phoneNumber ? 'phone' : 'manual')
    const result = await prisma.$transaction((db) =>
      checkInMember(db, { ownerId, memberId: memberId!, source, locationId: body.locationId, deviceName: body.deviceName, force: body.force, actor })
    )
    const card = await memberCard(ownerId, result.member.id)
    return {
      success: true,
      duplicate: result.duplicate,
      checkin: { id: result.checkin.id, timestamp: result.checkin.timestamp },
      checkinMethod: source,
      streak: result.streak,
      attended: result.attended,
      member: card,
    }
  }
)

// GET /api/checkin?range=today&locationId=&page= - the check-in log
export const GET = handler({ permission: ['attendance.manage', 'members.view'] }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = paging(query, 50)
  const settings = await getGymSettings(ownerId)
  const range = resolveRange(query.get('range') || 'today', query.get('from'), query.get('to'), settings.timezone)
  const where = {
    ownerId,
    timestamp: { gte: range.start, lt: range.end },
    ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    ...(query.get('type') && { type: query.get('type')! }),
  }
  const [checkins, total] = await Promise.all([
    prisma.checkin.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip,
      take,
      select: {
        id: true, timestamp: true, source: true, type: true,
        member: { select: { id: true, name: true, photoUrl: true, status: true } },
        session: { select: { title: true, classType: { select: { name: true } } } },
        location: { select: { name: true } },
      },
    }),
    prisma.checkin.count({ where }),
  ])
  return new Paginated(checkins, total, page, pageSize)
})
