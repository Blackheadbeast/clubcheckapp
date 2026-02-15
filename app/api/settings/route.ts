import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { generateUniqueGymCode } from '@/lib/gym-code'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const updateSettingsSchema = z.object({
  gymName: z.string().min(1).max(100).optional(),
  gymAddress: z.string().max(500).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  billingContactEmail: z.string().email().optional().or(z.literal('')),
  billingMode: z.enum(['stripe', 'external']).optional(),
  externalProviderName: z.string().max(100).optional(),
})

const patchSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'auto']).optional(),
})

export async function GET() {
  try {
    const auth = await getOwnerFromCookie()
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ownerData = await prisma.owner.findUnique({
      where: { id: auth.ownerId },
      select: {
        id: true,
        email: true,
        planType: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        createdAt: true,
        gymCode: true,
        gymProfile: true,
      },
    })

    if (!ownerData) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    // Auto-generate gym code for legacy owners
    if (!ownerData.gymCode) {
      const gymCode = await generateUniqueGymCode()
      await prisma.owner.update({
        where: { id: auth.ownerId },
        data: { gymCode },
      })
      ownerData.gymCode = gymCode
    }

    // Get staff info if this is a staff login
    let staffInfo = null
    if (auth.staffId) {
      const staff = await prisma.staff.findUnique({
        where: { id: auth.staffId },
        select: { name: true, role: true },
      })
      staffInfo = staff
    }

    return NextResponse.json({
      owner: {
        id: ownerData.id,
        email: ownerData.email,
        planType: ownerData.planType,
        subscriptionStatus: ownerData.subscriptionStatus,
        currentPeriodEnd: ownerData.currentPeriodEnd,
        createdAt: ownerData.createdAt,
        gymCode: ownerData.gymCode,
      },
      gym: ownerData.gymProfile
        ? {
            name: ownerData.gymProfile.name || '',
            address: ownerData.gymProfile.address || '',
            logoUrl: ownerData.gymProfile.logoUrl || '',
            billingMode: ownerData.gymProfile.billingMode,
            externalProviderName: ownerData.gymProfile.externalProviderName || '',
            billingContactEmail: ownerData.gymProfile.billingContactEmail || '',
          }
        : {
            name: '',
            address: '',
            logoUrl: '',
            billingMode: 'stripe',
            externalProviderName: '',
            billingContactEmail: '',
          },
      isStaff: !!auth.staffId,
      staffRole: auth.role || null,
      staffName: staffInfo?.name || null,
    })
  } catch (error) {
    console.error('Get settings error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Block mutations in demo mode
    if (isDemoOwner(owner.ownerId)) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE }, { status: 403 })
    }

    // Check billing status allows writes
    const writeAccess = await requireWriteAccess(owner.ownerId)
    if (!writeAccess.allowed) {
      return NextResponse.json({ error: writeAccess.error }, { status: writeAccess.status })
    }

    const body = await request.json()
    const parsed = updateSettingsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { gymName, gymAddress, logoUrl, billingContactEmail, billingMode, externalProviderName } =
      parsed.data

    // Upsert gym profile
    await prisma.gymProfile.upsert({
      where: { ownerId: owner.ownerId },
      create: {
        ownerId: owner.ownerId,
        name: gymName,
        address: gymAddress,
        logoUrl: logoUrl || null,
        billingContactEmail: billingContactEmail || null,
        billingMode: billingMode || 'stripe',
        externalProviderName: externalProviderName || null,
      },
      update: {
        ...(gymName !== undefined && { name: gymName }),
        ...(gymAddress !== undefined && { address: gymAddress }),
        ...(logoUrl !== undefined && { logoUrl: logoUrl || null }),
        ...(billingContactEmail !== undefined && {
          billingContactEmail: billingContactEmail || null,
        }),
        ...(billingMode !== undefined && { billingMode }),
        ...(externalProviderName !== undefined && {
          externalProviderName: externalProviderName || null,
        }),
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update settings error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = patchSettingsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { theme } = parsed.data

    if (theme) {
      await prisma.gymProfile.upsert({
        where: { ownerId: owner.ownerId },
        create: {
          ownerId: owner.ownerId,
          theme,
        },
        update: {
          theme,
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Patch settings error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
