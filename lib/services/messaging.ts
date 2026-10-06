// One pipeline for every outbound message: render merge tags, apply opt-in
// rules, record a Message row, then hand off to the email/SMS provider.

import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { getSmsProvider, toE164 } from '@/lib/messaging/sms'
import { Db, getGymSettings } from './core'

export type Channel = 'email' | 'sms'

export const MERGE_TAGS = [
  { tag: 'first_name', label: 'First name' },
  { tag: 'name', label: 'Full name' },
  { tag: 'gym_name', label: 'Gym name' },
  { tag: 'portal_link', label: 'Member portal link' },
  { tag: 'class_name', label: 'Class name (class triggers)' },
  { tag: 'class_time', label: 'Class time (class triggers)' },
  { tag: 'amount', label: 'Amount due (billing triggers)' },
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

export interface SendInput {
  ownerId: string
  channel: Channel
  memberId?: string | null
  prospectId?: string | null
  subject?: string | null
  body: string
  campaignId?: string | null
  automationId?: string | null
  vars?: Record<string, string | undefined>
  /** Booking, billing and waitlist notices go out even if marketing is opted out. */
  transactional?: boolean
}

/**
 * Render a message and store it with status "queued". Safe inside a transaction:
 * nothing leaves the building until deliverMessage runs after commit, so a
 * rolled-back booking can never email anyone.
 */
export async function queueMessage(db: Db, input: SendInput) {
  const [settings, member, prospect] = await Promise.all([
    getGymSettings(input.ownerId, db),
    input.memberId
      ? db.member.findFirst({
          where: { id: input.memberId, ownerId: input.ownerId },
          select: { id: true, name: true, email: true, phone: true, emailOptIn: true, smsOptIn: true, accessToken: true, archivedAt: true },
        })
      : null,
    input.prospectId
      ? db.prospect.findFirst({ where: { id: input.prospectId, ownerId: input.ownerId }, select: { id: true, name: true, email: true, phone: true } })
      : null,
  ])
  const person = member || prospect
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const vars: Record<string, string | undefined> = {
    name: person?.name,
    first_name: person?.name.split(/\s+/)[0],
    gym_name: settings.name,
    portal_link: member?.accessToken ? `${appUrl}/member/${member.accessToken}` : undefined,
    ...input.vars,
  }
  const subject = input.subject ? renderTemplate(input.subject, vars) : null
  const body = renderTemplate(input.body, vars)
  const to = input.channel === 'email' ? person?.email : person?.phone ? toE164(person.phone) : null

  let skip: string | null = null
  if (!person) skip = 'Recipient not found'
  else if (member?.archivedAt) skip = 'Member is archived'
  else if (!to) skip = input.channel === 'email' ? 'No email address on file' : 'No valid mobile number on file'
  else if (!input.transactional && member && input.channel === 'email' && !member.emailOptIn) skip = 'Member opted out of email'
  else if (member && input.channel === 'sms' && !member.smsOptIn) skip = 'Member has not opted in to SMS'
  else if (prospect && input.channel === 'sms') skip = 'Leads have not opted in to SMS'

  return db.message.create({
    data: {
      ownerId: input.ownerId,
      channel: input.channel,
      memberId: member?.id || null,
      prospectId: prospect?.id || null,
      campaignId: input.campaignId || null,
      automationId: input.automationId || null,
      toAddress: to || null,
      subject,
      body,
      status: skip ? 'skipped' : 'queued',
      error: skip,
    },
  })
}

/** Hand a queued message to its provider. Never throws: the outcome is recorded on the row. */
export async function deliverMessage(messageId: string) {
  // Claim it so two workers cannot both send.
  const claimed = await prisma.message.updateMany({ where: { id: messageId, status: 'queued' }, data: { status: 'sending' } })
  if (claimed.count === 0) return prisma.message.findUnique({ where: { id: messageId } })
  const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } })
  const to = message.toAddress!

  let result: { ok: true; id: string } | { ok: false; error: string; skipped?: boolean }
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
    result = provider ? await provider.send(to, message.body) : { ok: false, skipped: true, error: 'SMS delivery is not configured' }
  }

  return prisma.message.update({
    where: { id: message.id },
    data: result.ok
      ? { status: 'sent', providerId: result.id, sentAt: new Date() }
      : { status: result.skipped ? 'skipped' : 'failed', error: result.error },
  })
}

/** Queue and deliver in one step (outside a transaction). */
export async function sendMessage(input: SendInput) {
  const message = await queueMessage(prisma, input)
  if (message.status !== 'queued') return message
  return (await deliverMessage(message.id)) || message
}

/** Deliver anything left in the outbox, e.g. notices queued inside a transaction. */
export async function deliverQueued(ownerId?: string, limit = 50) {
  const queued = await prisma.message.findMany({
    where: { status: 'queued', ...(ownerId && { ownerId }) },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  for (const { id } of queued) await deliverMessage(id)
  return queued.length
}
