import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendBillingReminderEmail } from '@/lib/email'
import { cronAuthorized } from '@/lib/cron'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Vercel Cron sends the secret as a bearer token. It used to be read only from x-cron-secret or
  // the URL, so the scheduled run was refused every day; and a secret in a URL ends up in logs.
  if (!cronAuthorized(request)) {
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
        lastReminderSentAt: true,
      },
    })

    for (const member of members) {
      const billingDay = member.billingDayOfMonth!
      // Calculate days until billing day
      let daysUntil = billingDay - todayDay
      if (daysUntil < 0) daysUntil += 28 // wrapped to next month

      if (daysUntil <= reminderDays && daysUntil >= 0) {
        // Claim the reminder before sending it, so two runs at once (or a retry) cannot both send.
        const claimed = await prisma.member.updateMany({
          where: { id: member.id, OR: [{ lastReminderSentAt: null }, { lastReminderSentAt: { lt: startOfMonth } }] },
          data: { lastReminderSentAt: new Date() },
        })
        if (claimed.count === 0) continue
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
          sentCount++
        } catch (err) {
          // Not sent: give the claim back so the next run tries again. No address in the log.
          await prisma.member.update({ where: { id: member.id }, data: { lastReminderSentAt: member.lastReminderSentAt } }).catch(() => {})
          console.error(`[cron] billing reminder for member ${member.id} failed:`, err instanceof Error ? err.message : 'unknown error')
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
