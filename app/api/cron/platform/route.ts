import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runMembershipBilling } from '@/lib/services/memberships'
import { ensureSessions } from '@/lib/services/classes'
import { expireOffers, markNoShows } from '@/lib/services/bookings'
import { processDueRuns, scanScheduledTriggers } from '@/lib/services/automations'
import { deliverQueued } from '@/lib/services/messaging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// The platform's background work, for every account that can still write:
// membership billing, class generation, waitlist offers, no-shows and automations.
// Everything here is idempotent, so running it more often is always safe.

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; x-cron-secret is for other schedulers.
  const given = request.headers.get('authorization')?.replace(/^Bearer /, '') || request.headers.get('x-cron-secret') || ''
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const owners = await prisma.owner.findMany({
    where: { emailVerified: { not: null }, OR: [{ subscriptionStatus: { in: ['active', 'trialing', 'past_due'] } }, { trialEndsAt: { gt: now } }] },
    select: { id: true },
  })
  const totals = { accounts: owners.length, invoicesCreated: 0, markedPastDue: 0, sessionsGenerated: 0, offersExpired: 0, noShows: 0, automationsQueued: 0, errors: [] as string[] }
  for (const { id } of owners) {
    try {
      const billing = await runMembershipBilling(id, now)
      totals.invoicesCreated += billing.invoicesCreated
      totals.markedPastDue += billing.markedPastDue
      totals.errors.push(...billing.errors.map((e) => `${id}: ${e}`))
      totals.sessionsGenerated += await ensureSessions(id, undefined, now)
      totals.noShows += await markNoShows(id, now)
      totals.automationsQueued += await scanScheduledTriggers(id, now)
    } catch (error) {
      totals.errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  totals.offersExpired = await expireOffers(undefined, now)
  const delivered = await deliverQueued(undefined, 200)
  const runs = await processDueRuns(undefined, 500)
  if (totals.errors.length) console.error('[cron] platform run had errors:', totals.errors)
  return NextResponse.json({ ...totals, messagesDelivered: delivered, automationsProcessed: runs.processed, errors: totals.errors.length })
}
