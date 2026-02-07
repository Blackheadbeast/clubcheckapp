import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie, isOwnerRole } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['front_desk', 'manager']).optional(),
  active: z.boolean().optional(),
})

// PATCH update staff (owner only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getOwnerFromCookie()
    const { id } = await params

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isOwnerRole(auth)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (isDemoOwner(auth.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    const body = await request.json()
    const parsed = updateStaffSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Check if staff exists and belongs to owner
    const existing = await prisma.staff.findFirst({
      where: { id, ownerId: auth.ownerId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    // Build update data
    const updateData: Record<string, unknown> = { ...parsed.data }

    // Hash password if provided
    if (parsed.data.password) {
      updateData.password = await bcrypt.hash(parsed.data.password, 10)
    }

    // Check for email uniqueness if changing email
    if (parsed.data.email && parsed.data.email !== existing.email) {
      const emailExists = await prisma.staff.findFirst({
        where: {
          email: parsed.data.email,
          ownerId: auth.ownerId,
          id: { not: id },
        },
      })
      if (emailExists) {
        return NextResponse.json(
          { error: 'A staff member with this email already exists' },
          { status: 400 }
        )
      }
    }

    const staff = await prisma.staff.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        lastLoginAt: true,
      },
    })

    return NextResponse.json({ staff })
  } catch (error) {
    console.error('Update staff error:', error)
    return NextResponse.json({ error: 'Failed to update staff' }, { status: 500 })
  }
}

// DELETE staff (owner only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getOwnerFromCookie()
    const { id } = await params

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isOwnerRole(auth)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (isDemoOwner(auth.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    await prisma.staff.delete({
      where: { id, ownerId: auth.ownerId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete staff error:', error)
    return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 })
  }
}
