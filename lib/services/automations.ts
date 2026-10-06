// Automation engine: trigger -> conditions -> delay -> message.
//
// Event triggers enqueue an AutomationRun when something happens (fireTrigger).
// Scheduled triggers are found by a periodic scan (scanScheduledTriggers).
// Either way the run is delivered by processDueRuns once its delay has passed,
// and (automationId, dedupeKey) guarantees an event never fires twice.

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { formatDate, formatDateTime } from '@/lib/format'
import { Db, getGymSettings } from './core'
import { Channel, deliverQueued, sendMessage } from './messaging'

export interface TriggerDef {
  key: string
  label: string
  description: string
  audience: 'member' | 'lead'
  kind: 'event' | 'scheduled'
  /** Numeric condition this trigger understands, if any. */
  condition?: { key: 'inactiveDays' | 'daysBefore'; label: string; default: number }
  defaultSubject: string
  defaultBody: string
}

export const TRIGGERS: TriggerDef[] = [
  {
    key: 'lead_created', label: 'New lead', description: 'A lead is added to the pipeline.', audience: 'lead', kind: 'event',
    defaultSubject: 'Welcome to {{gym_name}}',
    defaultBody: "Hi {{first_name}},\n\nThanks for your interest in {{gym_name}}! We'd love to have you in for a free trial class. Reply to this email and we'll find a time that works.\n\nTalk soon,\n{{gym_name}}",
  },
  {
    key: 'trial_booked', label: 'Trial booked', description: 'A trial visit is scheduled for a lead.', audience: 'lead', kind: 'event',
    defaultSubject: 'Your trial at {{gym_name}} is booked',
    defaultBody: "Hi {{first_name}},\n\nYou're booked for a trial on {{date}}. Wear something comfortable, bring water, and arrive 10 minutes early so we can show you around.\n\nSee you soon!",
  },
  {
    key: 'trial_reminder', label: 'Trial tomorrow', description: 'The day before a scheduled trial.', audience: 'lead', kind: 'scheduled',
    defaultSubject: 'See you tomorrow at {{gym_name}}',
    defaultBody: 'Hi {{first_name}},\n\nJust a reminder that your trial is tomorrow, {{date}}. Reply here if anything has changed.',
  },
  {
    key: 'trial_completed', label: 'Trial completed', description: 'A lead finishes their trial visit.', audience: 'lead', kind: 'event',
    defaultSubject: 'How was your first visit?',
    defaultBody: "Hi {{first_name}},\n\nThanks for coming in! We hope you enjoyed it. If you're ready to get started, reply and we'll set up your membership.",
  },
  {
    key: 'member_joined', label: 'New member', description: 'Someone buys their first membership.', audience: 'member', kind: 'event',
    defaultSubject: 'Welcome to {{gym_name}}!',
    defaultBody: "Hi {{first_name}},\n\nWelcome to {{gym_name}}! Your {{membership_name}} membership is active. Book classes and see your check-in code here:\n{{portal_link}}",
  },
  {
    key: 'member_inactive', label: 'Member inactive', description: 'An active member has not visited for a while.', audience: 'member', kind: 'scheduled',
    condition: { key: 'inactiveDays', label: 'Days without a visit', default: 14 },
    defaultSubject: 'We miss you at {{gym_name}}',
    defaultBody: "Hi {{first_name}},\n\nWe haven't seen you in a little while. Your spot is waiting. Book your next class here:\n{{portal_link}}",
  },
  {
    key: 'payment_failed', label: 'Payment failed', description: 'A payment fails or a membership goes past due.', audience: 'member', kind: 'event',
    defaultSubject: 'Action needed: payment issue at {{gym_name}}',
    defaultBody: "Hi {{first_name}},\n\nWe weren't able to collect {{amount}} for your {{membership_name}} membership. Please update your payment details or stop by the front desk so your membership stays active.",
  },
  {
    key: 'membership_expiring', label: 'Membership expiring', description: 'A membership or pack is about to end.', audience: 'member', kind: 'scheduled',
    condition: { key: 'daysBefore', label: 'Days before it ends', default: 7 },
    defaultSubject: 'Your {{membership_name}} ends soon',
    defaultBody: 'Hi {{first_name}},\n\nYour {{membership_name}} at {{gym_name}} ends on {{date}}. Reply to renew or stop by the front desk.',
  },
  {
    key: 'birthday', label: 'Birthday', description: "On a member's birthday.", audience: 'member', kind: 'scheduled',
    defaultSubject: 'Happy birthday from {{gym_name}}!',
    defaultBody: 'Happy birthday, {{first_name}}! Everyone at {{gym_name}} hopes you have a great day.',
  },
  {
    key: 'class_missed', label: 'Missed class', description: 'A member is marked as a no-show.', audience: 'member', kind: 'event',
    defaultSubject: 'We missed you in {{class_name}}',
    defaultBody: "Hi {{first_name}},\n\nWe missed you at {{class_name}} on {{class_time}}. Hope everything's OK. Book your next class here:\n{{portal_link}}",
  },
]

