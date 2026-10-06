import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { sendMessage } from '@/lib/services/messaging'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  return prisma.message.findMany({
    where: { ownerId, memberId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, channel: true, subject: true, body: true, status: true, error: true, createdAt: true, sentAt: true, openedAt: true, automation: { select: { name: true } }, campaign: { select: { name: true } } },
  })
})

const sendSchema = z.object({
  channel: z.enum(['email', 'sms']),
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1, 'Write a message first').max(5000),
})

// Send a one-off message to this member.
export const POST = handler(
  { permission: 'communication.send', write: true, body: sendSchema, rateLimit: { key: 'message', windowMs: 60_000, maxRequests: 30 } },
  async ({ ownerId, params, body, actor }) => {
    await assertOwned(ownerId, 'member', params.id, 'Member')
    const message = await sendMessage({ ownerId, memberId: params.id, ...body })
    await logActivity(prisma, {
      ownerId, memberId: params.id, type: 'message', actor,
      title: `${body.channel === 'sms' ? 'SMS' : 'Email'} ${message.status === 'sent' ? 'sent' : 'not sent'}${body.subject ? `: ${body.subject}` : ''}`,
      detail: message.error || undefined, metadata: { messageId: message.id },
    })
    return { id: message.id, status: message.status, error: message.error }
  }
)
