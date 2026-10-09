// One pipeline for every outbound message: render merge tags, apply opt-in
// rules, record a Message row, then hand off to the email/SMS provider.

import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { OPTED_OUT_CODES, getSmsProvider, toE164, webhookBase } from '@/lib/messaging/sms'
import { ApiError } from '@/lib/api'
import { Db, getGymSettings } from './core'

export type Channel = 'email' | 'sms'

export const MERGE_TAGS = [
  { tag: 'first_name', label: 'First name' },
  { tag: 'name', label: 'Full name' },
  { tag: 'gym_name', label: 'Gym name' },
  { tag: 'portal_link', label: 'Member portal link' },
  { tag: 'class_name', label: 'Class name (class triggers)' },
  { tag: 'class_time', label: 'Class time (class triggers)' },
  { tag: 'appointment_name', label: 'Appointment type (appointment triggers)' },
  { tag: 'coach_name', label: 'Coach name (appointment triggers)' },
  { tag: 'appointment_time', label: 'Appointment time (appointment triggers)' },
  { tag: 'amount', label: 'Amount due (billing triggers)' },
  { tag: 'program_name', label: 'Program name (training triggers)' },
  { tag: 'workout_name', label: 'Workout name (training triggers)' },
  { tag: 'document_name', label: 'Document name (document triggers)' },
  { tag: 'membership_name', label: 'Membership name' },
  { tag: 'date', label: 'Relevant date (trial, expiry)' },
] as const