export const TRIGGER_KEYS = TRIGGERS.map((t) => t.key)
export const getTrigger = (key: string) => TRIGGERS.find((t) => t.key === key)

export const automationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  trigger: z.string().refine((t) => TRIGGER_KEYS.includes(t), 'Unknown trigger'),
  conditions: z.record(z.string(), z.number().int().min(1).max(365)).nullish(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30),
  channel: z.enum(['email', 'sms']),
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1, 'Write the message').max(5000),
  isActive: z.boolean(),
})

export interface TriggerTarget {
  memberId?: string | null
  prospectId?: string | null
  /** Identifies the underlying event so repeats are ignored. */
  dedupeKey: string
  context?: Record<string, string | undefined>
}

/** Queue runs for every active automation listening to this trigger. Safe inside a transaction. */
export async function fireTrigger(db: Db, ownerId: string, trigger: string, target: TriggerTarget) {
  const automations = await db.automation.findMany({ where: { ownerId, trigger, isActive: true } })
  if (automations.length === 0) return 0
  const now = Date.now()
  const result = await db.automationRun.createMany({
    data: automations.map((a) => ({
      ownerId,
      automationId: a.id,
      memberId: target.memberId || null,
      prospectId: target.prospectId || null,
      dedupeKey: target.dedupeKey,
      runAt: new Date(now + a.delayMinutes * 60_000),
      context: (target.context || {}) as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  })
  return result.count
}

/** Deliver runs whose delay has elapsed. */
export async function processDueRuns(ownerId?: string, limit = 100) {
  const due = await prisma.automationRun.findMany({
    where: { status: 'pending', runAt: { lte: new Date() }, ...(ownerId && { ownerId }) },
    orderBy: { runAt: 'asc' },
    take: limit,
    include: { automation: true },
  })
  let sent = 0
  for (const run of due) {
    // Claim the run so an overlapping worker cannot send it twice.
    const claimed = await prisma.automationRun.updateMany({ where: { id: run.id, status: 'pending' }, data: { status: 'processing' } })
    if (claimed.count === 0) continue
    try {
      if (!run.automation.isActive) {
        await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'skipped', executedAt: new Date(), error: 'Automation was turned off' } })
        continue
      }
      const message = await sendMessage({
        ownerId: run.ownerId,
        channel: run.automation.channel as Channel,
        memberId: run.memberId,
        prospectId: run.prospectId,
        subject: run.automation.subject,
        body: run.automation.body,
        automationId: run.automationId,
        vars: (run.context as Record<string, string>) || {},
        transactional: run.automation.trigger === 'payment_failed',
      })
      await prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: message.status === 'sent' ? 'sent' : message.status === 'failed' ? 'failed' : 'skipped',
          executedAt: new Date(),
          error: message.error,
        },
      })
      if (message.status === 'sent') sent++
    } catch (error) {
      await prisma.automationRun.update({
        where: { id: run.id },
        data: { status: 'failed', executedAt: new Date(), error: error instanceof Error ? error.message : String(error) },
      })
    }
  }
  return { processed: due.length, sent }
}

/** Run after a request that may have fired triggers. Never lets a delivery problem fail the request. */
export async function flushOutbox(ownerId: string) {
  try {
    await deliverQueued(ownerId, 20)
    await processDueRuns(ownerId, 20)
  } catch (error) {
    console.error('[outbox] flush failed:', error)
  }
}

function conditionValue(automation: { conditions: Prisma.JsonValue | null; trigger: string }, key: string): number {
  const fallback = getTrigger(automation.trigger)?.condition?.default ?? 0
  const raw = (automation.conditions as Record<string, unknown> | null)?.[key]
  return typeof raw === 'number' && raw > 0 ? raw : fallback
}

