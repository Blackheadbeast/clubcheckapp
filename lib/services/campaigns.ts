// Campaigns: one message to an audience segment, with per-recipient delivery records.
//
// Sending a campaign only puts its messages in the outbox. They are then worked
// through a few at a time (deliverQueued), so a thousand recipients never run
// inside one web request, a provider rate limit only slows things down, and a
// retry can never send the same person the same campaign twice.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, notFound } from '@/lib/api'
import { Audience, audienceSchema, resolveAudience } from './audience'
import { Channel, deliverQueued, outboxRemaining, queueMessage } from './messaging'

/** The most one campaign may address; larger sends should be split by segment. */
export const MAX_CAMPAIGN_RECIPIENTS = 5000

export interface CampaignResult {
  recipients: number
  queued: number
  sent: number
  skipped: number
  failed: number
  remaining: number
}

async function tally(ownerId: string, campaignId: string, recipients: number): Promise<CampaignResult> {
  const rows = await prisma.message.groupBy({ by: ['status'], where: { ownerId, campaignId }, _count: { _all: true } })
  const n = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r._count._all, 0)
  return { recipients, queued: n('queued', 'sending'), sent: n('sent', 'delivered', 'opened', 'clicked'), skipped: n('skipped', 'expired'), failed: n('failed', 'undelivered'), remaining: n('queued', 'sending') }
}

/**
 * Put a campaign's messages in the outbox. Marketing consent is checked per recipient as each
 * message is queued; anyone who may not be messaged is recorded as skipped with the reason.
 */
export async function sendCampaign(ownerId: string, campaignId: string, staff?: { id?: string | null; name?: string | null }) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId } })
  if (!campaign) throw notFound('Campaign')
  // Claim it first so a double click (or a scheduler overlapping a person) cannot send it twice.
  const claimed = await prisma.campaign.updateMany({ where: { id: campaign.id, status: { in: ['draft', 'scheduled'] } }, data: { status: 'sending' } })
  if (claimed.count === 0) throw badRequest('This campaign has already been sent.', 'already_sent')

  const audience = audienceSchema.parse(campaign.audience) as Audience
  const { memberIds, prospectIds } = await resolveAudience(ownerId, audience)
  const recipients = [...memberIds.map((id) => ({ memberId: id, key: `m:${id}` })), ...prospectIds.map((id) => ({ prospectId: id, key: `p:${id}` }))]
  if (recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: campaign.scheduledAt ? 'scheduled' : 'draft' } })
    throw badRequest(`This audience has ${recipients.length} people. Send to at most ${MAX_CAMPAIGN_RECIPIENTS} at a time by narrowing the segment.`, 'audience_too_large')
  }
  await prisma.campaign.update({ where: { id: campaign.id }, data: { recipientCount: recipients.length } })
  // Queue in small batches: each is quick, and the key means a crash and re-run picks up without repeats.
  for (let i = 0; i < recipients.length; i += 20) {
    await Promise.all(recipients.slice(i, i + 20).map(({ key, ...who }) =>
      queueMessage(prisma, { ownerId, channel: campaign.channel as Channel, subject: campaign.subject, body: campaign.body, campaignId: campaign.id, kind: 'marketing', staff, dedupeKey: `camp:${campaign.id}:${key}`, ...who })
    ))
  }
  // Make a start now so small sends finish in this request; the rest is worked off by the outbox.
  await deliverQueued(ownerId, 25)
  return finishCampaign(ownerId, campaign.id, recipients.length)
}

/** Mark a campaign sent once nothing of it is left in the outbox, and report where it stands. */
export async function finishCampaign(ownerId: string, campaignId: string, recipients?: number) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId } })
  if (!campaign) throw notFound('Campaign')
  const result = await tally(ownerId, campaignId, recipients ?? campaign.recipientCount)
  if (campaign.status === 'sending' && result.remaining === 0) await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'sent', sentAt: new Date() } })
  return result
}

