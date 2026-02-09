import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { sendFeedbackNotificationEmail } from '@/lib/email'
import { z } from 'zod'
import { rateLimitResponse, FEEDBACK_RATE_LIMIT } from '@/lib/rate-limit'

const feedbackSchema = z.object({
  rating: z.number().min(1).max(5),
  message: z.string().max(2000).nullable().optional(),
})

export async function POST(request: NextRequest) {
  // Rate limit feedback submissions
  const rateLimit = rateLimitResponse(request, 'feedback', FEEDBACK_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many feedback submissions. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) },
      }
    )
  }

  try {
    const auth = await getOwnerFromCookie()

    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const parsed = feedbackSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid feedback data' },
        { status: 400 }
      )
    }

    const { rating, message } = parsed.data

    // Get owner email for notification
    const owner = await prisma.owner.findUnique({
      where: { id: auth.ownerId },
      select: { email: true },
    })

    if (!owner) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404 }
      )
    }

    // Save feedback to database
    await prisma.feedback.create({
      data: {
        rating,
        message: message || null,
        ownerId: auth.ownerId,
      },
    })

    // Send email notification to admin (non-blocking)
    sendFeedbackNotificationEmail(
      rating,
      message || null,
      owner.email,
      auth.ownerId
    ).catch((err) => {
      console.error('Failed to send feedback notification:', err)
    })

    return NextResponse.json({
      success: true,
      message: 'Feedback submitted successfully',
    })
  } catch (error) {
    console.error('Feedback error:', error)
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    )
  }
}
