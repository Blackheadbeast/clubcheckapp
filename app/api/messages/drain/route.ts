import { handler } from '@/lib/api'
import { drainOutbox } from '@/lib/services/outbox'
import { outboxRemaining } from '@/lib/services/messaging'

export const dynamic = 'force-dynamic'

// POST /api/messages/drain?campaignId= - send the next batch waiting in this gym's outbox.
// A screen showing a campaign in progress calls this until nothing remains.
export const POST = handler({ permission: 'communication.send', write: true, rateLimit: { key: 'drain', windowMs: 60_000, maxRequests: 120 } }, async ({ ownerId, query }) => {
  const done = await drainOutbox(ownerId, 40)
  return { ...done, remaining: await outboxRemaining(ownerId, query.get('campaignId') || undefined) }
})
