// Text messaging: conversations, inbound messages, delivery reports and consent.
//
// Sending itself lives in messaging.ts (one outbox for email and SMS). This file
// is everything that is particular to texting:
//
//  - A conversation is one thread between a gym and one phone number.
//  - Consent has three levels. A member who replied STOP gets nothing at all
//    until they text START; only they can undo it. Otherwise operational texts
//    (reminders, confirmations) need smsOptIn and marketing needs
//    smsMarketingOptIn. A phone number on file is never consent by itself.
//  - Every change of consent is kept as history, with the number it applied to.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound } from '@/lib/api'
import { OPTED_OUT_CODES, defaultSmsNumber, toE164 } from '@/lib/messaging/sms'
import { Db, logActivity, notify } from './core'

export const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE']
export const START_WORDS = ['START', 'UNSTOP', 'YES', 'SUBSCRIBE']
export const HELP_WORDS = ['HELP', 'INFO']
export type ConsentSource = 'staff' | 'member_portal' | 'keyword' | 'import' | 'website_form' | 'lead_form' | 'carrier'

/** The number this gym sends from: its own if it has one, otherwise the installation's shared number. */
export async function gymSmsNumber(ownerId: string, db: Db = prisma): Promise<string | null> {
  const own = await db.smsNumber.findUnique({ where: { ownerId } })
  return own?.number || defaultSmsNumber()
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface ConsentChange {
  ownerId: string
  memberId?: string | null
  prospectId?: string | null
  scope: 'operational' | 'marketing'
  optedIn: boolean
  source: ConsentSource
  method?: string
  actorName?: string | null
}

/** Change one kind of consent and keep the history. A STOP cannot be overridden by anyone but the person. */
export async function setSmsConsent(db: Db, change: ConsentChange) {
  if (change.memberId) {
    const member = await db.member.findFirst({ where: { id: change.memberId, ownerId: change.ownerId }, select: { id: true, phone: true, smsOptIn: true, smsMarketingOptIn: true, smsStopped: true } })
    if (!member) throw notFound('Member')
    if (change.optedIn && member.smsStopped) throw new ApiError(409, 'They replied STOP to opt out of texts. Only they can undo that, by texting START.', 'sms_stopped')
    const current = change.scope === 'marketing' ? member.smsMarketingOptIn : member.smsOptIn
    if (current === change.optedIn) return false
    await db.member.update({
      where: { id: member.id },
      data: change.scope === 'marketing'
        ? { smsMarketingOptIn: change.optedIn, ...(change.optedIn && { smsConsentAt: new Date() }) }
        // Withdrawing consent to texts altogether withdraws marketing with it.
        : { smsOptIn: change.optedIn, ...(change.optedIn ? { smsConsentAt: new Date() } : { smsMarketingOptIn: false }) },
    })
    await db.smsConsentEvent.create({ data: { ownerId: change.ownerId, memberId: member.id, phone: toE164(member.phone), scope: change.scope, status: change.optedIn ? 'opted_in' : 'opted_out', source: change.source, method: change.method || null, actorName: change.actorName || null } })
    return true
  }
  if (change.prospectId) {
    const lead = await db.prospect.findFirst({ where: { id: change.prospectId, ownerId: change.ownerId }, select: { id: true, phone: true, smsOptIn: true, smsStopped: true } })
    if (!lead) throw notFound('Lead')
    if (change.optedIn && lead.smsStopped) throw new ApiError(409, 'They replied STOP to opt out of texts. Only they can undo that, by texting START.', 'sms_stopped')
    if (lead.smsOptIn === change.optedIn) return false
    await db.prospect.update({ where: { id: lead.id }, data: { smsOptIn: change.optedIn } })
    await db.smsConsentEvent.create({ data: { ownerId: change.ownerId, prospectId: lead.id, phone: toE164(lead.phone), scope: 'operational', status: change.optedIn ? 'opted_in' : 'opted_out', source: change.source, method: change.method || null, actorName: change.actorName || null } })
    return true
  }
  return false
}

/** STOP (or the carrier telling us they are unsubscribed): everything off for everyone on this number at this gym. */
export async function stopPhone(db: Db, ownerId: string, phone: string, source: ConsentSource, method: string) {
  const { members, prospects } = await peopleWithPhone(db, ownerId, phone)
  const now = new Date()
  for (const m of members) {
    await db.member.update({ where: { id: m.id }, data: { smsStopped: true, smsStoppedAt: now, smsOptIn: false, smsMarketingOptIn: false } })
    await logActivity(db, { ownerId, memberId: m.id, type: 'sms_opt_out', title: 'Opted out of text messages', detail: method })
  }
  for (const p of prospects) await db.prospect.update({ where: { id: p.id }, data: { smsStopped: true, smsOptIn: false } })
  await db.smsConsentEvent.create({ data: { ownerId, memberId: members.length === 1 ? members[0].id : null, prospectId: members.length === 0 && prospects.length === 1 ? prospects[0].id : null, phone, scope: 'all', status: 'opted_out', source, method } })
  // Anything still waiting to go to this number is withdrawn.
  await db.message.updateMany({ where: { ownerId, channel: 'sms', direction: 'outbound', toAddress: phone, status: 'queued' }, data: { status: 'skipped', error: 'Opted out of all texts (replied STOP)' } })
}

/** START: the block is lifted and operational texts resume. Marketing stays off until they ask for it. */
export async function startPhone(db: Db, ownerId: string, phone: string, method: string) {
  const { members, prospects } = await peopleWithPhone(db, ownerId, phone)
  for (const m of members) {
    await db.member.update({ where: { id: m.id }, data: { smsStopped: false, smsStoppedAt: null, smsOptIn: true, smsConsentAt: new Date() } })
    await logActivity(db, { ownerId, memberId: m.id, type: 'sms_opt_in', title: 'Opted back in to text messages', detail: method })
  }
  for (const p of prospects) await db.prospect.update({ where: { id: p.id }, data: { smsStopped: false, smsOptIn: true } })
  await db.smsConsentEvent.create({ data: { ownerId, memberId: members.length === 1 ? members[0].id : null, prospectId: members.length === 0 && prospects.length === 1 ? prospects[0].id : null, phone, scope: 'operational', status: 'opted_in', source: 'keyword', method } })
}

/** Has this number (attached to a member or not) told this gym to stop? */
export async function phoneStopped(db: Db, ownerId: string, phone: string) {
  const last = await db.smsConsentEvent.findFirst({ where: { ownerId, phone, OR: [{ scope: 'all' }, { source: 'keyword' }] }, orderBy: { createdAt: 'desc' }, select: { scope: true, status: true } })
  return !!last && last.scope === 'all' && last.status === 'opted_out'
}

export async function consentHistory(ownerId: string, memberId: string) {
  return prisma.smsConsentEvent.findMany({ where: { ownerId, memberId }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, scope: true, status: true, source: true, method: true, actorName: true, phone: true, createdAt: true } })
}

