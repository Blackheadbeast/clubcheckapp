import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Paginated, handler, paging } from '@/lib/api'
import { emailConfigured } from '@/lib/services/messaging'
import { getSmsProvider } from '@/lib/messaging/sms'

export const dynamic = 'force-dynamic'

// GET /api/messages?channel=&status=&source=&search= - everything sent, by anyone or anything
export const GET = handler({ permission: 'communication.send' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = paging(query)
  const search = (query.get('search') || '').trim()
  const source = query.get('source')
  const where: Prisma.MessageWhereInput = {
    ownerId,
    ...(query.get('channel') && { channel: query.get('channel')! }),
    ...(query.get('status') && { status: query.get('status')! }),
    ...(source === 'automation' && { automationId: { not: null } }),
    ...(source === 'campaign' && { campaignId: { not: null } }),
    ...(source === 'direct' && { automationId: null, campaignId: null }),
    ...(search && { OR: [{ subject: { contains: search, mode: 'insensitive' } }, { toAddress: { contains: search, mode: 'insensitive' } }, { member: { name: { contains: search, mode: 'insensitive' } } }, { prospect: { name: { contains: search, mode: 'insensitive' } } }] }),
  }
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [messages, total, counts] = await Promise.all([
    prisma.message.findMany({
      where, orderBy: { createdAt: 'desc' }, skip, take,
      select: { id: true, channel: true, subject: true, body: true, status: true, error: true, toAddress: true, createdAt: true, member: { select: { id: true, name: true } }, prospect: { select: { id: true, name: true } }, campaign: { select: { name: true } }, automation: { select: { name: true } } },
    }),
    prisma.message.count({ where }),
    prisma.message.groupBy({ by: ['status'], where: { ownerId, createdAt: { gte: since } }, _count: { _all: true } }),
  ])
  const last30: Record<string, number> = {}
  for (const c of counts) last30[c.status] = c._count._all
  return new Paginated(messages, total, page, pageSize, { last30, delivery: { email: emailConfigured(), sms: !!getSmsProvider() } })
})
