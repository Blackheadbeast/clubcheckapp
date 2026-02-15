import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const bulkSchema = z.object({
  action: z.enum(['delete', 'status']),
  ids: z.array(z.string().uuid()).min(1, 'Select at least one member'),
  status: z.enum(['active', 'inactive', 'overdue', 'paused']).optional(),
}).refine(
  (data) => data.action !== 'status' || data.status !== undefined,
  { message: 'Status is required for status action' }
)

export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { action, ids, status } = parsed.data

    if (action === 'delete') {
      const result = await prisma.member.deleteMany({
        where: { id: { in: ids }, ownerId: owner.ownerId },
      })
      return NextResponse.json({ deleted: result.count })
    }

    if (action === 'status' && status) {
      const result = await prisma.member.updateMany({
        where: { id: { in: ids }, ownerId: owner.ownerId },
        data: { status },
      })
      return NextResponse.json({ updated: result.count })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Bulk action error:', error)
    return NextResponse.json({ error: 'Bulk action failed' }, { status: 500 })
  }
}