// ---------------------------------------------------------------------------
// Matching a phone number to a person
// ---------------------------------------------------------------------------

/**
 * Everyone at this gym whose number is this phone. Stored numbers are typed every which way, so
 * the comparison is on digits: the last ten for North American numbers, all of them otherwise.
 */
export async function peopleWithPhone(db: Db, ownerId: string, phone: string) {
  const e164 = toE164(phone)
  if (!e164) return { members: [], prospects: [] }
  const digits = e164.slice(1)
  const key = e164.startsWith('+1') && digits.length === 11 ? digits.slice(1) : digits
  const [m, p] = await Promise.all([
    db.$queryRaw<{ id: string; phone: string }[]>`SELECT id, phone FROM "Member" WHERE "ownerId" = ${ownerId} AND "archivedAt" IS NULL AND phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + key} LIMIT 20`,
    db.$queryRaw<{ id: string; phone: string }[]>`SELECT id, phone FROM "Prospect" WHERE "ownerId" = ${ownerId} AND status <> 'converted' AND phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + key} LIMIT 20`,
  ])
  // LIKE is only the index-friendly first pass; confirm each as the very same number.
  return { members: m.filter((r) => toE164(r.phone) === e164), prospects: p.filter((r) => toE164(r.phone) === e164) }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** Find or create the thread for a number, attaching it to a person only when that is unambiguous. */
export async function conversationFor(db: Db, ownerId: string, phone: string, hint: { memberId?: string | null; prospectId?: string | null } = {}) {
  const existing = await db.smsConversation.findUnique({ where: { ownerId_phone: { ownerId, phone } } })
  if (existing) {
    // The person a thread was attached to may have been deleted since. It then belongs to nobody
    // until we know better, rather than pointing at a record that is gone.
    const gone = existing.memberId ? (await db.member.count({ where: { id: existing.memberId, ownerId } })) === 0
      : existing.prospectId ? (await db.prospect.count({ where: { id: existing.prospectId, ownerId } })) === 0 : false
    // A thread that is unattached becomes someone's once we know whose it is.
    if ((gone || (!existing.memberId && !existing.prospectId)) && (hint.memberId || hint.prospectId)) {
      return db.smsConversation.update({ where: { id: existing.id }, data: { memberId: hint.memberId || null, prospectId: hint.memberId ? null : hint.prospectId || null } })
    }
    if (gone) return db.smsConversation.update({ where: { id: existing.id }, data: { memberId: null, prospectId: null } })
    return existing
  }
  let memberId = hint.memberId || null
  let prospectId = hint.memberId ? null : hint.prospectId || null
  if (!memberId && !prospectId) {
    const { members, prospects } = await peopleWithPhone(db, ownerId, phone)
    // Exactly one member, or no member and exactly one lead. Two members sharing a number (a family) is not a match.
    if (members.length === 1) memberId = members[0].id
    else if (members.length === 0 && prospects.length === 1) prospectId = prospects[0].id
  }
  // Two messages for a new number can arrive together. The loser of the insert takes the winner's thread;
  // done this way (rather than catching the conflict) it also works inside a transaction.
  await db.smsConversation.createMany({ data: [{ ownerId, phone, memberId, prospectId }], skipDuplicates: true })
  return db.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId, phone } } })
}

