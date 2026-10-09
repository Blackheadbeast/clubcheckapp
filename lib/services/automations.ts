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
  condition?: { key: 'inactiveDays' | 'daysBefore' | 'hoursBefore' | 'minutesBefore'; label: string; default: number }
  /**
   * Marketing needs marketing consent; operational messages (about something the person booked, owes or asked for)
   * need only consent to operational texts. Emails: only operational ones ignore the marketing opt-out.
   */
  category?: 'operational' | 'marketing'
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
    key: 'trial_booked', category: 'operational', label: 'Trial booked', description: 'A trial visit is scheduled for a lead.', audience: 'lead', kind: 'event',
    defaultSubject: 'Your trial at {{gym_name}} is booked',
    defaultBody: "Hi {{first_name}},\n\nYou're booked for a trial on {{date}}. Wear something comfortable, bring water, and arrive 10 minutes early so we can show you around.\n\nSee you soon!",
  },
  {
    key: 'trial_reminder', category: 'operational', label: 'Trial tomorrow', description: 'The day before a scheduled trial.', audience: 'lead', kind: 'scheduled',
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
    key: 'payment_failed', category: 'operational', label: 'Payment failed', description: 'A payment fails or a membership goes past due.', audience: 'member', kind: 'event',
    defaultSubject: 'Action needed: payment issue at {{gym_name}}',
    defaultBody: "Hi {{first_name}},\n\nWe weren't able to collect {{amount}} for your {{membership_name}} membership. Please update your payment details or stop by the front desk so your membership stays active.",
  },
  {
    key: 'membership_expiring', category: 'operational', label: 'Membership expiring', description: 'A membership or pack is about to end.', audience: 'member', kind: 'scheduled',
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
  {
    key: 'appointment_booked', category: 'operational', label: 'Appointment booked', description: 'A member books (or is booked into) an appointment.', audience: 'member', kind: 'event',
    defaultSubject: 'Your {{appointment_name}} is booked',
    defaultBody: "Hi {{first_name}},\n\nYou're booked for {{appointment_name}} with {{coach_name}} on {{appointment_time}}.\n\nSee you then,\n{{gym_name}}",
  },
  {
    key: 'appointment_reminder', category: 'operational', label: 'Appointment reminder', description: 'Ahead of an appointment (a day before by default).', audience: 'member', kind: 'event',
    condition: { key: 'hoursBefore', label: 'Hours before the appointment', default: 24 },
    defaultSubject: 'Reminder: {{appointment_name}} with {{coach_name}}',
    defaultBody: 'Hi {{first_name}},\n\nA reminder that your {{appointment_name}} with {{coach_name}} is on {{appointment_time}}.\n\n{{gym_name}}',
  },
  {
    key: 'appointment_rescheduled', category: 'operational', label: 'Appointment rescheduled', description: 'An appointment is moved to a new time.', audience: 'member', kind: 'event',
    defaultSubject: 'Your {{appointment_name}} has moved',
    defaultBody: 'Hi {{first_name}},\n\nYour {{appointment_name}} with {{coach_name}} is now on {{appointment_time}}.\n\n{{gym_name}}',
  },
  {
    key: 'appointment_cancelled', category: 'operational', label: 'Appointment cancelled', description: 'An appointment is cancelled.', audience: 'member', kind: 'event',
    defaultSubject: 'Your {{appointment_name}} was cancelled',
    defaultBody: 'Hi {{first_name}},\n\nYour {{appointment_name}} with {{coach_name}} on {{appointment_time}} has been cancelled. Book another time whenever you are ready.\n\n{{gym_name}}',
  },
  {
    key: 'appointment_no_show', label: 'Missed appointment', description: 'A member does not turn up for an appointment.', audience: 'member', kind: 'event',
    defaultSubject: 'We missed you today',
    defaultBody: "Hi {{first_name}},\n\nWe missed you at your {{appointment_name}} with {{coach_name}}. Let's get you rebooked.\n\n{{gym_name}}",
  },
  {
    key: 'appointment_soon', category: 'operational', label: 'Appointment starting soon', description: 'Shortly before an appointment starts. Never sent once it has started.', audience: 'member', kind: 'event',
    condition: { key: 'minutesBefore', label: 'Minutes before the appointment', default: 60 },
    defaultSubject: 'Your {{appointment_name}} starts soon',
    defaultBody: 'Hi {{first_name}}, your {{appointment_name}} with {{coach_name}} starts at {{appointment_clock}}. See you soon! {{gym_name}}',
  },
  {
    key: 'program_assigned', category: 'operational', label: 'Program assigned', description: 'A coach assigns a training program to a member.', audience: 'member', kind: 'event',
    defaultSubject: 'Your new program: {{program_name}}',
    defaultBody: 'Hi {{first_name}},\n\n{{coach_name}} has set you up on {{program_name}}, starting {{date}}. Your workouts are in the app:\n{{portal_link}}\n\n{{gym_name}}',
  },
  {
    key: 'workout_missed', category: 'operational', label: 'Missed workout', description: 'The day after a programmed workout was not done. Once per missed workout.', audience: 'member', kind: 'scheduled',
    defaultSubject: 'We missed you yesterday',
    defaultBody: 'Hi {{first_name}},\n\n{{workout_name}} from {{program_name}} is still waiting for you. You can do it today and log it in the app:\n{{portal_link}}\n\n{{gym_name}}',
  },
  {
    key: 'document_assigned', category: 'operational', label: 'Document to sign', description: 'A member is sent a document to sign. (They are always emailed a signing link as well.)', audience: 'member', kind: 'event',
    defaultSubject: 'Please sign: {{document_name}}',
    defaultBody: 'Hi {{first_name}},\n\n{{gym_name}} has sent you {{document_name}} to read and sign. You can do it in a couple of minutes in the app:\n{{portal_link}}\n\n{{gym_name}}',
  },
  {
    key: 'document_reminder', category: 'operational', label: 'Unsigned document reminder', description: 'A document is still unsigned three days after it was sent. Once per document.', audience: 'member', kind: 'event',
    defaultSubject: 'Reminder: {{document_name}} is waiting for your signature',
    defaultBody: 'Hi {{first_name}},\n\n{{document_name}} is still waiting for you. It only takes a minute:\n{{portal_link}}\n\n{{gym_name}}',
  },
  {
    key: 'document_signed', category: 'operational', label: 'Document signed', description: 'A member signs a document.', audience: 'member', kind: 'event',
    defaultSubject: 'Thanks for signing {{document_name}}',
    defaultBody: 'Hi {{first_name}},\n\nThanks. We have your signed {{document_name}}. A copy is in the app under Documents:\n{{portal_link}}\n\n{{gym_name}}',
  },
  {
    key: 'document_declined', category: 'operational', label: 'Document declined', description: 'A member declines to sign a document.', audience: 'member', kind: 'event',
    defaultSubject: 'About {{document_name}}',
    defaultBody: 'Hi {{first_name}},\n\nWe saw that you chose not to sign {{document_name}}. If you have questions about it, reply to this email and we will help.\n\n{{gym_name}}',
  },
  {
    key: 'document_expired', category: 'operational', label: 'Document expired', description: 'A signed document reaches the end of its validity, or an unsigned one passes its deadline.', audience: 'member', kind: 'event',
    defaultSubject: '{{document_name}} needs renewing',
    defaultBody: 'Hi {{first_name}},\n\nYour {{document_name}} has expired. We will send you the current one to sign.\n\n{{gym_name}}',
  },
  {
    key: 'program_completed', category: 'operational', label: 'Program completed', description: 'A member reaches the end of a training program.', audience: 'member', kind: 'event',
    defaultSubject: 'You finished {{program_name}}',
    defaultBody: 'Hi {{first_name}},\n\nYou have finished {{program_name}}. Well done. Talk to your coach about what comes next.\n\n{{gym_name}}',
  },
]

