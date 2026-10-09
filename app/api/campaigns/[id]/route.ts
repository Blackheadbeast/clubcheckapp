import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { cancelScheduledCampaign, campaignStats, finishCampaign, funnel, scheduleCampaign, sendCampaign } from '@/lib/services/campaigns'

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
  const progress = await finishCampaign(ownerId, campaign.id)
  return { ...campaign, status: campaign.status === 'sending' && progress.remaining === 0 ? 'sent' : campaign.status, stats: funnel(stats.get(campaign.id)), progress, messages }
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send') }),
  z.object({ action: z.literal('schedule'), scheduledAt: z.string().datetime() }),
  z.object({ action: z.literal('cancel') }),
])

// POST { action: send | schedule | cancel }
export const POST = handler({ permission: 'communication.send', write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit }) => {
  if (body.action === 'schedule') {
    await scheduleCampaign(ownerId, params.id, new Date(body.scheduledAt))
    await audit('broadcast_schedule', `Scheduled a campaign for ${body.scheduledAt}`, { entityType: 'campaign', entityId: params.id })
    return { status: 'scheduled', scheduledAt: body.scheduledAt }
  }
  if (body.action === 'cancel') {
    await cancelScheduledCampaign(ownerId, params.id)
    await audit('broadcast_cancel', 'Cancelled a scheduled campaign', { entityType: 'campaign', entityId: params.id })
    return { status: 'draft' }
  }
  const result = await sendCampaign(ownerId, params.id, { id: actor.id, name: actor.name })
  await audit('broadcast_send', `Sent a campaign to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}`, { entityType: 'campaign', entityId: params.id, metadata: { ...result } })
  return result
})

export const DELETE = handler({ permission: 'communication.send', write: true }, async ({ ownerId, params }) => {
  const result = await prisma.campaign.deleteMany({ where: { id: params.id, ownerId, status: { in: ['draft', 'scheduled'] } } })
  if (result.count === 0) throw notFound('Draft campaign')
  return { deleted: true }
})
