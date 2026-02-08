import { NextResponse } from 'next/server'
import { getOwnerFromCookie } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isDemoOwner } from '@/lib/demo'

// GET - Check if walkthrough should be shown
export async function GET() {
  const auth = await getOwnerFromCookie()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // For demo mode, always show walkthrough (user can skip)
  if (isDemoOwner(auth.ownerId)) {
    return NextResponse.json({
      showWalkthrough: true,
      isDemo: true,
    })
  }

  // For real users, check if they've completed the walkthrough
  const gymProfile = await prisma.gymProfile.findUnique({
    where: { ownerId: auth.ownerId },
    select: { walkthroughCompletedAt: true },
  })

  return NextResponse.json({
    showWalkthrough: !gymProfile?.walkthroughCompletedAt,
    isDemo: false,
  })
}

// POST - Mark walkthrough as completed/skipped
export async function POST() {
  const auth = await getOwnerFromCookie()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Don't save for demo mode
  if (isDemoOwner(auth.ownerId)) {
    return NextResponse.json({ success: true })
  }

  // Update gym profile
  await prisma.gymProfile.update({
    where: { ownerId: auth.ownerId },
    data: { walkthroughCompletedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
