import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { automationSchema } from '@/lib/services/automations'

export const dynamic = 'force-dynamic'

export const GET = handler({ permission: 'automations.manage' }, async ({ ownerId, params }) => {
  const automation = await prisma.automation.findFirst({ where: { id: params.id, ownerId } })
  if (!automation) throw notFound('Automation')
  const runs = await prisma.automationRun.findMany({ where: { automationId: automation.id }, orderBy: { createdAt: 'desc' }, take: 30 })
  const members = await prisma.member.findMany({ where: { id: { in: runs.map((r) => r.memberId).filter(Boolean) as string[] } }, select: { id: true, name: true } })
  const leads = await prisma.prospect.findMany({ where: { id: { in: runs.map((r) => r.prospectId).filter(Boolean) as string[] } }, select: { id: true, name: true } })
  return {
    ...automation,
    runs: runs.map((r) => ({ id: r.id, status: r.status, runAt: r.runAt, executedAt: r.executedAt, error: r.error, recipient: members.find((m) => m.id === r.memberId)?.name || leads.find((l) => l.id === r.prospectId)?.name || 'Unknown' })),
  }
})

export const PATCH = handler({ permission: 'automations.manage', write: true, body: automationSchema.partial() }, async ({ ownerId, params, body, audit }) => {
  const before = await prisma.automation.findFirst({ where: { id: params.id, ownerId } })
  if (!before) throw notFound('Automation')
  const automation = await prisma.automation.update({ where: { id: before.id }, data: { ...body, conditions: body.conditions === undefined ? undefined : ((body.conditions || {}) as Prisma.InputJsonValue) } })
  if (body.isActive !== undefined && body.isActive !== before.isActive) {
    await audit('automation.toggle', `Turned ${automation.isActive ? 'on' : 'off'} automation ${automation.name}`, { entityType: 'automation', entityId: automation.id })
    // Switching off cancels anything still waiting on its delay.
    if (!automation.isActive) await prisma.automationRun.updateMany({ where: { automationId: automation.id, status: 'pending' }, data: { status: 'skipped', error: 'Automation was turned off', executedAt: new Date() } })
  }
  return automation
})

export const DELETE = handler({ permission: 'automations.manage', write: true }, async ({ ownerId, params, audit }) => {
  const automation = await prisma.automation.findFirst({ where: { id: params.id, ownerId } })
  if (!automation) throw notFound('Automation')
  await prisma.automation.delete({ where: { id: automation.id } })
  await audit('automation.delete', `Deleted automation ${automation.name}`, { entityType: 'automation', entityId: automation.id })
  return { deleted: true }
})
