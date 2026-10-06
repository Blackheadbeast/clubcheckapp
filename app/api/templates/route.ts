import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  channel: z.enum(['email', 'sms']),
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1, 'Write the message').max(5000),
})

export const GET = handler({ permission: 'communication.send' }, async ({ ownerId }) => prisma.messageTemplate.findMany({ where: { ownerId }, orderBy: { name: 'asc' } }))

export const POST = handler({ permission: 'communication.send', write: true, body: schema }, async ({ ownerId, body }) =>
  prisma.messageTemplate.create({ data: { ownerId, ...body, subject: body.channel === 'email' ? body.subject : null } })
)
