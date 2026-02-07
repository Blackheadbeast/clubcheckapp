import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createProspectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
})

// GET all prospects
export async function GET(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = request.nextUrl
    const status = url.searchParams.get('status') || ''
    const search = url.searchParams.get('search') || ''

    const where: Record<string, unknown> = { ownerId: owner.ownerId }

    if (status && status !== 'all') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ]
    }

    const prospects = await prisma.prospect.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        source: true,
        notes: true,
        createdAt: true,
        contactedAt: true,
        touredAt: true,
        convertedAt: true,
        convertedMemberId: true,
      },
    })

    // Get counts by status
    const counts = await prisma.prospect.groupBy({
      by: ['status'],
      where: { ownerId: owner.ownerId },
      _count: { status: true },
    })

    const statusCounts = {
      new: 0,
      contacted: 0,
      toured: 0,
      converted: 0,
      lost: 0,
    }
    counts.forEach((c) => {
      if (c.status in statusCounts) {
        statusCounts[c.status as keyof typeof statusCounts] = c._count.status
      }
    })

    return NextResponse.json({ prospects, statusCounts })
  } catch (error) {
    console.error('Get prospects error:', error)
    return NextResponse.json({ error: 'Failed to fetch prospects' }, { status: 500 })
  }
}

// POST create prospect
export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
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
    const parsed = createProspectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { name, email, phone, source, notes } = parsed.data

    const prospect = await prisma.prospect.create({
      data: {
        name,
        email,
        phone: phone || null,
        source: source || null,
        notes: notes || null,
        ownerId: owner.ownerId,
      },
    })

    return NextResponse.json({ prospect })
  } catch (error) {
    console.error('Create prospect error:', error)
    return NextResponse.json({ error: 'Failed to create prospect' }, { status: 500 })
  }
}
