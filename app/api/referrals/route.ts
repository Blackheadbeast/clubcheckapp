import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function generateReferralCode(): string {
  // Generate a short, readable referral code like "GYM-A1B2C3"
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude confusing chars (0, O, 1, I)
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length))
  }
  return `GYM-${code}`
}

export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get or create referral record for this owner
    let referral = await prisma.referral.findUnique({
      where: { ownerId: owner.ownerId },
    })

    if (!referral) {
      // Auto-generate a referral code for this owner
      let code = generateReferralCode()
      let attempts = 0

      // Ensure unique code
      while (attempts < 10) {
        const existing = await prisma.referral.findUnique({
          where: { referralCode: code },
        })
        if (!existing) break
        code = generateReferralCode()
        attempts++
      }

      referral = await prisma.referral.create({
        data: {
          ownerId: owner.ownerId,
          referralCode: code,
        },
      })
    }

    // Count how many gyms this owner has referred
    const referredGyms = await prisma.referral.count({
      where: { referredByOwnerId: owner.ownerId },
    })

    // Get details of referred gyms
    const referredDetails = await prisma.referral.findMany({
      where: { referredByOwnerId: owner.ownerId },
      include: {
        owner: {
          select: {
            email: true,
            subscriptionStatus: true,
            createdAt: true,
          },
        },
      },
      orderBy: { referredAt: 'desc' },
      take: 20,
    })

    // Get gym profile for names
    const ownerIds = referredDetails.map((r) => r.ownerId)
    const gymProfiles = await prisma.gymProfile.findMany({
      where: { ownerId: { in: ownerIds } },
      select: { ownerId: true, name: true },
    })

    const gymNameMap = new Map(gymProfiles.map((g) => [g.ownerId, g.name]))

    const referrals = referredDetails.map((r) => ({
      id: r.id,
      gymName: gymNameMap.get(r.ownerId) || 'Unnamed Gym',
      email: r.owner.email,
      status: r.owner.subscriptionStatus || 'none',
      referredAt: r.referredAt.toISOString(),
      creditEarned: r.owner.subscriptionStatus === 'active' || r.owner.subscriptionStatus === 'trialing',
    }))

    // Count paying referrals (ones that earned credit)
    const payingReferrals = referrals.filter((r) => r.creditEarned).length

    return NextResponse.json({
      referralCode: referral.referralCode,
      totalReferred: referredGyms,
      payingReferrals,
      creditedMonths: referral.creditedMonths,
      referrals,
    })
  } catch (error) {
    console.error('Get referrals error:', error)
    return NextResponse.json({ error: 'Failed to fetch referrals' }, { status: 500 })
  }
}

// Regenerate referral code
export async function POST() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let code = generateReferralCode()
    let attempts = 0

    // Ensure unique code
    while (attempts < 10) {
      const existing = await prisma.referral.findUnique({
        where: { referralCode: code },
      })
      if (!existing) break
      code = generateReferralCode()
      attempts++
    }

    const referral = await prisma.referral.upsert({
      where: { ownerId: owner.ownerId },
      create: {
        ownerId: owner.ownerId,
        referralCode: code,
      },
      update: {
        referralCode: code,
      },
    })

    return NextResponse.json({ referralCode: referral.referralCode })
  } catch (error) {
    console.error('Regenerate referral code error:', error)
    return NextResponse.json({ error: 'Failed to regenerate code' }, { status: 500 })
  }
}