export const TRIGGER_KEYS = TRIGGERS.map((t) => t.key)
export const getTrigger = (key: string) => TRIGGERS.find((t) => t.key === key)

export const automationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  trigger: z.string().refine((t) => TRIGGER_KEYS.includes(t), 'Unknown trigger'),
  conditions: z.record(z.string(), z.number().int().min(1).max(1440)).nullish(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30),
  channel: z.enum(['email', 'sms', 'both']),
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

/**
 * Reminders tied to a moment (an appointment's start). Each active reminder automation gets a run timed
 * its own lead ahead of that moment, stamped with `not_after` so it is dropped rather than sent late.
 * If the lead time has already passed when this is called (they booked an hour before), there is no reminder.
 */
export async function scheduleTimedRuns(db: Db, ownerId: string, input: { key: string; memberId: string; startsAt: Date; context: Record<string, string | undefined> }) {
  const automations = await db.automation.findMany({ where: { ownerId, isActive: true, trigger: { in: ['appointment_reminder', 'appointment_soon'] } } })
  const now = Date.now()
  const rows = []
  for (const a of automations) {
    const lead = a.trigger === 'appointment_soon' ? conditionValue(a, 'minutesBefore') * 60_000 : conditionValue(a, 'hoursBefore') * 3_600_000
    const runAt = input.startsAt.getTime() - lead
    if (runAt <= now) continue
    rows.push({ ownerId, automationId: a.id, memberId: input.memberId, dedupeKey: `${input.key}:${a.trigger}:${input.startsAt.getTime()}`, runAt: new Date(runAt), context: { ...input.context, not_after: input.startsAt.toISOString() } as Prisma.InputJsonValue })
  }
  if (rows.length) await db.automationRun.createMany({ data: rows, skipDuplicates: true })
  return rows.length
}

