import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { publicHandler } from '@/lib/public-api/handler'
import { attendanceOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

export const GET = publicHandler({ scope: 'attendance:read' }, async ({ ownerId, params }) => {
  const row = await prisma.checkin.findFirst({ where: { id: params.id, ownerId } })
  if (!row) throw notFound('Attendance record')
  return attendanceOut(row)
})