export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => vars[key.toLowerCase()] ?? '')
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function emailHtml(gymName: string, body: string): string {
  const content = escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#b45309;">$1</a>')
    .replace(/\n/g, '<br>')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
<table width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;">
<tr><td style="padding:24px 32px 0;font-size:16px;font-weight:600;color:#1c1917;">${escapeHtml(gymName)}</td></tr>
<tr><td style="padding:16px 32px 28px;font-size:15px;line-height:1.6;color:#44403c;">${content}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e7e5e4;font-size:12px;color:#a8a29e;">Sent by ${escapeHtml(gymName)} via ClubCheck</td></tr>
</table></td></tr></table></body></html>`
}

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY
}

export type MessageKind = 'marketing' | 'operational' | 'conversation'

export interface SendInput {
  ownerId: string
  channel: Channel
  memberId?: string | null
  prospectId?: string | null
  /** Reply into an existing text thread (used for numbers that are not attached to anyone). */
  conversationId?: string | null
  subject?: string | null
  body: string
  campaignId?: string | null
  automationId?: string | null
  templateId?: string | null
  vars?: Record<string, string | undefined>
  /** Booking, billing and waitlist notices go out even if marketing is opted out. Same as kind: "operational". */
  transactional?: boolean
  /**
   * What sort of message this is, which decides the consent it needs:
   * marketing (campaigns, promotional automations), operational (reminders, confirmations, billing),
   * or conversation (a member of staff writing to one person).
   */
  kind?: MessageKind
  /** The member of staff who wrote it. */
  staff?: { id?: string | null; name?: string | null } | null
  /** Identifies the logical message. Asking for the same one again returns the first instead of sending twice. */
  dedupeKey?: string | null
  /** Hold until this moment (a reminder scheduled ahead). */
  sendAfter?: Date | null
  /** Never send after this moment (a "starting soon" text is useless once it has started). */
  expiresAt?: Date | null
}

/** Why a text may not go to this person, or null if it may. Phone on file is never consent by itself. */
function smsBlock(kind: MessageKind, person: { smsStopped: boolean; smsOptIn: boolean; smsMarketingOptIn?: boolean }, theyTextedUs: boolean, isLead: boolean): string | null {
  if (person.smsStopped) return 'Opted out of all texts (replied STOP)'
  if (kind === 'marketing') {
    if (isLead) return person.smsOptIn ? null : 'Lead has not agreed to texts'
    return person.smsMarketingOptIn ? null : 'No consent to marketing texts'
  }
  if (kind === 'operational') return person.smsOptIn ? null : isLead ? 'Lead has not agreed to texts' : 'Has not agreed to text reminders'
  // A one-to-one message: fine if they agreed to texts, or if they texted us first.
  return person.smsOptIn || theyTextedUs ? null : 'Has not agreed to texts. Ask them to opt in, or to text this number first.'
}

/**
 * Render a message and store it with status "queued". Safe inside a transaction:
 * nothing leaves the building until deliverMessage runs after commit, so a
 * rolled-back booking can never email or text anyone. Messages that may not be
 * sent are stored as "skipped" with the reason, never silently dropped.
 */
export async function queueMessage(db: Db, input: SendInput) {
  const kind: MessageKind = input.kind || (input.transactional ? 'operational' : 'marketing')
  // Claim the logical message first. A second request for the same one gets the original back.
  if (input.dedupeKey) {
    // Whoever inserts the key writes the message. Everyone else waits for that message and returns it:
    // the winner may still be a few milliseconds from storing it. If the winner's transaction rolled
    // back, its key went with it and the next pass claims it here.
    for (let attempt = 0; ; attempt++) {
      const claimed = await db.messageKey.createMany({ data: [{ key: input.dedupeKey, ownerId: input.ownerId }], skipDuplicates: true })
      if (claimed.count === 1) break
      const original = await db.message.findFirst({ where: { ownerId: input.ownerId, dedupeKey: input.dedupeKey } })
      if (original) return original
      // The key exists but belongs to another gym: keys are namespaced by their callers, so this is a refusal, not a wait.
      const holder = await db.messageKey.findUnique({ where: { key: input.dedupeKey }, select: { ownerId: true } })
      if ((holder && holder.ownerId !== input.ownerId) || attempt >= 40) throw new ApiError(409, 'That message is already being sent. Check the conversation before trying again.', 'message_in_progress')
      await new Promise((resolve) => setTimeout(resolve, 75))
    }
  }
  const thread = input.conversationId ? await db.smsConversation.findFirst({ where: { id: input.conversationId, ownerId: input.ownerId } }) : null
  const memberId = input.memberId || thread?.memberId || null
  const prospectId = memberId ? null : input.prospectId || thread?.prospectId || null
  const [settings, member, prospect] = await Promise.all([
    getGymSettings(input.ownerId, db),
    memberId
      ? db.member.findFirst({
          where: { id: memberId, ownerId: input.ownerId },
          select: { id: true, name: true, email: true, phone: true, emailOptIn: true, smsOptIn: true, smsMarketingOptIn: true, smsStopped: true, accessToken: true, archivedAt: true, account: { select: { id: true } } },
        })
      : null,
    prospectId
      ? db.prospect.findFirst({ where: { id: prospectId, ownerId: input.ownerId }, select: { id: true, name: true, email: true, phone: true, smsOptIn: true, smsStopped: true } })
      : null,
  ])
  const person = member || prospect
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const vars: Record<string, string | undefined> = {
    name: person?.name,
    first_name: person?.name.split(/\s+/)[0],
    gym_name: settings.name,
    // Members with a password sign in; the personal link only works until they set one.
    portal_link: member?.account ? `${appUrl}/member/login` : member?.accessToken ? `${appUrl}/member/${member.accessToken}` : undefined,
    ...input.vars,
  }
  const subject = input.subject ? renderTemplate(input.subject, vars) : null
  const body = renderTemplate(input.body, vars)
  const sms = input.channel === 'sms'
  // A thread for a number nobody is attached to is addressed by the thread's own number.
  const to = sms ? (person?.phone ? toE164(person.phone) : thread && !person ? thread.phone : null) : person?.email || null

  let conversation = thread
  let skip: string | null = null
  if (!person && !(sms && thread)) skip = 'Recipient not found'
  else if (member?.archivedAt) skip = 'Member is archived'
  else if (!to) skip = sms ? 'No valid mobile number on file' : 'No email address on file'
  else if (!sms && kind !== 'operational' && member && !member.emailOptIn) skip = 'Member opted out of email'
  else if (sms) {
    const { conversationFor, phoneStopped } = await import('./sms')
    conversation = conversation || (await db.smsConversation.findUnique({ where: { ownerId_phone: { ownerId: input.ownerId, phone: to } } }))
    const theyTextedUs = !!conversation?.lastInboundAt
    if (member) skip = smsBlock(kind, member, theyTextedUs, false)
    else if (prospect) skip = smsBlock(kind, prospect, theyTextedUs, true)
    // Nobody we know: only ever a reply to someone who wrote first and has not said STOP.
    else skip = (await phoneStopped(db, input.ownerId, to)) ? 'Opted out of all texts (replied STOP)' : kind === 'conversation' && theyTextedUs ? null : 'This number has not agreed to texts'
    // A conversation starts when something is actually sent. A text that may not go out does not open one.
    if (!skip) conversation = await conversationFor(db, input.ownerId, to, { memberId: member?.id, prospectId: prospect?.id })
  }

  if (member && !member.archivedAt && !skip && kind !== 'conversation') {
    const { notifyMember } = await import('./member-notifications')
    await notifyMember(db, { ownerId: input.ownerId, memberId: member.id, category: 'message', type: 'message', title: subject || body.slice(0, 80), body, screen: 'home' })
  }
  const message = await db.message.create({
    data: {
      ownerId: input.ownerId,
      channel: input.channel,
      direction: 'outbound',
      kind,
      memberId: member?.id || null,
      prospectId: prospect?.id || null,
      campaignId: input.campaignId || null,
      automationId: input.automationId || null,
      templateId: input.templateId || null,
      conversationId: sms ? conversation?.id || null : null,
      staffId: input.staff?.id || null,
      staffName: input.staff?.name || null,
      toAddress: to || null,
      subject,
      body,
      status: skip ? 'skipped' : 'queued',
      error: skip,
      dedupeKey: input.dedupeKey || null,
      sendAfter: input.sendAfter || null,
      expiresAt: input.expiresAt || null,
    },
  })
  if (input.dedupeKey) await db.messageKey.updateMany({ where: { key: input.dedupeKey }, data: { messageId: message.id } })
  if (sms && conversation && !skip) {
    const { noteOutbound } = await import('./sms')
    await noteOutbound(db, conversation.id, body, kind === 'conversation')
  }
  return message
}

const MAX_ATTEMPTS = 5
/** 30s, 1m, 2m, 4m: long enough to ride out a rate limit, short enough to still matter. */
const backoff = (attempt: number) => Math.min(15 * 60_000, 30_000 * 2 ** (attempt - 1))

/** Hand a queued message to its provider. Never throws: the outcome is recorded on the row. */
export async function deliverMessage(messageId: string, now = new Date()) {
  // Claim it so two workers cannot both send.
  const claimed = await prisma.message.updateMany({
    where: { id: messageId, status: 'queued', AND: [{ OR: [{ sendAfter: null }, { sendAfter: { lte: now } }] }, { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
    // nextAttemptAt doubles as the moment the claim was taken, so a claim abandoned by a crash can be found.
    data: { status: 'sending', nextAttemptAt: now },
  })
  if (claimed.count === 0) return prisma.message.findUnique({ where: { id: messageId } })
  const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } })
  const to = message.toAddress!
  if (message.expiresAt && message.expiresAt <= now) {
    return prisma.message.update({ where: { id: message.id }, data: { status: 'expired', nextAttemptAt: null, error: 'Not sent: it was no longer relevant by the time it could go out' } })
  }

  type Outcome = { ok: true; id: string; from?: string | null } | { ok: false; error: string; skipped?: boolean; code?: string; retryable?: boolean }
  let result: Outcome
  if (message.channel === 'email') {
    if (!emailConfigured()) {
      result = { ok: false, skipped: true, error: 'Email delivery is not configured (RESEND_API_KEY)' }
    } else {
      try {
        const settings = await getGymSettings(message.ownerId)
        const resend = new Resend(process.env.RESEND_API_KEY)
        const { data, error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || 'ClubCheck <onboarding@resend.dev>',
          to,
          subject: message.subject || `A message from ${settings.name}`,
          html: emailHtml(settings.name, message.body),
          text: message.body,
        })
        result = error || !data ? { ok: false, error: error?.message || 'Email provider rejected the message' } : { ok: true, id: data.id }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : 'Email request failed' }
      }
    }
  } else {
    const provider = getSmsProvider()
    const { gymSmsNumber, phoneStopped } = await import('./sms')
    const from = await gymSmsNumber(message.ownerId)
    if (!provider) result = { ok: false, skipped: true, error: 'SMS delivery is not configured' }
    else if (!from && !process.env.TWILIO_MESSAGING_SERVICE_SID) result = { ok: false, skipped: true, error: 'No sending number is set up for this gym' }
    // They may have replied STOP between this being queued and now.
    else if (await phoneStopped(prisma, message.ownerId, to)) result = { ok: false, skipped: true, error: 'Opted out of all texts (replied STOP)' }
    else {
      const base = webhookBase()
      const sent = await provider.send({ to, from, body: message.body, statusCallback: base ? `${base}/api/webhooks/twilio/status` : null })
      result = sent.ok ? { ...sent, from } : sent
    }
  }

  if (result.ok) {
    return prisma.message.update({ where: { id: message.id }, data: { status: 'sent', providerId: result.id, sentAt: new Date(), attempts: { increment: 1 }, nextAttemptAt: null, error: null, ...(result.from && { fromAddress: result.from }) } })
  }
  const attempts = message.attempts + 1
  if (result.retryable && attempts < MAX_ATTEMPTS) {
    // Back in the queue for another go; the claim above stops anyone sending it in the meantime.
    return prisma.message.update({ where: { id: message.id }, data: { status: 'queued', attempts, nextAttemptAt: new Date(now.getTime() + backoff(attempts)), error: result.error, errorCode: result.code || null } })
  }
  if (result.code && OPTED_OUT_CODES.includes(result.code)) {
    const { stopPhone } = await import('./sms')
    await prisma.$transaction((db) => stopPhone(db, message.ownerId, to, 'carrier', 'The carrier reported this number as unsubscribed')).catch(() => {})
  }
  return prisma.message.update({
    where: { id: message.id },
    data: { status: result.skipped ? 'skipped' : 'failed', error: result.error, errorCode: result.code || null, attempts: result.skipped ? message.attempts : attempts, nextAttemptAt: null },
  })
}

/** Queue and deliver in one step (outside a transaction). */
export async function sendMessage(input: SendInput) {
  const message = await queueMessage(prisma, input)
  if (message.status !== 'queued') return message
  return (await deliverMessage(message.id)) || message
}

/**
 * Deliver what is due in the outbox: new messages, scheduled ones whose time has come, and retries
 * whose wait is over. A few at a time, so a thousand-recipient campaign is worked through steadily
 * instead of in one request. Returns how many are still waiting.
 */
const STUCK_AFTER_MS = 10 * 60_000

export async function deliverQueued(ownerId?: string, limit = 50, now = new Date()) {
  // A send that was cut off part-way (the server stopped) may or may not have reached the provider.
  // It is closed as failed rather than sent again: a missing text can be resent by a person, a duplicate cannot be unsent.
  await prisma.message.updateMany({
    where: { status: 'sending', nextAttemptAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) }, ...(ownerId && { ownerId }) },
    data: { status: 'failed', nextAttemptAt: null, error: 'Interrupted while sending. It may or may not have gone out, so it was not sent again.' },
  })
  const due = {
    status: 'queued', ...(ownerId && { ownerId }),
    AND: [{ OR: [{ sendAfter: null }, { sendAfter: { lte: now } }] }, { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
  }
  const queued = await prisma.message.findMany({ where: due, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } })
  for (let i = 0; i < queued.length; i += 5) await Promise.all(queued.slice(i, i + 5).map(({ id }) => deliverMessage(id, now)))
  return queued.length
}

/** How much of the outbox is still to go for a gym (optionally one campaign). */
export async function outboxRemaining(ownerId: string, campaignId?: string) {
  return prisma.message.count({ where: { ownerId, status: { in: ['queued', 'sending'] }, ...(campaignId && { campaignId }) } })
}