/** Withdraw reminders that have not gone out yet (the appointment was cancelled or moved). */
export async function cancelTimedRuns(db: Db, ownerId: string, key: string) {
  const result = await db.automationRun.deleteMany({ where: { ownerId, status: 'pending', dedupeKey: { startsWith: `${key}:appointment_` } } })
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
      const context = (run.context as Record<string, string>) || {}
      // A reminder that could not go out in time is not sent late.
      if (context.not_after && new Date(context.not_after) <= new Date()) {
        await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'skipped', executedAt: new Date(), error: 'Too late to be useful, so it was not sent' } })
        continue
      }
      const operational = getTrigger(run.automation.trigger)?.category === 'operational'
      const channels: Channel[] = run.automation.channel === 'both' ? ['email', 'sms'] : [run.automation.channel as Channel]
      const results = []
      for (const channel of channels) {
        results.push(await sendMessage({
          ownerId: run.ownerId,
          channel,
          memberId: run.memberId,
          prospectId: run.prospectId,
          subject: channel === 'email' ? run.automation.subject : null,
          body: run.automation.body,
          automationId: run.automationId,
          vars: context,
          kind: operational ? 'operational' : 'marketing',
          // One message per run and channel, however many times the run is picked up.
          dedupeKey: `auto:${run.id}:${channel}`,
          expiresAt: context.not_after ? new Date(context.not_after) : null,
        }))
      }
      const anySent = results.some((m) => m.status === 'sent')
      await prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: anySent ? 'sent' : results.every((m) => m.status === 'failed') ? 'failed' : results.some((m) => m.status === 'queued') ? 'sent' : 'skipped',
          executedAt: new Date(),
          error: anySent ? null : results.map((m) => m.error).filter(Boolean).join('; ') || null,
        },
      })
      if (anySent) sent++
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
    if (automation.trigger === 'workout_missed') {
      const { missedYesterday } = await import('./programs')
      const missed = await missedYesterday(ownerId, now)
      // Keyed on the assignment and the training day, so a missed workout is mentioned once.
      await enqueue(automation, missed.map((m) => ({ memberId: m.memberId, dedupeKey: `missed:${m.assignmentId}:${m.programDayId}`, context: { workout_name: m.workoutName, program_name: m.programName } })))
    }
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
