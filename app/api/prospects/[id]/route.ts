import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const updateProspectSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional().nullable(),
  status: z.enum(['new', 'contacted', 'toured', 'converted', 'lost']).optional(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// GET single prospect
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

    const prospect = await prisma.prospect.findFirst({
      where: { id, ownerId: owner.ownerId },
    })

    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
    }

    return NextResponse.json({ prospect })
  } catch (error) {
    console.error('Get prospect error:', error)
    return NextResponse.json({ error: 'Failed to fetch prospect' }, { status: 500 })
  }
}

// PATCH update prospect
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

    // Check billing status allows writes
    const writeAccess = await requireWriteAccess(owner.ownerId)
    if (!writeAccess.allowed) {
      return NextResponse.json({ error: writeAccess.error }, { status: writeAccess.status })
    }

    const body = await request.json()
    const parsed = updateProspectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Check if prospect exists and belongs to owner
    const existing = await prisma.prospect.findFirst({
      where: { id, ownerId: owner.ownerId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
    }

    // Build update data with status timestamps
    const updateData: Record<string, unknown> = { ...parsed.data }

    if (parsed.data.status) {
      const now = new Date()
      if (parsed.data.status === 'contacted' && !existing.contactedAt) {
        updateData.contactedAt = now
      }
      if (parsed.data.status === 'toured' && !existing.touredAt) {
        updateData.touredAt = now
        // Also set contacted if not already
        if (!existing.contactedAt) {
          updateData.contactedAt = now
        }
      }
    }

    const prospect = await prisma.prospect.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ prospect })
  } catch (error) {
    console.error('Update prospect error:', error)
    return NextResponse.json({ error: 'Failed to update prospect' }, { status: 500 })
  }
}

// DELETE prospect
export async function DELETE(
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

    // Check billing status allows writes
    const writeAccess = await requireWriteAccess(owner.ownerId)
    if (!writeAccess.allowed) {
      return NextResponse.json({ error: writeAccess.error }, { status: writeAccess.status })
    }

    await prisma.prospect.delete({
      where: { id, ownerId: owner.ownerId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete prospect error:', error)
    return NextResponse.json({ error: 'Failed to delete prospect' }, { status: 500 })
  }
}