/** Find members and leads that currently match each scheduled trigger and queue runs for them. */
export async function scanScheduledTriggers(ownerId: string, now = new Date()) {
  const automations = await prisma.automation.findMany({
    where: { ownerId, isActive: true, trigger: { in: TRIGGERS.filter((t) => t.kind === 'scheduled').map((t) => t.key) } },
  })
  if (automations.length === 0) return 0
  const settings = await getGymSettings(ownerId)
  const tz = settings.timezone
  const today = zonedParts(now, tz)
  let queued = 0

  const enqueue = async (automation: (typeof automations)[number], targets: TriggerTarget[]) => {
    if (targets.length === 0) return
    const result = await prisma.automationRun.createMany({
      data: targets.map((t) => ({
        ownerId,
        automationId: automation.id,
        memberId: t.memberId || null,
        prospectId: t.prospectId || null,
        dedupeKey: t.dedupeKey,
        runAt: new Date(now.getTime() + automation.delayMinutes * 60_000),
        context: (t.context || {}) as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
    queued += result.count
  }

  for (const automation of automations) {
    if (automation.trigger === 'member_inactive') {
      const days = conditionValue(automation, 'inactiveDays')
      const cutoff = new Date(now.getTime() - days * 86_400_000)
      const members = await prisma.member.findMany({
        where: { ownerId, archivedAt: null, status: { in: ['active', 'trial'] }, lastCheckInAt: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true, lastCheckInAt: true },
        take: 1000,
      })
      // Keyed on the last visit: one nudge per lapse, and a new one only after they come back and lapse again.
      await enqueue(automation, members.map((m) => ({ memberId: m.id, dedupeKey: `${m.id}:${m.lastCheckInAt!.toISOString().slice(0, 10)}` })))
    }

    if (automation.trigger === 'membership_expiring') {
      const days = conditionValue(automation, 'daysBefore')
      const horizon = new Date(now.getTime() + days * 86_400_000)
      const ending = await prisma.membership.findMany({
        where: {
          ownerId,
          status: { in: ['active', 'trial'] },
          OR: [
            { cancelAt: { gt: now, lte: horizon } },
            { endDate: { gt: now, lte: horizon } },
            { autoRenew: false, plan: { type: 'recurring' }, currentPeriodEnd: { gt: now, lte: horizon } },
          ],
        },
        include: { plan: { select: { name: true } } },
        take: 1000,
      })
      await enqueue(automation, ending.map((m) => {
        const end = m.cancelAt || m.endDate || m.currentPeriodEnd!
        return {
          memberId: m.memberId,
          dedupeKey: `${m.id}:${end.toISOString().slice(0, 10)}`,
          context: { membership_name: m.plan.name, date: formatDate(end, tz) },
        }
      }))
    }

    if (automation.trigger === 'birthday') {
      const members = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Member"
        WHERE "ownerId" = ${ownerId} AND "archivedAt" IS NULL AND "dateOfBirth" IS NOT NULL
          AND status IN ('active', 'trial')
          AND EXTRACT(MONTH FROM "dateOfBirth") = ${today.month}
          AND EXTRACT(DAY FROM "dateOfBirth") = ${today.day}
        LIMIT 1000`
      await enqueue(automation, members.map((m) => ({ memberId: m.id, dedupeKey: `${m.id}:${today.year}` })))
    }

    if (automation.trigger === 'trial_reminder') {
      const tomorrow = addDaysToDate(today.date, 1)
      const start = zonedToUtc(tomorrow, '00:00', tz)
      const end = zonedToUtc(addDaysToDate(tomorrow, 1), '00:00', tz)
      const leads = await prisma.prospect.findMany({
        where: { ownerId, status: 'trial_scheduled', trialDate: { gte: start, lt: end } },
        select: { id: true, trialDate: true },
      })
      await enqueue(automation, leads.map((l) => ({
        prospectId: l.id,
        dedupeKey: `${l.id}:${tomorrow}`,
        context: { date: formatDateTime(l.trialDate, tz) },
      })))
    }
  }
  return queued
}

/** Starter automations for a new account (created inactive so nothing sends until the gym turns them on). */
export async function installDefaultAutomations(ownerId: string, active = false) {
  const existing = await prisma.automation.count({ where: { ownerId } })
  if (existing > 0) return 0
  const result = await prisma.automation.createMany({
    data: TRIGGERS.map((t) => ({
      ownerId,
      name: t.label,
      trigger: t.key,
      channel: 'email',
      subject: t.defaultSubject,
      body: t.defaultBody,
      isActive: active,
      conditions: t.condition ? { [t.condition.key]: t.condition.default } : Prisma.JsonNull,
    })),
  })
  return result.count
}
