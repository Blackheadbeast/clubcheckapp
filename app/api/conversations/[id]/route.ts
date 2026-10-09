import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, assertOwned, handler, notFound } from '@/lib/api'
import { sendMessage } from '@/lib/services/messaging'
import { getConversation, markConversationRead, peopleWithPhone } from '@/lib/services/sms'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/conversations/:id?read=1 - one thread, oldest first. read=1 clears its unread count.
export const GET = handler({ permission: ['communication.text', 'communication.send'] }, async ({ ownerId, params, query }) => getConversation(ownerId, params.id, { markRead: query.get('read') === '1' }))

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), body: z.string().trim().min(1, 'Write a message first').max(1600), templateId: z.string().uuid().nullish(), clientKey: z.string().min(8).max(80).optional() }),
  z.object({ action: z.literal('read') }),
  z.object({ action: z.literal('resolve'), needsResponse: z.boolean() }),
  z.object({ action: z.literal('assign'), staffId: z.string().uuid().nullable() }),
  z.object({ action: z.literal('link'), memberId: z.string().uuid() }),
])

// POST { action } - reply, mark read, mark as (not) needing a response, assign, or attach to a member
export const POST = handler({ permission: ['communication.text', 'communication.send'], write: true, body: schema, rateLimit: { key: 'sms-reply', windowMs: 60_000, maxRequests: 60 } }, async ({ ownerId, params, body, actor, audit }) => {
  const conversation = await prisma.smsConversation.findFirst({ where: { id: params.id, ownerId } })
  if (!conversation) throw notFound('Conversation')

  if (body.action === 'reply') {
    // The recipient is whoever the thread belongs to. Nothing in the request can redirect it.
    const message = await sendMessage({
      ownerId, channel: 'sms', conversationId: conversation.id, body: body.body, kind: 'conversation', templateId: body.templateId,
      staff: { id: actor.id, name: actor.name }, dedupeKey: body.clientKey ? `direct:${ownerId}:${body.clientKey}` : null,
    })
    if (conversation.memberId) {
      await logActivity(prisma, { ownerId, memberId: conversation.memberId, type: 'message', actor, title: `SMS ${message.status === 'skipped' || message.status === 'failed' ? 'not sent' : 'sent'}`, detail: message.error || undefined, metadata: { messageId: message.id } })
    }
    await audit('sms.send', `Texted ${conversation.phone}${message.status === 'skipped' ? ` (not sent: ${message.error})` : ''}`, { entityType: 'message', entityId: message.id, metadata: { conversationId: conversation.id, memberId: conversation.memberId, status: message.status } })
    return { id: message.id, status: message.status, error: message.error }
  }
  if (body.action === 'read') {
    await markConversationRead(ownerId, conversation.id)
    return { ok: true }
  }
  if (body.action === 'resolve') {
    await markConversationRead(ownerId, conversation.id, body.needsResponse)
    return { ok: true }
  }
  if (body.action === 'assign') {
    await assertOwned(ownerId, 'staff', body.staffId, 'Staff member')
    await prisma.smsConversation.update({ where: { id: conversation.id }, data: { assignedStaffId: body.staffId } })
    return { ok: true }
  }
  // Attach an unknown number to a member, but only one whose number on file really is this one.
  const { members } = await peopleWithPhone(prisma, ownerId, conversation.phone)
  if (!members.some((m) => m.id === body.memberId)) throw new ApiError(409, 'That member does not have this phone number on file. Update their number first.', 'phone_mismatch')
  await prisma.$transaction([
    prisma.smsConversation.update({ where: { id: conversation.id }, data: { memberId: body.memberId, prospectId: null } }),
    prisma.message.updateMany({ where: { ownerId, conversationId: conversation.id, memberId: null }, data: { memberId: body.memberId } }),
  ])
  await audit('sms.link', `Attached ${conversation.phone} to a member`, { entityType: 'member', entityId: body.memberId })
  return { ok: true }
})
