import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { z } from 'zod'

const updateBillingSchema = z.object({
  monthlyFeeCents: z.number().int().min(0).max(10000000).optional(),
  billingDayOfMonth: z.number().int().min(1).max(28).optional(),
  paymentMethod: z.enum(['cash', 'zelle', 'venmo', 'card', 'bank_transfer', 'other']).optional(),
  billingEnabled: z.boolean().optional(),
  paymentLink: z.string().url().max(500).optional().nullable(),
})

// GET billing config + payment history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const owner = await getOwnerFromCookie()
    const { id } = await params

    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { id, ownerId: owner.ownerId },
      select: {
        id: true,
        monthlyFeeCents: true,
        billingDayOfMonth: true,
        paymentMethod: true,
        billingEnabled: true,
        lastPaidAt: true,
        paymentLink: true,
        paymentRecords: {
          orderBy: { paidAt: 'desc' },
          take: 50,
        },
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    return NextResponse.json({
      billing: {
        monthlyFeeCents: member.monthlyFeeCents,
        billingDayOfMonth: member.billingDayOfMonth,
        paymentMethod: member.paymentMethod,
        billingEnabled: member.billingEnabled,
        lastPaidAt: member.lastPaidAt,
        paymentLink: member.paymentLink,
      },
      payments: member.paymentRecords,
    })
  } catch (error) {
    console.error('Get member billing error:', error)
    return NextResponse.json({ error: 'Failed to fetch billing' }, { status: 500 })
  }
}

// PATCH update billing config
export async function PATCH(
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
    const parsed = updateBillingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const member = await prisma.member.update({
      where: { id, ownerId: owner.ownerId },
      data: parsed.data,
      select: {
        id: true,
        monthlyFeeCents: true,
        billingDayOfMonth: true,
        paymentMethod: true,
        billingEnabled: true,
        lastPaidAt: true,
        paymentLink: true,
      },
    })

    return NextResponse.json({ billing: member })
  } catch (error) {
    console.error('Update member billing error:', error)
    return NextResponse.json({ error: 'Failed to update billing' }, { status: 500 })
  }
}
