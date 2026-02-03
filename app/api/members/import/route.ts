import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { PLAN_LIMITS } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get owner data for plan limits
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: { planType: true },
    })

    // Get current member count
    const currentCount = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
      },
    })

    const limit = ownerData?.planType === 'pro' ? PLAN_LIMITS.pro : PLAN_LIMITS.starter

    const { members } = await request.json()

    if (!Array.isArray(members) || members.length === 0) {
      return NextResponse.json(
        { error: 'No members provided' },
        { status: 400 }
      )
    }

    // Check if import would exceed limit
    if (currentCount + members.length > limit) {
      return NextResponse.json(
        { 
          error: `Import would exceed member limit. You have ${currentCount} members and can add ${limit - currentCount} more.`,
          limitReached: true,
        },
        { status: 403 }
      )
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    }

    // Process each member
    for (const memberData of members) {
      try {
        const { name, email, phone } = memberData

        // Validate required fields
        if (!name || !email) {
          results.failed++
          results.errors.push(`Missing name or email for entry: ${JSON.stringify(memberData)}`)
          continue
        }

        // Check for duplicate email within this owner's members
        const existingMember = await prisma.member.findFirst({
          where: {
            email: email.toLowerCase().trim(),
            ownerId: owner.ownerId,
          },
        })

        if (existingMember) {
          results.failed++
          results.errors.push(`Member with email ${email} already exists`)
          continue
        }

        // Generate unique QR code
        const qrData = `clubcheck-member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

        // Create member
        await prisma.member.create({
          data: {
            name: name.trim(),
            email: email.toLowerCase().trim(),
            phone: phone?.trim() || null,
            qrCode: qrData,
            ownerId: owner.ownerId,
          },
        })

        results.success++
      } catch (err) {
        results.failed++
        results.errors.push(`Failed to create member: ${memberData.email || 'unknown'}`)
      }
    }

    return NextResponse.json({
      message: `Imported ${results.success} members successfully${results.failed > 0 ? `, ${results.failed} failed` : ''}`,
      success: results.success,
      failed: results.failed,
      errors: results.errors.slice(0, 10), // Limit errors shown
    })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Import failed' },
      { status: 500 }
    )
  }
}