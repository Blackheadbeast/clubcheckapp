import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron'
import { drainOutbox } from '@/lib/services/outbox'
import { expireOffers } from '@/lib/services/bookings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// GET /api/cron/messages - the minute-level heartbeat: due reminders, scheduled campaigns, retries
// and waitlist deadlines for every gym. Point any scheduler that can call a URL every minute or
// few at it (Vercel Cron on a paid plan, or an external one) with the CRON_SECRET.
// It is safe to call as often as you like, and safe to overlap with itself.
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const offersExpired = await expireOffers()
  return NextResponse.json({ ...(await drainOutbox(undefined, 200)), offersExpired })
}
