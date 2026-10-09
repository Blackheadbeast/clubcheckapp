import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, handler, notFound } from '@/lib/api'
import { sendMessage } from '@/lib/services/messaging'
import { logActivity } from '@/lib/services/core'
import { getPersonThread } from '@/lib/services/sms'

export const dynamic = 'force-dynamic'

// GET - this lead's text thread, with whether they may be texted
export const GET = handler({ permission: ['communication.text', 'communication.send'] }, async ({ ownerId, params, query }) => getPersonThread(ownerId, { prospectId: params.id }, { markRead: query.get('read') === '1' }))

const schema = z.object({ channel: z.enum(['email', 'sms']), subject: z.string().trim().max(200).nullish(), body: z.string().trim().min(1, 'Write a message first').max(5000), clientKey: z.string().min(8).max(80).optional() })

// POST /api/leads/:id/messages - a one-off message to a lead. Texts need the lead's consent (or a text from them first).
export const POST = handler({ permission: ['communication.text', 'communication.send'], write: true, body: schema, rateLimit: { key: 'message', windowMs: 60_000, maxRequests: 30 } }, async ({ ownerId, params, body, actor, can }) => {
  // One-to-one texting does not include email.
  if (body.channel === 'email' && !can('communication.send')) throw new ApiError(403, 'You do not have permission to email leads.', 'forbidden')
  const lead = await prisma.prospect.findFirst({ where: { id: params.id, ownerId }, select: { id: true } })
  if (!lead) throw notFound('Lead')
  const { clientKey, ...content } = body
  const message = await sendMessage({ ownerId, prospectId: lead.id, ...content, kind: 'conversation', staff: { id: actor.id, name: actor.name }, dedupeKey: clientKey ? `direct:${ownerId}:${clientKey}` : null })
  await logActivity(prisma, { ownerId, prospectId: lead.id, type: 'message', actor, title: `${body.channel === 'sms' ? 'SMS' : 'Email'} ${message.status === 'skipped' || message.status === 'failed' ? 'not sent' : 'sent'}`, detail: message.error || undefined })
  return { id: message.id, status: message.status, error: message.error }
})