const preview = (body: string) => (body.length > 120 ? `${body.slice(0, 117)}…` : body)

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface InboundSms {
  /** The provider's id for this message; a redelivered webhook carries the same one. */
  sid: string
  from: string
  to: string
  body: string
}

/** Which gym a text to this number belongs to. Null when it cannot be decided safely. */
export async function gymForInbound(to: string, from: string): Promise<string | null> {
  const own = await prisma.smsNumber.findUnique({ where: { number: to } })
  if (own) return own.ownerId
  if (to !== defaultSmsNumber()) return null
  // The shared number: route by who we have been talking to, then by whose member it is.
  const threads = await prisma.smsConversation.findMany({ where: { phone: from, ownerId: { notIn: (await prisma.smsNumber.findMany({ select: { ownerId: true } })).map((n) => n.ownerId) } }, orderBy: { lastOutboundAt: { sort: 'desc', nulls: 'last' } }, select: { ownerId: true }, take: 5 })
  const owners = Array.from(new Set(threads.map((t) => t.ownerId)))
  if (owners.length === 1) return owners[0]
  if (owners.length > 1) return threads[0].ownerId
  const single = await prisma.owner.findMany({ select: { id: true }, take: 2 })
  // A one-gym installation: everything on the shared number is theirs.
  return single.length === 1 ? single[0].id : null
}

/**
 * Store a text someone sent us. Safe to call twice for the same message. Never sends anything and
 * never starts a campaign or automation: a reply is a reply.
 */
