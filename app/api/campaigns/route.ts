import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { audienceSchema, countAudience, describeAudience } from '@/lib/services/audience'
import { campaignStats, funnel, sendCampaign } from '@/lib/services/campaigns'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'communication.send' }, async ({ ownerId, query }) => {
  // ?count=<audience json> previews how many people a segment reaches.
  const preview = query.get('count')
  if (preview) {
    const parsed = audienceSchema.safeParse(JSON.parse(preview))
    return { count: parsed.success ? await countAudience(ownerId, parsed.data) : 0 }
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
  })
  .refine((c) => c.channel !== 'email' || !!c.subject, { message: 'Emails need a subject' })

// POST - create a campaign, and with send: true deliver it straight away
export const POST = handler(
  { permission: 'communication.send', write: true, body: createSchema, rateLimit: { key: 'campaign', windowMs: 60_000, maxRequests: 10 } },
  async ({ ownerId, body, actor, audit }) => {
    const { send, ...data } = body
    const campaign = await prisma.campaign.create({ data: { ownerId, ...data, audience: data.audience as Prisma.InputJsonValue, createdByName: actor.name } })
    if (!send) return { id: campaign.id, status: 'draft' }
    const result = await sendCampaign(ownerId, campaign.id)
    await audit('broadcast_send', `Sent "${campaign.name}" to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'} (${result.sent} delivered to the provider)`, { entityType: 'campaign', entityId: campaign.id, metadata: result })
    return { id: campaign.id, status: 'sent', ...result }
  }
)
