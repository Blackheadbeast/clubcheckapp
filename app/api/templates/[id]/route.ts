import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  channel: z.enum(['email', 'sms']),
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1).max(5000),
})

export const PATCH = handler({ permission: 'communication.send', write: true, body: schema }, async ({ ownerId, params, body }) => {
  const result = await prisma.messageTemplate.updateMany({ where: { id: params.id, ownerId }, data: { ...body, subject: body.channel === 'email' ? body.subject : null } })
  if (result.count === 0) throw notFound('Template')
  return { ok: true }
})

export const DELETE = handler({ permission: 'communication.send', write: true }, async ({ ownerId, params }) => {
  const result = await prisma.messageTemplate.deleteMany({ where: { id: params.id, ownerId } })
  if (result.count === 0) throw notFound('Template')
  return { deleted: true }
})
