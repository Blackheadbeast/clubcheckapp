import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { z } from 'zod'

const recordPaymentSchema = z.object({
  amountCents: z.number().int().min(1),
  method: z.enum(['cash', 'zelle', 'venmo', 'card', 'bank_transfer', 'other']),
  note: z.string().max(500).optional(),
  paidAt: z.string().optional(),
})

// POST - Record a payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (isDemoOwner(owner.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    const writeAccess = await requireWriteAccess(owner.ownerId)
    if (!writeAccess.allowed) {
      return NextResponse.json({ error: writeAccess.error }, { status: writeAccess.status })
    }

    const body = await request.json()
    const parsed = recordPaymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Verify member belongs to this owner
    const member = await prisma.member.findFirst({
      where: { id, ownerId: owner.ownerId },
      select: { id: true, status: true },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date()

    const payment = await prisma.paymentRecord.create({
      data: {
        amountCents: parsed.data.amountCents,
        method: parsed.data.method,
        note: parsed.data.note || null,
        paidAt,
        ownerId: owner.ownerId,
        memberId: id,
      },
    })

    // Update member's lastPaidAt and reactivate if overdue
    await prisma.member.update({
      where: { id },
      data: {
        lastPaidAt: paidAt,
        ...(member.status === 'overdue' ? { status: 'active' } : {}),
      },
    })

    return NextResponse.json({ payment, reactivated: member.status === 'overdue' })
  } catch (error) {
    console.error('Record payment error:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
