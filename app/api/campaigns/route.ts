import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { audienceSchema, countAudience, describeAudience } from '@/lib/services/audience'
import { campaignStats, funnel, previewCampaign, scheduleCampaign, sendCampaign } from '@/lib/services/campaigns'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'communication.send' }, async ({ ownerId, query }) => {
  // ?count=<audience json> previews how many people a segment reaches.
  const preview = query.get('count')
  if (preview) {
    const parsed = audienceSchema.safeParse(JSON.parse(preview))
    if (!parsed.success) return { count: 0, eligible: 0, blocked: [] }
    // With a channel, also say how many of them may actually be messaged on it, and why the rest may not.
    const channel = query.get('channel')
    if (channel === 'sms' || channel === 'email') {
      const reach = await previewCampaign(ownerId, channel, parsed.data)
      return { count: reach.recipients, eligible: reach.eligible, blocked: reach.blocked }
    }
    return { count: await countAudience(ownerId, parsed.data) }
  }
  const campaigns = await prisma.campaign.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' }, take: 100 })
  const stats = await campaignStats(ownerId, campaigns.map((c) => c.id))
  return campaigns.map((c) => {
    const audience = audienceSchema.safeParse(c.audience)
    return { ...c, audienceLabel: audience.success ? describeAudience(audience.data) : 'Custom audience', stats: funnel(stats.get(c.id)) }
  })
})

const createSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the campaign a name').max(120),
    channel: z.enum(['email', 'sms']),
    subject: z.string().trim().max(200).nullish(),
    body: z.string().trim().min(1, 'Write the message').max(5000),
    audience: audienceSchema,
    send: z.boolean().optional(),
    /** Send later instead of now. */
    scheduledAt: z.string().datetime().nullish(),
  })
  .refine((c) => c.channel !== 'email' || !!c.subject, { message: 'Emails need a subject' })
  .refine((c) => c.channel !== 'sms' || c.body.length <= 1600, { message: 'Texts can be at most 1600 characters' })

// POST - create a campaign, and with send: true deliver it straight away
export const POST = handler(
  { permission: 'communication.send', write: true, body: createSchema, rateLimit: { key: 'campaign', windowMs: 60_000, maxRequests: 10 } },
  async ({ ownerId, body, actor, audit }) => {
    const { send, scheduledAt, ...data } = body
    const campaign = await prisma.campaign.create({ data: { ownerId, ...data, audience: data.audience as Prisma.InputJsonValue, createdByName: actor.name } })
    if (scheduledAt) {
      await scheduleCampaign(ownerId, campaign.id, new Date(scheduledAt))
      await audit('broadcast_schedule', `Scheduled "${campaign.name}" for ${scheduledAt}`, { entityType: 'campaign', entityId: campaign.id })
      return { id: campaign.id, status: 'scheduled', scheduledAt }
    }
    if (!send) return { id: campaign.id, status: 'draft' }
    const result = await sendCampaign(ownerId, campaign.id, { id: actor.id, name: actor.name })
    await audit('broadcast_send', `Sent "${campaign.name}" to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'} (${result.sent} sent, ${result.skipped} not allowed, ${result.remaining} still going out)`, { entityType: 'campaign', entityId: campaign.id, metadata: { ...result } })
    return { id: campaign.id, status: result.remaining ? 'sending' : 'sent', ...result }
  }
)
