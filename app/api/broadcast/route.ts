import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { z } from 'zod'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const broadcastSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  targetGroup: z.enum(['all', 'active', 'inactive', 'miss-you']),
})

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set')
  }
  return new Resend(process.env.RESEND_API_KEY)
}

function buildEmailHtml(gymName: string, memberName: string, message: string): string {
  // Convert newlines to <br> tags
  const formattedMessage = message.replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:linear-gradient(to bottom,#1a1a1a,#171717);border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="display:inline-block;width:50px;height:50px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;margin-bottom:16px;">
              <span style="color:#000;font-size:28px;font-weight:bold;line-height:50px;">C</span>
            </div>
            <h1 style="margin:0;color:#f59e0b;font-size:24px;font-weight:bold;">${gymName}</h1>
          </td></tr>
          <tr><td style="padding:20px 40px;">
            <p style="color:#e5e5e5;font-size:16px;line-height:1.6;margin:0 0 20px;">
              Hi ${memberName},
            </p>
            <div style="color:#a3a3a3;font-size:16px;line-height:1.8;margin:0 0 30px;">
              ${formattedMessage}
            </div>
          </td></tr>
          <tr><td style="padding:30px 40px;text-align:center;border-top:1px solid #2a2a2a;">
            <p style="color:#737373;font-size:12px;margin:0;">
              Sent from <span style="color:#f59e0b;font-weight:bold;">${gymName}</span> via ClubCheck
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

// GET - Get member counts for each target group
export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get counts for different groups
    const allMembers = await prisma.member.count({
      where: { ownerId: owner.ownerId },
    })

    const activeMembers = await prisma.member.count({
      where: { ownerId: owner.ownerId, status: 'active' },
    })

    const inactiveMembers = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: { in: ['inactive', 'paused'] },
      },
    })

    // "Miss you" = active members who haven't checked in for 14+ days
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const missYouMembers = await prisma.member.count({
      where: {
        ownerId: owner.ownerId,
        status: 'active',
        OR: [
          { lastCheckInAt: { lt: fourteenDaysAgo } },
          { lastCheckInAt: null },
        ],
      },
    })

    // Get gym name
    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: { name: true },
    })

    return NextResponse.json({
      counts: {
        all: allMembers,
        active: activeMembers,
        inactive: inactiveMembers,
        'miss-you': missYouMembers,
      },
      gymName: gymProfile?.name || 'Your Gym',
    })
  } catch (error) {
    console.error('Broadcast GET error:', error)
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 })
  }
}

// POST - Send broadcast email
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
    const parsed = broadcastSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { subject, message, targetGroup } = parsed.data

    // Get gym name
    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: { name: true },
    })
    const gymName = gymProfile?.name || 'Your Gym'

    // Build where clause based on target group
    let where: Record<string, unknown> = { ownerId: owner.ownerId }

    if (targetGroup === 'active') {
      where.status = 'active'
    } else if (targetGroup === 'inactive') {
      where.status = { in: ['inactive', 'paused'] }
    } else if (targetGroup === 'miss-you') {
      const fourteenDaysAgo = new Date()
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
      where = {
        ownerId: owner.ownerId,
        status: 'active',
        OR: [
          { lastCheckInAt: { lt: fourteenDaysAgo } },
          { lastCheckInAt: null },
        ],
      }
    }

    // Get members to email
    const members = await prisma.member.findMany({
      where: where as any,
      select: {
        id: true,
        name: true,
        email: true,
      },
    })

    if (members.length === 0) {
      return NextResponse.json(
        { error: 'No members found in the selected group' },
        { status: 400 }
      )
    }

    // Send emails
    const resend = getResend()
    let successCount = 0
    let failCount = 0
    const errors: string[] = []

    // Send in batches of 10 to avoid rate limits
    const batchSize = 10
    for (let i = 0; i < members.length; i += batchSize) {
      const batch = members.slice(i, i + batchSize)

      await Promise.all(
        batch.map(async (member) => {
          try {
            const html = buildEmailHtml(gymName, member.name, message)
            const { error } = await resend.emails.send({
              from: `${gymName} <noreply@clubcheckapp.com>`,
              to: member.email,
              subject,
              html,
            })

            if (error) {
              failCount++
              errors.push(`${member.email}: ${error.message}`)
            } else {
              successCount++
            }
          } catch (err) {
            failCount++
            errors.push(`${member.email}: Send failed`)
          }
        })
      )

      // Small delay between batches
      if (i + batchSize < members.length) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    return NextResponse.json({
      success: true,
      sent: successCount,
      failed: failCount,
      total: members.length,
      errors: errors.slice(0, 5), // Return first 5 errors only
    })
  } catch (error) {
    console.error('Broadcast POST error:', error)
    return NextResponse.json({ error: 'Failed to send broadcast' }, { status: 500 })
  }
}
