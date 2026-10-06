import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { handler } from '@/lib/api'
import { TRIGGERS, automationSchema, installDefaultAutomations } from '@/lib/services/automations'
import { MERGE_TAGS, emailConfigured } from '@/lib/services/messaging'
import { getSmsProvider } from '@/lib/messaging/sms'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'automations.manage' }, async ({ ownerId }) => {
  // First visit: give the gym a ready-made (switched off) automation for every trigger.
  await installDefaultAutomations(ownerId)
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [automations, runs] = await Promise.all([
    prisma.automation.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } }),
    prisma.automationRun.groupBy({ by: ['automationId', 'status'], where: { ownerId, createdAt: { gte: since } }, _count: { _all: true } }),
  ])
  return {
    automations: automations.map((a) => {
      const mine = runs.filter((r) => r.automationId === a.id)
      const count = (status: string) => mine.find((r) => r.status === status)?._count._all || 0
      return { ...a, last30: { sent: count('sent'), pending: count('pending'), skipped: count('skipped'), failed: count('failed') } }
    }),
    triggers: TRIGGERS,
    mergeTags: MERGE_TAGS,
    delivery: { email: emailConfigured(), sms: !!getSmsProvider() },
  }
})

export const POST = handler({ permission: 'automations.manage', write: true, body: automationSchema }, async ({ ownerId, body, audit }) => {
  const automation = await prisma.automation.create({ data: { ownerId, ...body, conditions: (body.conditions || undefined) as Prisma.InputJsonValue | undefined } })
  await audit('automation.create', `Created automation ${automation.name}`, { entityType: 'automation', entityId: automation.id })
  return automation
})
