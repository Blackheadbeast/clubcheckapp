// Working the outbox: everything that is due right now, for one gym or all of them.
//
// Nothing here is scheduled by itself. It is called by the minute-level cron
// endpoint, by the daily platform cron, by staff screens that are open, and
// after webhooks, and it is safe for any number of those to overlap: every
// message and run is claimed before it is sent. Reminders carry their own
// deadline, so whatever runs late is dropped rather than sent late.

import { processDueRuns } from './automations'
import { runScheduledCampaigns } from './campaigns'
import { deliverQueued } from './messaging'
import { deliverDue } from './webhooks'

export async function drainOutbox(ownerId?: string, limit = 40) {
  const campaigns = await runScheduledCampaigns(ownerId)
  const runs = await processDueRuns(ownerId, limit)
  const delivered = await deliverQueued(ownerId, limit)
  // Campaigns that just emptied are closed out.
  if (delivered > 0) await runScheduledCampaigns(ownerId)
  // Webhooks waiting for their first attempt or a retry.
  const webhooks = await deliverDue({ ownerId, limit })
  return { campaignsStarted: campaigns, runs: runs.processed, delivered, webhooksSent: webhooks.sent, webhooksFailed: webhooks.failed }
}
