import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, handler } from '@/lib/api'
import { sendMessage } from '@/lib/services/messaging'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  return prisma.message.findMany({
    where: { ownerId, memberId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, channel: true, direction: true, kind: true, staffName: true, subject: true, body: true, status: true, error: true, createdAt: true, sentAt: true, openedAt: true, automation: { select: { name: true } }, campaign: { select: { name: true } } },
  })
})

const sendSchema = z.object({
  channel: z.enum(['email', 'sms']),
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1, 'Write a message first').max(5000),
  templateId: z.string().uuid().nullish(),
  /** Sent by the browser with each compose: the same key twice is the same message. */
  clientKey: z.string().min(8).max(80).optional(),
})

// Send a one-off message to this member.
export const POST = handler(
  { permission: ['communication.text', 'communication.send'], write: true, body: sendSchema, rateLimit: { key: 'message', windowMs: 60_000, maxRequests: 30 } },
  async ({ ownerId, params, body, actor, can }) => {
    await assertOwned(ownerId, 'member', params.id, 'Member')
    // Roles that only text one to one (front desk) cannot send email from here.
    if (body.channel === 'email' && !can('communication.send')) throw new ApiError(403, 'You do not have permission to email members.', 'forbidden')
    const { clientKey, ...content } = body
    const message = await sendMessage({ ownerId, memberId: params.id, ...content, kind: 'conversation', staff: { id: actor.id, name: actor.name }, dedupeKey: clientKey ? `direct:${ownerId}:${clientKey}` : null })
    await logActivity(prisma, {
      ownerId, memberId: params.id, type: 'message', actor,
      title: `${body.channel === 'sms' ? 'SMS' : 'Email'} ${message.status === 'sent' ? 'sent' : 'not sent'}${body.subject ? `: ${body.subject}` : ''}`,
      detail: message.error || undefined, metadata: { messageId: message.id },
    })
    return { id: message.id, status: message.status, error: message.error, conversationId: message.conversationId }
  }
)