/** Send campaigns whose scheduled time has come, and close out any that have finished. */
export async function runScheduledCampaigns(ownerId?: string, now = new Date()) {
  const due = await prisma.campaign.findMany({ where: { status: 'scheduled', scheduledAt: { lte: now }, ...(ownerId && { ownerId }) }, select: { id: true, ownerId: true }, take: 20 })
  for (const c of due) await sendCampaign(c.ownerId, c.id).catch((error) => console.error('[campaigns] scheduled send failed', c.id, error instanceof Error ? error.message : error))
  const sending = await prisma.campaign.findMany({ where: { status: 'sending', ...(ownerId && { ownerId }) }, select: { id: true, ownerId: true }, take: 50 })
  for (const c of sending) await finishCampaign(c.ownerId, c.id)
  return due.length
}

export async function scheduleCampaign(ownerId: string, campaignId: string, at: Date) {
  if (at.getTime() < Date.now() + 60_000) throw badRequest('Choose a time at least a minute from now.', 'too_soon')
  const result = await prisma.campaign.updateMany({ where: { id: campaignId, ownerId, status: { in: ['draft', 'scheduled'] } }, data: { status: 'scheduled', scheduledAt: at } })
  if (result.count === 0) throw badRequest('Only a draft can be scheduled.', 'not_draft')
}

/** Back to a draft. Only works while it has not started sending. */
export async function cancelScheduledCampaign(ownerId: string, campaignId: string) {
  const result = await prisma.campaign.updateMany({ where: { id: campaignId, ownerId, status: 'scheduled' }, data: { status: 'draft', scheduledAt: null } })
  if (result.count === 0) throw badRequest('This campaign is not scheduled, or has already started sending.', 'not_scheduled')
}

/** Who a campaign would reach on this channel, and who would be left out and why, without sending anything. */
export async function previewCampaign(ownerId: string, channel: Channel, audience: Audience) {
  const { memberIds, prospectIds } = await resolveAudience(ownerId, audience)
  const [members, prospects] = await Promise.all([
    prisma.member.findMany({ where: { ownerId, id: { in: memberIds } }, select: { email: true, phone: true, emailOptIn: true, smsMarketingOptIn: true, smsStopped: true } }),
    prisma.prospect.findMany({ where: { ownerId, id: { in: prospectIds } }, select: { email: true, phone: true, smsOptIn: true, smsStopped: true } }),
  ])
  const { toE164 } = await import('@/lib/messaging/sms')
  const reasons: Record<string, number> = {}
  const block = (reason: string) => { reasons[reason] = (reasons[reason] || 0) + 1 }
  let eligible = 0
  for (const m of members) {
    if (channel === 'email') { if (!m.email) block('No email address'); else if (!m.emailOptIn) block('Opted out of email'); else eligible++; continue }
    if (!toE164(m.phone)) block('No valid mobile number'); else if (m.smsStopped) block('Replied STOP'); else if (!m.smsMarketingOptIn) block('No consent to marketing texts'); else eligible++
  }
  for (const p of prospects) {
    if (channel === 'email') { if (!p.email) block('No email address'); else eligible++; continue }
    if (!toE164(p.phone)) block('No valid mobile number'); else if (p.smsStopped) block('Replied STOP'); else if (!p.smsOptIn) block('Lead has not agreed to texts'); else eligible++
  }
  return { recipients: members.length + prospects.length, eligible, blocked: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) }
}

export async function campaignStats(ownerId: string, campaignIds: string[]) {
  if (campaignIds.length === 0) return new Map<string, Record<string, number>>()
  const rows = await prisma.message.groupBy({ by: ['campaignId', 'status'], where: { ownerId, campaignId: { in: campaignIds } }, _count: { _all: true } })
  const stats = new Map<string, Record<string, number>>()
  for (const row of rows) {
    const entry = stats.get(row.campaignId!) || {}
    entry[row.status] = row._count._all
    stats.set(row.campaignId!, entry)
  }
  return stats
}

/** Collapse raw statuses into the funnel a campaign report shows. Later stages imply the earlier ones. */
export function funnel(counts: Record<string, number> = {}) {
  const clicked = counts.clicked || 0
  const opened = (counts.opened || 0) + clicked
  const delivered = (counts.delivered || 0) + opened
  const sent = (counts.sent || 0) + delivered
  return { sent, delivered, opened, clicked, failed: (counts.failed || 0) + (counts.undelivered || 0), skipped: (counts.skipped || 0) + (counts.expired || 0), queued: (counts.queued || 0) + (counts.sending || 0) }
}

export { outboxRemaining }
export type CampaignAudienceJson = Prisma.InputJsonValue