export async function receiveInboundSms(input: InboundSms) {
  const from = toE164(input.from)
  const to = toE164(input.to)
  if (!from || !to) return { status: 'ignored' as const, reason: 'Unrecognised phone number' }
  const ownerId = await gymForInbound(to, from)
  if (!ownerId) return { status: 'unroutable' as const, reason: 'No gym uses this number' }

  return prisma.$transaction(async (db) => {
    const claimed = await db.messageKey.createMany({ data: [{ key: `in:${input.sid}`, ownerId }], skipDuplicates: true })
    if (claimed.count === 0) return { status: 'duplicate' as const, ownerId }

    const conversation = await conversationFor(db, ownerId, from)
    const word = input.body.trim().toUpperCase().replace(/[^A-Z]/g, '')
    const keyword = STOP_WORDS.includes(word) ? 'stop' : START_WORDS.includes(word) ? 'start' : HELP_WORDS.includes(word) ? 'help' : null
    const message = await db.message.create({
      data: {
        ownerId, channel: 'sms', direction: 'inbound', kind: 'conversation', status: 'received', body: input.body.slice(0, 5000), toAddress: to, fromAddress: from,
        memberId: conversation.memberId, prospectId: conversation.prospectId, conversationId: conversation.id, providerId: input.sid, dedupeKey: `in:${input.sid}`, deliveredAt: new Date(),
        // An opt-out or opt-in is handled, not something waiting for a reply.
        ...(keyword && keyword !== 'help' && { readAt: new Date() }),
      },
    })
    await db.messageKey.update({ where: { key: `in:${input.sid}` }, data: { messageId: message.id } })

    if (keyword === 'stop') await stopPhone(db, ownerId, from, 'keyword', `Texted ${word}`)
    if (keyword === 'start') await startPhone(db, ownerId, from, `Texted ${word}`)
    const waiting = !keyword || keyword === 'help'
    const updated = await db.smsConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastInboundAt: new Date(), lastPreview: preview(input.body), lastDirection: 'inbound', ...(waiting && { unreadCount: { increment: 1 }, needsResponse: true }) },
    })
    if (waiting) {
      const who = conversation.memberId ? (await db.member.findUnique({ where: { id: conversation.memberId }, select: { name: true } }))?.name
        : conversation.prospectId ? (await db.prospect.findUnique({ where: { id: conversation.prospectId }, select: { name: true } }))?.name : null
      await notify(db, { ownerId, type: 'sms', title: `New text from ${who || from}`, body: preview(input.body), href: `/communication/inbox?open=${conversation.id}`, staffId: conversation.assignedStaffId })
    }
    return { status: 'received' as const, ownerId, conversationId: updated.id, messageId: message.id, memberId: conversation.memberId, keyword }
  }, { timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// Delivery reports
// ---------------------------------------------------------------------------

const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3 }

/** Apply a delivery report. Reports arrive out of order and more than once; a final state is never undone. */
export async function applySmsStatus(input: { sid: string; status: string; errorCode?: string | null; errorMessage?: string | null }) {
  const message = await prisma.message.findFirst({ where: { providerId: input.sid, channel: 'sms', direction: 'outbound' } })
  if (!message) return { status: 'unknown' as const }
  const next = ['queued', 'accepted', 'scheduled'].includes(input.status) ? null : input.status === 'sending' ? null : ['sent', 'delivered', 'undelivered', 'failed'].includes(input.status) ? input.status : null
  if (!next) return { status: 'ignored' as const, ownerId: message.ownerId }
  if ((RANK[message.status] ?? 0) >= 3 && message.status !== next) return { status: 'ignored' as const, ownerId: message.ownerId }
  if ((RANK[next] ?? 0) < (RANK[message.status] ?? 0)) return { status: 'ignored' as const, ownerId: message.ownerId }
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === 'delivered' && { deliveredAt: new Date() }),
      ...(input.errorCode && { errorCode: String(input.errorCode) }),
      ...((next === 'failed' || next === 'undelivered') && { error: input.errorMessage || describeSmsError(input.errorCode) }),
    },
  })
  // The carrier says they have unsubscribed: stop everything for that number here too.
  if (input.errorCode && OPTED_OUT_CODES.includes(String(input.errorCode)) && message.toAddress) {
    await prisma.$transaction((db) => stopPhone(db, message.ownerId, message.toAddress!, 'carrier', 'The carrier reported this number as unsubscribed'))
  }
  return { status: 'updated' as const, ownerId: message.ownerId, messageId: message.id, to: next }
}

/** A plain-language reading of the provider codes staff are most likely to meet. */
export function describeSmsError(code?: string | null) {
  switch (String(code || '')) {
    case '21610': return 'They have opted out of texts from this number.'
    case '21211': case '21614': return 'That is not a valid mobile number.'
    case '30003': return 'Their phone is unreachable or switched off.'
    case '30004': return 'Their carrier is blocking the message.'
    case '30005': return 'That number does not exist or is no longer in service.'
    case '30006': return 'That is a landline or cannot receive texts.'
    case '30007': return 'The carrier filtered the message as spam.'
    case '30008': return 'The carrier could not deliver it.'
    default: return code ? `The carrier could not deliver it (code ${code}).` : 'The carrier could not deliver it.'
  }
}

// ---------------------------------------------------------------------------
// Staff inbox
// ---------------------------------------------------------------------------

