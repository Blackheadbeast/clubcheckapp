import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cronAuthorized } from '@/lib/cron'
import { runMembershipBilling } from '@/lib/services/memberships'
import { runCollections } from '@/lib/services/collections'
import { sendAppointmentReminders } from '@/lib/services/appointments'
import { refreshAssignments } from '@/lib/services/programs'
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

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const owners = await prisma.owner.findMany({
    where: { emailVerified: { not: null }, OR: [{ subscriptionStatus: { in: ['active', 'trialing', 'past_due'] } }, { trialEndsAt: { gt: now } }] },
    select: { id: true },
  })
  const totals = { accounts: owners.length, invoicesCreated: 0, paymentsCollected: 0, paymentsProcessing: 0, paymentsFailed: 0, markedPastDue: 0, sessionsGenerated: 0, appointmentReminders: 0, offersExpired: 0, noShows: 0, automationsQueued: 0, errors: [] as string[] }
  for (const { id } of owners) {
    try {
      const billing = await runMembershipBilling(id, now)
      totals.invoicesCreated += billing.invoicesCreated
      totals.markedPastDue += billing.markedPastDue
      totals.errors.push(...billing.errors.map((e) => `${id}: ${e}`))
      // Charge what just came due and retry failed payments whose next attempt is due.
      const collections = await runCollections(id, now)
      totals.paymentsCollected += collections.collected
      totals.paymentsProcessing += collections.processing
      totals.paymentsFailed += collections.failed
      totals.errors.push(...collections.errors.map((e) => `${id}: ${e}`))
      totals.sessionsGenerated += await ensureSessions(id, undefined, now)
      totals.noShows += await markNoShows(id, now)
      totals.appointmentReminders += await sendAppointmentReminders(id, now)
      // Start programs whose date has come and close out the ones that have run their course.
      await refreshAssignments(id, {}, now)
      totals.automationsQueued += await scanScheduledTriggers(id, now)
    } catch (error) {
      totals.errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  totals.offersExpired = await expireOffers(undefined, now)
  const { runScheduledCampaigns } = await import('@/lib/services/campaigns')
  await runScheduledCampaigns(undefined, now)
  const runs = await processDueRuns(undefined, 500)
  const delivered = await deliverQueued(undefined, 300)
  await runScheduledCampaigns(undefined, now)
  // Documents: deadlines and validity that have run out, and one reminder for anything left unsigned.
  const documents = await import('@/lib/services/documents')
  const documentsExpired = await documents.expireDocuments(undefined, now).catch((error) => { console.error('[cron] document expiry failed:', error); return 0 })
  const documentsReminded = await documents.remindUnsigned((process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, ''), undefined, now).catch((error) => { console.error('[cron] document reminders failed:', error); return 0 })
  // Payroll: bring the earnings ledger up to date for every gym with a pay period still open.
  const payroll = await import('@/lib/services/payroll')
  for (const { ownerId } of await prisma.payrollPeriod.findMany({ where: { status: { in: ['open', 'review'] } }, distinct: ['ownerId'], select: { ownerId: true } })) {
    await payroll.syncPayroll(ownerId).catch((error) => console.error('[cron] payroll sync failed:', (error as Error).message))
  }
  // Webhooks recorded by the billing run and anything waiting on a retry, then the developer tables' housekeeping.
  const { deliverDue, pruneDeveloperData } = await import('@/lib/services/webhooks')
  const webhooks = await deliverDue({ limit: 300, now })
  await pruneDeveloperData(now).catch((error) => console.error('[cron] developer data pruning failed:', error))
  if (totals.errors.length) console.error('[cron] platform run had errors:', totals.errors)
  return NextResponse.json({ ...totals, documentsExpired, documentsReminded, webhooksSent: webhooks.sent, webhooksFailed: webhooks.failed, messagesDelivered: delivered, automationsProcessed: runs.processed, errors: totals.errors.length })
}
