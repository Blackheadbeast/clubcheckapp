import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Page, dateParam, pageOf, publicHandler } from '@/lib/public-api/handler'
import { attendanceOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/attendance?memberId=&classId=&locationId=&from=&to= - check-ins, newest first
export const GET = publicHandler({ scope: 'attendance:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const from = dateParam(query, 'from')
  const to = dateParam(query, 'to')
  const where: Prisma.CheckinWhereInput = {
    ownerId,
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('classId') && { sessionId: query.get('classId')! }),
    ...(query.get('locationId') && { locationId: query.get('locationId')! }),
    ...((from || to) && { timestamp: { ...(from && { gte: from }), ...(to && { lt: to }) } }),
  }
  const [rows, total] = await Promise.all([prisma.checkin.findMany({ where, orderBy: [{ timestamp: 'desc' }, { id: 'asc' }], skip, take }), prisma.checkin.count({ where })])
  return new Page(rows.map(attendanceOut), total, page, pageSize)
})