export async function listConversations(ownerId: string, options: { filter?: string | null; search?: string | null; take?: number }) {
  const search = (options.search || '').trim()
  const digits = search.replace(/\D/g, '')
  const names = search ? await prisma.member.findMany({ where: { ownerId, name: { contains: search, mode: 'insensitive' } }, select: { id: true }, take: 50 }) : []
  const leads = search ? await prisma.prospect.findMany({ where: { ownerId, name: { contains: search, mode: 'insensitive' } }, select: { id: true }, take: 50 }) : []
  const rows = await prisma.smsConversation.findMany({
    where: {
      ownerId,
      ...(options.filter === 'unread' && { unreadCount: { gt: 0 } }),
      ...(options.filter === 'needs_response' && { needsResponse: true }),
      ...(search && { OR: [{ memberId: { in: names.map((n) => n.id) } }, { prospectId: { in: leads.map((l) => l.id) } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []), { lastPreview: { contains: search, mode: 'insensitive' as const } }] }),
    },
    orderBy: { lastMessageAt: 'desc' },
    take: Math.min(100, options.take || 60),
  })
  const [members, prospects, staff, counts] = await Promise.all([
    prisma.member.findMany({ where: { ownerId, id: { in: rows.map((r) => r.memberId).filter(Boolean) as string[] } }, select: { id: true, name: true, photoUrl: true, status: true, smsOptIn: true, smsMarketingOptIn: true, smsStopped: true } }),
    prisma.prospect.findMany({ where: { ownerId, id: { in: rows.map((r) => r.prospectId).filter(Boolean) as string[] } }, select: { id: true, name: true, smsOptIn: true, smsStopped: true } }),
    prisma.staff.findMany({ where: { ownerId, id: { in: rows.map((r) => r.assignedStaffId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    prisma.smsConversation.aggregate({ where: { ownerId }, _sum: { unreadCount: true }, _count: { _all: true } }),
  ])
  const needs = await prisma.smsConversation.count({ where: { ownerId, needsResponse: true } })
  return {
    totals: { all: counts._count._all, unread: counts._sum.unreadCount || 0, needsResponse: needs },
    conversations: rows.map((r) => {
      const m = members.find((x) => x.id === r.memberId)
      const p = prospects.find((x) => x.id === r.prospectId)
      return {
        id: r.id, phone: r.phone, lastMessageAt: r.lastMessageAt, lastPreview: r.lastPreview, lastDirection: r.lastDirection, unreadCount: r.unreadCount, needsResponse: r.needsResponse,
        member: m ? { id: m.id, name: m.name, photoUrl: m.photoUrl, status: m.status } : null,
        lead: p ? { id: p.id, name: p.name } : null,
        stopped: m ? m.smsStopped : p ? p.smsStopped : false,
        assignedTo: staff.find((s) => s.id === r.assignedStaffId) || null,
      }
    }),
  }
}

export async function getConversation(ownerId: string, id: string, options: { markRead?: boolean } = {}) {
  const conversation = await prisma.smsConversation.findFirst({ where: { id, ownerId } })
  if (!conversation) throw notFound('Conversation')
  const [messages, member, lead, candidates, stoppedUnknown] = await Promise.all([
    prisma.message.findMany({
      where: { ownerId, channel: 'sms', OR: [{ conversationId: id }, ...(conversation.memberId ? [{ memberId: conversation.memberId }] : [])] },
      orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, direction: true, body: true, status: true, error: true, errorCode: true, kind: true, staffName: true, createdAt: true, sentAt: true, deliveredAt: true, readAt: true, automation: { select: { name: true } }, campaign: { select: { name: true } } },
    }),
    conversation.memberId ? prisma.member.findFirst({ where: { id: conversation.memberId, ownerId }, select: { id: true, name: true, photoUrl: true, status: true, phone: true, smsOptIn: true, smsMarketingOptIn: true, smsStopped: true } }) : null,
    conversation.prospectId ? prisma.prospect.findFirst({ where: { id: conversation.prospectId, ownerId }, select: { id: true, name: true, phone: true, smsOptIn: true, smsStopped: true } }) : null,
    !conversation.memberId && !conversation.prospectId ? peopleWithPhone(prisma, ownerId, conversation.phone) : null,
    phoneStopped(prisma, ownerId, conversation.phone),
  ])
  if (options.markRead && conversation.unreadCount > 0) await markConversationRead(ownerId, id)
  const possible = candidates ? await prisma.member.findMany({ where: { ownerId, id: { in: candidates.members.map((m) => m.id) } }, select: { id: true, name: true } }) : []
  const stopped = member ? member.smsStopped : lead ? lead.smsStopped : stoppedUnknown
  const canReply = !stopped && (member ? member.smsOptIn || !!conversation.lastInboundAt : lead ? lead.smsOptIn || !!conversation.lastInboundAt : !!conversation.lastInboundAt)
  return {
    id: conversation.id, phone: conversation.phone, unreadCount: options.markRead ? 0 : conversation.unreadCount, needsResponse: conversation.needsResponse, assignedStaffId: conversation.assignedStaffId,
    member, lead, possibleMembers: possible,
    consent: { stopped, validPhone: true, operational: member ? member.smsOptIn : lead ? lead.smsOptIn : false, marketing: member ? member.smsMarketingOptIn : false, canReply, reason: stopped ? 'They replied STOP. Nothing can be sent until they text START.' : canReply ? null : 'They have not agreed to texts yet. Ask them to opt in, or to text this number first.' },
    messages: messages.reverse().map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status, error: m.error, errorCode: m.errorCode, kind: m.kind, sender: m.direction === 'inbound' ? null : m.staffName || m.automation?.name || m.campaign?.name || 'Automatic', at: m.createdAt, deliveredAt: m.deliveredAt })),
  }
}

/**
 * The text thread for one member or lead, whether or not anything has been sent yet.
 * Same shape as getConversation, with id null until there is a conversation.
 */
export async function getPersonThread(ownerId: string, who: { memberId?: string; prospectId?: string }, options: { markRead?: boolean } = {}) {
  const existing = await prisma.smsConversation.findFirst({ where: { ownerId, ...(who.memberId ? { memberId: who.memberId } : { prospectId: who.prospectId }) }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } })
  if (existing) return getConversation(ownerId, existing.id, options)
  const member = who.memberId ? await prisma.member.findFirst({ where: { id: who.memberId, ownerId }, select: { id: true, name: true, photoUrl: true, status: true, phone: true, smsOptIn: true, smsMarketingOptIn: true, smsStopped: true } }) : null
  const lead = who.prospectId ? await prisma.prospect.findFirst({ where: { id: who.prospectId, ownerId }, select: { id: true, name: true, phone: true, smsOptIn: true, smsStopped: true } }) : null
  const person = member || lead
  if (!person) throw notFound(who.memberId ? 'Member' : 'Lead')
  const phone = toE164(person.phone)
  // Texts sent before conversations existed still belong on the member's thread.
  const earlier = member ? await prisma.message.findMany({ where: { ownerId, channel: 'sms', memberId: member.id }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, direction: true, body: true, status: true, error: true, errorCode: true, kind: true, staffName: true, createdAt: true, deliveredAt: true, automation: { select: { name: true } }, campaign: { select: { name: true } } } }) : []
  const canReply = !!phone && !person.smsStopped && person.smsOptIn
  return {
    id: null as string | null, phone, unreadCount: 0, needsResponse: false, assignedStaffId: null as string | null,
    member, lead, possibleMembers: [] as { id: string; name: string }[],
    consent: {
      stopped: person.smsStopped, validPhone: !!phone, operational: person.smsOptIn, marketing: member ? member.smsMarketingOptIn : false, canReply,
      reason: !phone ? 'There is no valid mobile number on file.' : person.smsStopped ? 'They replied STOP. Nothing can be sent until they text START.' : canReply ? null : 'They have not agreed to texts yet. Ask them to opt in, or to text this number first.',
    },
    messages: earlier.reverse().map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status, error: m.error, errorCode: m.errorCode, kind: m.kind, sender: m.direction === 'inbound' ? null : m.staffName || m.automation?.name || m.campaign?.name || 'Automatic', at: m.createdAt, deliveredAt: m.deliveredAt })),
  }
}

export async function markConversationRead(ownerId: string, id: string, needsResponse?: boolean) {
  const result = await prisma.smsConversation.updateMany({ where: { id, ownerId }, data: { unreadCount: 0, ...(needsResponse !== undefined && { needsResponse }) } })
  if (result.count === 0) throw notFound('Conversation')
  await prisma.message.updateMany({ where: { ownerId, conversationId: id, direction: 'inbound', readAt: null }, data: { readAt: new Date() } })
}

/** Called when an outbound text is queued, so the thread shows it and stops asking for a reply. */
export async function noteOutbound(db: Db, conversationId: string, body: string, fromStaff: boolean) {
  await db.smsConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastOutboundAt: new Date(), lastPreview: preview(body), lastDirection: 'outbound', ...(fromStaff && { needsResponse: false, unreadCount: 0 }) } })
}
