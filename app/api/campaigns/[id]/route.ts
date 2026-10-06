import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { campaignStats, funnel, sendCampaign } from '@/lib/services/campaigns'

export const dynamic = 'force-dynamic'

// GET - campaign with per-recipient delivery
export const GET = handler({ permission: 'communication.send' }, async ({ ownerId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, ownerId } })
  if (!campaign) throw notFound('Campaign')
  const [messages, stats] = await Promise.all([
    prisma.message.findMany({
      where: { ownerId, campaignId: campaign.id }, orderBy: { createdAt: 'asc' }, take: 1000,
      select: { id: true, status: true, error: true, toAddress: true, openedAt: true, member: { select: { id: true, name: true } }, prospect: { select: { id: true, name: true } } },
    }),
    campaignStats(ownerId, [campaign.id]),
  ])
  return { ...campaign, stats: funnel(stats.get(campaign.id)), messages }
})

export const POST = handler({ permission: 'communication.send', write: true, body: z.object({ action: z.literal('send') }) }, async ({ ownerId, params, audit }) => {
  const result = await sendCampaign(ownerId, params.id)
  await audit('broadcast_send', `Sent a campaign to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}`, { entityType: 'campaign', entityId: params.id, metadata: result })
  return result
})

export const DELETE = handler({ permission: 'communication.send', write: true }, async ({ ownerId, params }) => {
  const result = await prisma.campaign.deleteMany({ where: { id: params.id, ownerId, status: 'draft' } })
  if (result.count === 0) throw notFound('Draft campaign')
  return { deleted: true }
})
