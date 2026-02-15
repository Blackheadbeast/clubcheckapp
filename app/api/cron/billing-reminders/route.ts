import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendBillingReminderEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Validate cron secret
  const cronSecret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const todayDay = today.getDate()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  let sentCount = 0
  let errorCount = 0

  // Get all gym profiles with reminder config
  const gymProfiles = await prisma.gymProfile.findMany({
    select: {
      ownerId: true,
      name: true,
      reminderDaysBefore: true,
    },
  })

  for (const gym of gymProfiles) {
    const reminderDays = gym.reminderDaysBefore || 3

    // Find members whose billing day is within reminderDays from now
    // and who haven't been reminded this month
    const members = await prisma.member.findMany({
      where: {
        ownerId: gym.ownerId,
        billingEnabled: true,
        status: { in: ['active', 'overdue'] },
        monthlyFeeCents: { not: null, gt: 0 },
        billingDayOfMonth: { not: null },
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: startOfMonth } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        monthlyFeeCents: true,
        paymentMethod: true,
        billingDayOfMonth: true,
        paymentLink: true,
      },
    })

    for (const member of members) {
      const billingDay = member.billingDayOfMonth!
      // Calculate days until billing day
      let daysUntil = billingDay - todayDay
      if (daysUntil < 0) daysUntil += 28 // wrapped to next month

      if (daysUntil <= reminderDays && daysUntil >= 0) {
        try {
          await sendBillingReminderEmail(
            member.email,
            member.name,
            gym.name || 'Your Gym',
            member.monthlyFeeCents!,
            billingDay,
            member.paymentMethod || 'your preferred method',
            member.paymentLink,
          )

          await prisma.member.update({
            where: { id: member.id },
            data: { lastReminderSentAt: new Date() },
          })

          sentCount++
        } catch (err) {
          console.error(`Failed to send reminder to ${member.email}:`, err)
          errorCount++
        }
      }
    }
  }

  // Mark overdue members as overdue
  // Members whose billing day has passed this month and no payment recorded this month
  const overdueMembers = await prisma.member.findMany({
    where: {
      billingEnabled: true,
      status: 'active',
      billingDayOfMonth: { lt: todayDay },
      monthlyFeeCents: { not: null, gt: 0 },
      OR: [
        { lastPaidAt: null },
        { lastPaidAt: { lt: startOfMonth } },
      ],
    },
    select: { id: true },
  })

  if (overdueMembers.length > 0) {
    await prisma.member.updateMany({
      where: { id: { in: overdueMembers.map(m => m.id) } },
      data: { status: 'overdue' },
    })
  }

  return NextResponse.json({
    success: true,
    sent: sentCount,
    errors: errorCount,
    overdueMarked: overdueMembers.length,
    timestamp: new Date().toISOString(),
  })
}
