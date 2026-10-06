// Campaigns: one message to an audience segment, with per-recipient delivery records.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, notFound } from '@/lib/api'
import { Audience, audienceSchema, resolveAudience } from './audience'
import { Channel, sendMessage } from './messaging'

/** Keeps a single request from running for minutes; larger sends should be split by segment. */
export const MAX_CAMPAIGN_RECIPIENTS = 1000

export async function sendCampaign(ownerId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId } })
  if (!campaign) throw notFound('Campaign')
  // Claim it first so a double click cannot send it twice.
  const claimed = await prisma.campaign.updateMany({ where: { id: campaign.id, status: 'draft' }, data: { status: 'sending' } })
  if (claimed.count === 0) throw badRequest('This campaign has already been sent.', 'already_sent')

  const audience = audienceSchema.parse(campaign.audience) as Audience
  const { memberIds, prospectIds } = await resolveAudience(ownerId, audience)
  const recipients = [...memberIds.map((id) => ({ memberId: id })), ...prospectIds.map((id) => ({ prospectId: id }))]
  if (recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'draft' } })
    throw badRequest(`This audience has ${recipients.length} people. Send to at most ${MAX_CAMPAIGN_RECIPIENTS} at a time by narrowing the segment.`, 'audience_too_large')
  }

  const tally = { sent: 0, skipped: 0, failed: 0 }
  try {
    // A few at a time: fast enough for a gym-sized list, gentle on the email provider's rate limit.
    for (let i = 0; i < recipients.length; i += 5) {
      const results = await Promise.all(
        recipients.slice(i, i + 5).map((r) => sendMessage({ ownerId, channel: campaign.channel as Channel, subject: campaign.subject, body: campaign.body, campaignId: campaign.id, ...r }))
      )
      for (const m of results) {
        if (m.status === 'sent') tally.sent++
        else if (m.status === 'failed') tally.failed++
        else tally.skipped++
      }
    }
  } finally {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'sent', sentAt: new Date(), recipientCount: recipients.length } })
  }
  return { ...tally, recipients: recipients.length }
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
  return { sent, delivered, opened, clicked, failed: counts.failed || 0, skipped: counts.skipped || 0 }
}

export type CampaignAudienceJson = Prisma.InputJsonValue
