import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, handler } from '@/lib/api'
import { logActivity } from '@/lib/services/core'
import { sendMessage } from '@/lib/services/messaging'

export const dynamic = 'force-dynamic'

const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note'), note: z.string().trim().min(1, 'Write a note first').max(4000) }),
  z.object({ type: z.literal('call'), note: z.string().trim().max(4000).optional() }),
  z.object({ type: z.literal('message'), channel: z.enum(['email', 'sms']), subject: z.string().trim().max(200).nullish(), body: z.string().trim().min(1, 'Write a message first').max(5000) }),
])

// POST - log a note or call against a lead, or send them a message
export const POST = handler({ permission: 'leads.manage', write: true, body: schema }, async ({ ownerId, params, body, actor }) => {
  await assertOwned(ownerId, 'prospect', params.id, 'Lead')
  if (body.type === 'message') {
    const message = await sendMessage({ ownerId, prospectId: params.id, channel: body.channel, subject: body.subject, body: body.body })
    await logActivity(prisma, {
      ownerId, prospectId: params.id, type: 'message', actor,
      title: `${body.channel === 'sms' ? 'SMS' : 'Email'} ${message.status === 'sent' ? 'sent' : 'not sent'}${body.subject ? `: ${body.subject}` : ''}`,
      detail: message.error || undefined,
    })
    return { status: message.status, error: message.error }
  }
  await logActivity(prisma, { ownerId, prospectId: params.id, type: body.type, title: body.type === 'call' ? 'Logged a call' : 'Note', detail: body.note, actor })
  if (body.type === 'call') await prisma.prospect.updateMany({ where: { id: params.id, ownerId, contactedAt: null }, data: { contactedAt: new Date() } })
  return { ok: true }
})
