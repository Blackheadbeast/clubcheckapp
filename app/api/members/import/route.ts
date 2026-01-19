import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { PLAN_LIMITS } from '@/lib/stripe'
import QRCode from 'qrcode'

export async function POST(request: NextRequest) {
  try {
    const owner = await getOwnerFromCookie()

    if (!owner) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get owner data
    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: { planType: true },
    })

    // Check current member count
    const currentCount = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
      },
    })

    const limit = ownerData?.planType === 'pro' ? PLAN_LIMITS.pro : PLAN_LIMITS.starter

    const { members } = await request.json()

    if (!members || !Array.isArray(members) || members.length === 0) {
      return NextResponse.json(
        { error: 'No members provided' },
        { status: 400 }
      )
    }

    // Check if import would exceed limit
    if (currentCount + members.length > limit) {
      return NextResponse.json(
        { 
          error: `Import would exceed your limit. You have ${currentCount} members and can add ${limit - currentCount} more.`,
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

        if (!name || !email) {
          results.failed++
          results.errors.push(`Missing name or email for row`)
          continue
        }

        // Check if member already exists
        const existing = await prisma.member.findFirst({
          where: {
            email,
            ownerId: owner.ownerId,
          },
        })

        if (existing) {
          results.failed++
          results.errors.push(`${email} already exists`)
          continue
        }

        // Generate QR code
        const qrData = `clubcheck-member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const qrCodeUrl = await QRCode.toDataURL(qrData, {
          width: 300,
          margin: 2,
          color: {
            dark: '#f59e0b',
            light: '#0a0a0a',
          },
        })

        // Create member
        const member = await prisma.member.create({
          data: {
            name,
            email,
            phone: phone || null,
            qrCode: qrData,
            ownerId: owner.ownerId,
          },
        })

        // Try to send email (don't fail if email fails)
        try {
          // Dynamically import email function only when actually sending
          const { sendMemberWelcomeEmail } = await import('@/lib/email')
          await sendMemberWelcomeEmail(member.email, member.name, qrCodeUrl)
        } catch (emailError) {
          console.error(`Email failed for ${email}:`, emailError)
          // Continue processing even if email fails
        }

        results.success++
      } catch (error) {
        results.failed++
        results.errors.push(`Failed to import ${memberData.email || 'unknown'}`)
        console.error('Import error:', error)
      }
    }

    return NextResponse.json({
      message: `Imported ${results.success} members, ${results.failed} failed`,
      success: results.success,
      failed: results.failed,
      errors: results.errors,
    })
  } catch (error) {
    console.error('Bulk import error:', error)
    return NextResponse.json(
      { error: 'Import failed' },
      { status: 500 }
    )
  }
}

// Add this to prevent Next.js from trying to statically optimize this route
export const dynamic = 'force-dynamic'