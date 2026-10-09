// Priority 6: production SMS and two-way messaging, plus the two clean-ups that came with it
// (location locking on the older list pages, and one coach never teaching two classes at once).
//
// The service tests swap in a recording carrier. The HTTP tests need `npm run dev` started with
//   SMS_PROVIDER=simulate TWILIO_AUTH_TOKEN=local-test-token TWILIO_WEBHOOK_BASE_URL=http://localhost:3000 CRON_SECRET=local-cron-secret
// so that the server sends through the simulated carrier and accepts webhooks signed with that token.
// No test sends a real text.

import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { SmsSendInput, SmsSendResult, setSmsProviderForTests, toE164, twilioSignature, validTwilioSignature } from '@/lib/messaging/sms'
import { deliverMessage, deliverQueued, queueMessage, sendMessage } from '@/lib/services/messaging'
import { applySmsStatus, receiveInboundSms, setSmsConsent } from '@/lib/services/sms'
import { cancelScheduledCampaign, previewCampaign, runScheduledCampaigns, scheduleCampaign, sendCampaign } from '@/lib/services/campaigns'
import { fireTrigger, processDueRuns } from '@/lib/services/automations'
import { bookAppointment, cancelAppointment, rescheduleAppointment } from '@/lib/services/appointments'
import { bookClass, cancelBooking } from '@/lib/services/bookings'
import { sellMembership } from '@/lib/services/memberships'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

const TZ = 'America/New_York'
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const TOKEN = process.env.TEST_TWILIO_AUTH_TOKEN || 'local-test-token'
let up = false
let simulated = false
try {
  up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0
  // The webhook answers 503 when the server has no auth token: then the HTTP half cannot run.
  simulated = up && (await fetch(`${BASE}/api/webhooks/twilio/status`, { method: 'POST', body: '', signal: AbortSignal.timeout(20_000) })).status === 403
} catch {}

const today = zonedParts(new Date(), TZ).date
const day = (n: number) => addDaysToDate(today, n)
const at = (date: string, time: string) => zonedToUtc(date, time, TZ)

/** A US mobile nobody else in the suite uses. The last four never match the simulator's special endings. */
const phone = () => `+1415${randomInt(200, 999)}${randomInt(1000, 9999)}`
const sid = () => `SM${randomUUID().replace(/-/g, '')}`

/** A carrier that records what it was asked to send and answers however the test says. */
const sent: SmsSendInput[] = []
let answer: (input: SmsSendInput) => SmsSendResult = () => ({ ok: true, id: sid() })
const carrier = { name: 'test', async send(input: SmsSendInput) { sent.push(input); return answer(input) } }
const sentTo = (number: string) => sent.filter((s) => s.to === number)

async function gymWithNumber(overrides: Record<string, unknown> = {}) {
  const id = await createGym({ timezone: TZ, waitlistOfferMinutes: 0, ...overrides })
  const number = phone()
  await prisma.smsNumber.create({ data: { ownerId: id, number } })
  return { id, number }
}

type Consent = 'none' | 'operational' | 'marketing'
async function person(ownerId: string, consent: Consent = 'operational', data: Record<string, unknown> = {}) {
  return createMember(ownerId, { phone: phone(), smsOptIn: consent !== 'none', smsMarketingOptIn: consent === 'marketing', ...data })
}
const inbound = (gym: { number: string }, from: string, body: string, id = sid()) => receiveInboundSms({ sid: id, from, to: gym.number, body })

let gym: { id: string; number: string }
let other: { id: string; number: string }

beforeAll(async () => {
  setSmsProviderForTests(carrier)
  gym = await gymWithNumber()
  other = await gymWithNumber()
})
afterEach(() => { answer = () => ({ ok: true, id: sid() }) })
afterAll(async () => {
  setSmsProviderForTests(undefined)
  await destroyGym(gym.id)
  await destroyGym(other.id)
})

describe('phone numbers', () => {
  it('normalises what people type and refuses what cannot be a number', () => {
    expect(toE164('(207) 555-0142')).toBe('+12075550142')
    expect(toE164('1-207-555-0142')).toBe('+12075550142')
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958')
    for (const bad of ['555-0142', '123', '', null, 'call me', '0000000000']) expect(toE164(bad as any), String(bad)).toBeNull()
  })
})

describe('outbound texts', () => {
  it('sends from the gym\'s number, records the carrier\'s id and opens a conversation', async () => {
    const m = await person(gym.id)
    const message = await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Hi {{first_name}}, see you at {{gym_name}}', kind: 'conversation', staff: { name: 'Sam' } })
    expect(message).toMatchObject({ status: 'sent', direction: 'outbound', toAddress: m.phone, fromAddress: gym.number, staffName: 'Sam', attempts: 1 })
    expect(message.providerId).toMatch(/^SM/)
    const [call] = sentTo(m.phone!)
    expect(call).toMatchObject({ from: gym.number, body: 'Hi Member, see you at Test Gym' })
    expect(call.statusCallback).toMatch(/\/api\/webhooks\/twilio\/status$/)
    const thread = await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: gym.id, phone: m.phone! } } })
    expect(thread).toMatchObject({ memberId: m.id, lastDirection: 'outbound', unreadCount: 0, needsResponse: false })
    expect(message.conversationId).toBe(thread.id)
  })

  it('follows delivery reports forward only: delivered is never undone by a late or repeated report', async () => {
    const m = await person(gym.id)
    const message = await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Hello', kind: 'operational' })
    expect((await applySmsStatus({ sid: message.providerId!, status: 'queued' })).status).toBe('ignored')
    expect((await applySmsStatus({ sid: message.providerId!, status: 'delivered' })).status).toBe('updated')
    let row = await prisma.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(row.status).toBe('delivered')
    expect(row.deliveredAt).toBeTruthy()
    // Out of order and repeated reports.
    for (const status of ['sent', 'delivered', 'failed', 'undelivered']) await applySmsStatus({ sid: message.providerId!, status, errorCode: '30003' })
    row = await prisma.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(row.status).toBe('delivered')
    expect((await applySmsStatus({ sid: sid(), status: 'delivered' })).status).toBe('unknown')
  })

  it('records an undelivered report with a reason staff can read', async () => {
    const m = await person(gym.id)
    const message = await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Hello', kind: 'operational' })
    await applySmsStatus({ sid: message.providerId!, status: 'undelivered', errorCode: '30005' })
    const row = await prisma.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(row).toMatchObject({ status: 'undelivered', errorCode: '30005' })
    expect(row.error).toBeTruthy()
  })

  it('does not retry a failure that can never succeed', async () => {
    const m = await person(gym.id)
    answer = () => ({ ok: false, error: 'Not a valid phone number', code: '21211', retryable: false })
    const message = await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Hello', kind: 'operational' })
    expect(message).toMatchObject({ status: 'failed', errorCode: '21211', attempts: 1, nextAttemptAt: null })
    await deliverQueued(gym.id, 50, new Date(Date.now() + DAY))
    expect(sentTo(m.phone!)).toHaveLength(1)
  })

  it('retries a temporary failure with a growing wait, then gives up', async () => {
    const m = await person(gym.id)
    answer = () => ({ ok: false, error: 'Too many requests', code: '20429', retryable: true })
    const first = await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Hello', kind: 'operational' })
    expect(first).toMatchObject({ status: 'queued', attempts: 1, errorCode: '20429' })
    expect(first.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20_000)
    // Not yet due: nothing happens.
    await deliverQueued(gym.id, 50)
    expect(sentTo(m.phone!)).toHaveLength(1)
    // Due: it goes again, and this time the carrier takes it.
    answer = () => ({ ok: true, id: sid() })
    await deliverQueued(gym.id, 50, new Date(Date.now() + 5 * 60_000))
    expect(sentTo(m.phone!)).toHaveLength(2)
    expect(await prisma.message.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'sent', attempts: 2, nextAttemptAt: null, error: null })

    // One that never recovers stops after five attempts.
    const n = await person(gym.id)
    answer = () => ({ ok: false, error: 'Carrier outage', code: '30001', retryable: true })
    const doomed = await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: n.id, body: 'Hello', kind: 'operational' })
    for (let i = 1; i <= 8; i++) await deliverMessage(doomed.id, new Date(Date.now() + i * HOUR))
    expect(await prisma.message.findUniqueOrThrow({ where: { id: doomed.id } })).toMatchObject({ status: 'failed', attempts: 5 })
    expect(sentTo(n.phone!)).toHaveLength(5)
  })

  it('sends one logical message once, however many times and however simultaneously it is asked for', async () => {
    const m = await person(gym.id)
    const key = `test:${randomUUID()}`
    const input = { ownerId: gym.id, channel: 'sms' as const, memberId: m.id, body: 'Only once', kind: 'operational' as const, dedupeKey: key }
    const results = await Promise.all(Array.from({ length: 6 }, () => sendMessage(input)))
    await sendMessage(input)
    expect(new Set(results.map((r) => r.id)).size).toBe(1)
    expect(await prisma.message.count({ where: { ownerId: gym.id, dedupeKey: key } })).toBe(1)
    expect(sentTo(m.phone!)).toHaveLength(1)
  })

  it('never hands the same queued message to the carrier twice when two workers pick it up', async () => {
    const m = await person(gym.id)
    const queued = await queueMessage(prisma, { ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Race', kind: 'operational' })
    await Promise.all([deliverMessage(queued.id), deliverMessage(queued.id), deliverQueued(gym.id, 50), deliverQueued(gym.id, 50)])
    expect(sentTo(m.phone!)).toHaveLength(1)
  })

  it('holds a scheduled text until its time and drops one that has gone stale', async () => {
    const m = await person(gym.id)
    const later = await queueMessage(prisma, { ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Later', kind: 'operational', sendAfter: new Date(Date.now() + HOUR) })
    await deliverQueued(gym.id, 50)
    expect(sentTo(m.phone!)).toHaveLength(0)
    await deliverQueued(gym.id, 50, new Date(Date.now() + 2 * HOUR))
    expect(sentTo(m.phone!)).toHaveLength(1)
    expect((await prisma.message.findUniqueOrThrow({ where: { id: later.id } })).status).toBe('sent')

    const stale = await queueMessage(prisma, { ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Starting soon', kind: 'operational', expiresAt: new Date(Date.now() - 1000) })
    await deliverQueued(gym.id, 50)
    expect((await prisma.message.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('expired')
    expect(sentTo(m.phone!)).toHaveLength(1)
  })

  it('records why nothing was sent when texting is not set up, or the number is unusable', async () => {
    const bad = await createMember(gym.id, { phone: '555-0142', smsOptIn: true })
    expect(await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: bad.id, body: 'x', kind: 'operational' })).toMatchObject({ status: 'skipped', error: 'No valid mobile number on file' })
    const none = await createMember(gym.id, { smsOptIn: true })
    expect((await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: none.id, body: 'x', kind: 'operational' })).status).toBe('skipped')

    const m = await person(gym.id)
    setSmsProviderForTests(null)
    try {
      expect(await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'x', kind: 'operational' })).toMatchObject({ status: 'skipped', error: 'SMS delivery is not configured' })
    } finally { setSmsProviderForTests(carrier) }
    expect(sentTo(m.phone!)).toHaveLength(0)
  })
})

describe('consent', () => {
  const kinds = ['marketing', 'operational', 'conversation'] as const
  const tryAll = async (memberId: string) => Object.fromEntries(await Promise.all(kinds.map(async (kind) => [kind, (await sendMessage({ ownerId: gym.id, channel: 'sms', memberId, body: kind, kind })).status]))) as Record<(typeof kinds)[number], string>

  it('does not treat a phone number on file as consent to anything', async () => {
    const m = await person(gym.id, 'none')
    expect(await tryAll(m.id)).toEqual({ marketing: 'skipped', operational: 'skipped', conversation: 'skipped' })
    expect(sentTo(m.phone!)).toHaveLength(0)
    const rows = await prisma.message.findMany({ where: { ownerId: gym.id, memberId: m.id } })
    expect(rows.every((r) => r.error)).toBe(true)
  })

  it('keeps marketing consent separate from reminders', async () => {
    const reminders = await person(gym.id, 'operational')
    expect(await tryAll(reminders.id)).toEqual({ marketing: 'skipped', operational: 'sent', conversation: 'sent' })
    expect((await prisma.message.findFirstOrThrow({ where: { memberId: reminders.id, kind: 'marketing' } })).error).toBe('No consent to marketing texts')
    const everything = await person(gym.id, 'marketing')
    expect(await tryAll(everything.id)).toEqual({ marketing: 'sent', operational: 'sent', conversation: 'sent' })
  })

  it('records every change with who made it, and a change that changes nothing is not recorded', async () => {
    const m = await person(gym.id, 'none')
    const change = (scope: 'operational' | 'marketing', optedIn: boolean) => tx((db) => setSmsConsent(db, { ownerId: gym.id, memberId: m.id, scope, optedIn, source: 'staff', method: 'Asked at the desk', actorName: 'Jo' }))
    expect(await change('operational', true)).toBeTruthy()
    expect(await change('operational', true)).toBeFalsy()
    expect(await change('marketing', true)).toBeTruthy()
    let row = await prisma.member.findUniqueOrThrow({ where: { id: m.id } })
    expect(row).toMatchObject({ smsOptIn: true, smsMarketingOptIn: true, smsStopped: false })
    expect(row.smsConsentAt).toBeTruthy()
    // Turning reminders off turns marketing off with it: nobody gets promotions but not reminders.
    await change('operational', false)
    row = await prisma.member.findUniqueOrThrow({ where: { id: m.id } })
    expect(row).toMatchObject({ smsOptIn: false, smsMarketingOptIn: false })
    const events = await prisma.smsConsentEvent.findMany({ where: { ownerId: gym.id, memberId: m.id }, orderBy: { createdAt: 'asc' } })
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events[0]).toMatchObject({ scope: 'operational', status: 'opted_in', source: 'staff', method: 'Asked at the desk', actorName: 'Jo', phone: m.phone })
  })

  it('STOP ends everything at once, staff cannot undo it, and START restores reminders but not marketing', async () => {
    const m = await person(gym.id, 'marketing')
    for (const word of ['stop', ' Stop. ', 'UNSUBSCRIBE']) {
      const got = await inbound(gym, m.phone!, word)
      expect(got).toMatchObject({ status: 'received', keyword: 'stop' })
    }
    let row = await prisma.member.findUniqueOrThrow({ where: { id: m.id } })
    expect(row).toMatchObject({ smsStopped: true, smsOptIn: false, smsMarketingOptIn: false })
    expect(row.smsStoppedAt).toBeTruthy()
    expect(await tryAll(m.id)).toEqual({ marketing: 'skipped', operational: 'skipped', conversation: 'skipped' })
    expect((await prisma.message.findFirstOrThrow({ where: { memberId: m.id, direction: 'outbound', status: 'skipped' } })).error).toContain('STOP')
    expect(sentTo(m.phone!)).toHaveLength(0)
    // An opt-out is not a message waiting for an answer.
    expect(await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: gym.id, phone: m.phone! } } })).toMatchObject({ unreadCount: 0, needsResponse: false })
    expect(await prisma.smsConsentEvent.findFirst({ where: { memberId: m.id, scope: 'all', status: 'opted_out', source: 'keyword' } })).toBeTruthy()

    // Nobody on staff can switch it back on.
    for (const scope of ['operational', 'marketing'] as const) {
      await expect(tx((db) => setSmsConsent(db, { ownerId: gym.id, memberId: m.id, scope, optedIn: true, source: 'staff', method: 'They said it was fine', actorName: 'Jo' }))).rejects.toMatchObject({ status: 409, code: 'sms_stopped' })
    }
    expect((await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).smsStopped).toBe(true)

    // Only the person can, by texting START. That brings back reminders, never marketing.
    expect(await inbound(gym, m.phone!, 'START')).toMatchObject({ keyword: 'start' })
    row = await prisma.member.findUniqueOrThrow({ where: { id: m.id } })
    expect(row).toMatchObject({ smsStopped: false, smsOptIn: true, smsMarketingOptIn: false })
    expect(await tryAll(m.id)).toEqual({ marketing: 'skipped', operational: 'sent', conversation: 'sent' })
  })

  it('honours a STOP that arrives after a text was queued but before it went out', async () => {
    const m = await person(gym.id, 'marketing')
    const queued = await queueMessage(prisma, { ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Sale!', kind: 'marketing' })
    expect(queued.status).toBe('queued')
    await inbound(gym, m.phone!, 'STOP')
    expect(await deliverMessage(queued.id)).toMatchObject({ status: 'skipped' })
    expect(sentTo(m.phone!)).toHaveLength(0)
  })

  it('stops a number the carrier reports as unsubscribed', async () => {
    const m = await person(gym.id, 'marketing')
    answer = () => ({ ok: false, error: 'Attempt to send to unsubscribed recipient', code: '21610', retryable: false })
    expect((await sendMessage({ ownerId: gym.id, channel: 'sms', memberId: m.id, body: 'Hi', kind: 'operational' })).status).toBe('failed')
    expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ smsStopped: true, smsOptIn: false })
    expect(await prisma.smsConsentEvent.findFirst({ where: { memberId: m.id, source: 'carrier' } })).toBeTruthy()
  })

  it('applies a STOP to this gym only, and to everyone at the gym who shares the number', async () => {
    const shared = phone()
    const [a, b] = await Promise.all([person(gym.id, 'marketing', { phone: shared }), person(gym.id, 'operational', { phone: shared })])
    const elsewhere = await person(other.id, 'marketing', { phone: shared })
    await inbound(gym, shared, 'STOP')
    for (const m of [a, b]) expect((await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).smsStopped).toBe(true)
    expect(await prisma.member.findUniqueOrThrow({ where: { id: elsewhere.id } })).toMatchObject({ smsStopped: false, smsMarketingOptIn: true })
  })

  it('needs a lead\'s own consent too', async () => {
    const lead = await prisma.prospect.create({ data: { ownerId: gym.id, name: 'Lee Lead', email: `${randomUUID()}@test.local`, phone: phone() } })
    expect((await sendMessage({ ownerId: gym.id, channel: 'sms', prospectId: lead.id, body: 'Come try a class', kind: 'marketing' })).status).toBe('skipped')
    await tx((db) => setSmsConsent(db, { ownerId: gym.id, prospectId: lead.id, scope: 'operational', optedIn: true, source: 'lead_form', method: 'Ticked the box on the enquiry form' }))
    expect((await sendMessage({ ownerId: gym.id, channel: 'sms', prospectId: lead.id, body: 'Come try a class', kind: 'marketing' })).status).toBe('sent')
  })
})

describe('inbound texts', () => {
  it('lands in the right member\'s thread, unread and waiting, tells staff, and sends nothing back', async () => {
    const m = await person(gym.id)
    const before = { messages: sent.length, runs: await prisma.automationRun.count({ where: { ownerId: gym.id } }), campaigns: await prisma.campaign.count({ where: { ownerId: gym.id } }) }
    const got = await inbound(gym, m.phone!, 'Can I bring a friend tomorrow?')
    expect(got).toMatchObject({ status: 'received', memberId: m.id, keyword: null })
    const thread = await prisma.smsConversation.findUniqueOrThrow({ where: { id: (got as any).conversationId } })
    expect(thread).toMatchObject({ memberId: m.id, unreadCount: 1, needsResponse: true, lastDirection: 'inbound', lastPreview: 'Can I bring a friend tomorrow?' })
    const message = await prisma.message.findUniqueOrThrow({ where: { id: (got as any).messageId } })
    expect(message).toMatchObject({ direction: 'inbound', status: 'received', fromAddress: m.phone, toAddress: gym.number, memberId: m.id, readAt: null })
    expect(await prisma.notification.findFirst({ where: { ownerId: gym.id, type: 'sms', href: `/communication/inbox?open=${thread.id}` } })).toBeTruthy()
    // A reply is a reply: no auto-response, no automation, no campaign.
    expect(sent.length).toBe(before.messages)
    expect(await prisma.automationRun.count({ where: { ownerId: gym.id } })).toBe(before.runs)
    expect(await prisma.campaign.count({ where: { ownerId: gym.id } })).toBe(before.campaigns)
    expect(await prisma.message.count({ where: { ownerId: gym.id, conversationId: thread.id, direction: 'outbound' } })).toBe(0)
  })

  it('stores a webhook delivered twice as one message', async () => {
    const m = await person(gym.id)
    const id = sid()
    const results = await Promise.all([inbound(gym, m.phone!, 'Hello', id), inbound(gym, m.phone!, 'Hello', id), inbound(gym, m.phone!, 'Hello', id)])
    expect(results.filter((r) => r.status === 'received')).toHaveLength(1)
    expect((await inbound(gym, m.phone!, 'Hello', id)).status).toBe('duplicate')
    expect(await prisma.message.count({ where: { ownerId: gym.id, providerId: id } })).toBe(1)
    expect((await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: gym.id, phone: m.phone! } } })).unreadCount).toBe(1)
  })

  it('keeps a number nobody recognises as its own thread, which staff may answer but never market to', async () => {
    const stranger = phone()
    const got = await inbound(gym, stranger, 'What are your opening hours?')
    expect(got).toMatchObject({ status: 'received', memberId: null })
    const id = (got as any).conversationId
    expect(await prisma.smsConversation.findUniqueOrThrow({ where: { id } })).toMatchObject({ memberId: null, prospectId: null, phone: stranger })
    expect((await sendMessage({ ownerId: gym.id, channel: 'sms', conversationId: id, body: 'We open at 6', kind: 'conversation' })).status).toBe('sent')
    expect((await sendMessage({ ownerId: gym.id, channel: 'sms', conversationId: id, body: 'Join now!', kind: 'marketing' })).status).toBe('skipped')
    expect(sentTo(stranger)).toHaveLength(1)
    // And a stranger who says STOP is not written to again.
    await inbound(gym, stranger, 'stop')
    expect(await sendMessage({ ownerId: gym.id, channel: 'sms', conversationId: id, body: 'Sorry to see you go', kind: 'conversation' })).toMatchObject({ status: 'skipped' })
    expect(sentTo(stranger)).toHaveLength(1)
  })

  it('does not guess when two people share a number', async () => {
    const shared = phone()
    const [a, b] = await Promise.all([person(gym.id, 'operational', { phone: shared, name: 'Parent Shared' }), person(gym.id, 'operational', { phone: shared, name: 'Child Shared' })])
    const got = await inbound(gym, shared, 'Running late')
    expect(got).toMatchObject({ status: 'received', memberId: null })
    const { getConversation } = await import('@/lib/services/sms')
    const thread = await getConversation(gym.id, (got as any).conversationId)
    expect(thread.member).toBeNull()
    expect(thread.possibleMembers.map((p: any) => p.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('ignores a text to a number no gym uses, and keeps each gym\'s threads apart', async () => {
    expect((await receiveInboundSms({ sid: sid(), from: phone(), to: phone(), body: 'hi' })).status).toBe('unroutable')
    expect((await receiveInboundSms({ sid: sid(), from: 'not-a-number', to: gym.number, body: 'hi' })).status).toBe('ignored')
    // The same person is a member of both gyms: a text to one never shows in the other.
    const shared = phone()
    const [here, there] = await Promise.all([person(gym.id, 'operational', { phone: shared }), person(other.id, 'operational', { phone: shared })])
    const got = await inbound(other, shared, 'Question for the other gym')
    expect(got).toMatchObject({ ownerId: other.id, memberId: there.id })
    expect(await prisma.message.count({ where: { ownerId: gym.id, memberId: here.id } })).toBe(0)
    expect(await prisma.smsConversation.count({ where: { ownerId: gym.id, phone: shared } })).toBe(0)
  })
})

describe('webhook signatures', () => {
  it('accepts only a signature made with the account\'s token over the exact address and fields', () => {
    const url = 'https://example.test/api/webhooks/twilio/inbound'
    const params = { MessageSid: 'SM1', From: '+12075550142', To: '+12075550100', Body: 'Hi there' }
    // Twilio's documented algorithm, worked by hand: url + fields sorted by name, each name followed by its value.
    const good = twilioSignature('secret', url, params)
    expect(good).toMatch(/^[A-Za-z0-9+/]{27}=$/)
    expect(validTwilioSignature(good, [url], params, 'secret')).toBe(true)
    expect(validTwilioSignature(good, ['https://other.test/x', url], params, 'secret')).toBe(true)
    expect(validTwilioSignature(good, [url], { ...params, Body: 'Hi there!' }, 'secret')).toBe(false)
    expect(validTwilioSignature(good, [url], { ...params, From: '+12075550143' }, 'secret')).toBe(false)
    expect(validTwilioSignature(good, [url + '?x=1'], params, 'secret')).toBe(false)
    expect(validTwilioSignature(good, [url], params, 'another-secret')).toBe(false)
    expect(validTwilioSignature(null, [url], params, 'secret')).toBe(false)
    expect(validTwilioSignature('', [url], params, 'secret')).toBe(false)
    expect(validTwilioSignature(good, [url], params, '')).toBe(false)
  })
})

describe('campaigns', () => {
  let cg: { id: string; number: string }
  let people: Record<string, Awaited<ReturnType<typeof createMember>>>
  const campaign = (ownerId: string, data: Record<string, unknown> = {}) => prisma.campaign.create({ data: { ownerId, name: 'Summer offer', channel: 'sms', body: '{{gym_name}}: bring a friend free this week. Reply STOP to opt out.', audience: { type: 'all_members' }, ...data } })

  beforeAll(async () => {
    cg = await gymWithNumber()
    people = {
      yes: await person(cg.id, 'marketing'),
      remindersOnly: await person(cg.id, 'operational'),
      never: await person(cg.id, 'none'),
      noPhone: await createMember(cg.id, { smsOptIn: true, smsMarketingOptIn: true }),
      stopped: await person(cg.id, 'marketing'),
    }
    await inbound(cg, people.stopped.phone!, 'STOP')
  })
  afterAll(async () => { await destroyGym(cg.id) })

  it('says who a text campaign would reach, and why the rest are left out, before anything is sent', async () => {
    const reach = await previewCampaign(cg.id, 'sms', { type: 'all_members' })
    expect(reach).toMatchObject({ recipients: 5, eligible: 1 })
    expect(Object.fromEntries(reach.blocked.map((b) => [b.reason, b.count]))).toEqual({ 'No consent to marketing texts': 2, 'No valid mobile number': 1, 'Replied STOP': 1 })
    expect(sent.filter((s) => s.from === cg.number)).toHaveLength(0)
  })

  it('texts only people who agreed to marketing, and keeps a reason for everyone else', async () => {
    const c = await campaign(cg.id)
    const result = await sendCampaign(cg.id, c.id, { name: 'Owner' })
    expect(result).toMatchObject({ recipients: 5, sent: 1, skipped: 4, failed: 0, remaining: 0 })
    expect(sent.filter((s) => s.from === cg.number).map((s) => s.to)).toEqual([people.yes.phone])
    const rows = await prisma.message.findMany({ where: { ownerId: cg.id, campaignId: c.id } })
    expect(rows).toHaveLength(5)
    expect(rows.filter((r) => r.status === 'skipped').every((r) => r.error)).toBe(true)
    expect(rows.find((r) => r.memberId === people.yes.id)).toMatchObject({ status: 'sent', kind: 'marketing', staffName: 'Owner' })
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('sent')
  })

  it('sends a campaign once even when two people press send at the same moment', async () => {
    const c = await campaign(cg.id)
    const before = sentTo(people.yes.phone!).length
    const results = await Promise.allSettled([sendCampaign(cg.id, c.id), sendCampaign(cg.id, c.id), sendCampaign(cg.id, c.id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await expect(sendCampaign(cg.id, c.id)).rejects.toMatchObject({ code: 'already_sent' })
    expect(await prisma.message.count({ where: { ownerId: cg.id, campaignId: c.id } })).toBe(5)
    expect(sentTo(people.yes.phone!).length).toBe(before + 1)
  })

  it('works a large send off in batches without repeating anyone', async () => {
    const big = await gymWithNumber()
    try {
      await prisma.member.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ ownerId: big.id, name: `Bulk ${i}`, email: `${randomUUID()}@test.local`, qrCode: `clubcheck-member-${randomUUID()}`, phone: phone(), smsOptIn: true, smsMarketingOptIn: true })) })
      const c = await campaign(big.id)
      const first = await sendCampaign(big.id, c.id)
      expect(first.recipients).toBe(60)
      expect(first.remaining).toBeGreaterThan(0)
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('sending')
      const { drainOutbox } = await import('@/lib/services/outbox')
      for (let i = 0; i < 6; i++) await Promise.all([drainOutbox(big.id, 40), drainOutbox(big.id, 40)])
      const mine = sent.filter((s) => s.from === big.number)
      expect(mine).toHaveLength(60)
      expect(new Set(mine.map((s) => s.to)).size).toBe(60)
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('sent')
    } finally { await destroyGym(big.id) }
  })

  it('holds a scheduled campaign until its time, and lets it be cancelled before then', async () => {
    const c = await campaign(cg.id)
    await expect(scheduleCampaign(cg.id, c.id, new Date(Date.now() - HOUR))).rejects.toMatchObject({ code: 'too_soon' })
    await scheduleCampaign(cg.id, c.id, new Date(Date.now() + 2 * HOUR))
    await runScheduledCampaigns(cg.id)
    expect(await prisma.message.count({ where: { campaignId: c.id } })).toBe(0)
    await runScheduledCampaigns(cg.id, new Date(Date.now() + 3 * HOUR))
    expect(await prisma.message.count({ where: { campaignId: c.id } })).toBe(5)
    await expect(cancelScheduledCampaign(cg.id, c.id)).rejects.toMatchObject({ code: 'not_scheduled' })

    const d = await campaign(cg.id)
    await scheduleCampaign(cg.id, d.id, new Date(Date.now() + 2 * HOUR))
    await cancelScheduledCampaign(cg.id, d.id)
    await runScheduledCampaigns(cg.id, new Date(Date.now() + 3 * HOUR))
    expect(await prisma.message.count({ where: { campaignId: d.id } })).toBe(0)
    // Another gym cannot schedule, cancel or send it.
    await expect(scheduleCampaign(other.id, d.id, new Date(Date.now() + 2 * HOUR))).rejects.toMatchObject({ code: 'not_draft' })
    await expect(sendCampaign(other.id, d.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('automations', () => {
  let ag: { id: string; number: string }
  const automation = (data: Record<string, unknown>) => prisma.automation.create({ data: { ownerId: ag.id, name: 'Test', channel: 'sms', body: 'Hi {{first_name}}', delayMinutes: 0, isActive: true, ...data } as any })
  const from = () => sent.filter((s) => s.from === ag.number)

  beforeAll(async () => { ag = await gymWithNumber() })
  afterAll(async () => { await destroyGym(ag.id) })
  afterEach(async () => { await prisma.automation.deleteMany({ where: { ownerId: ag.id } }) })

  it('sends by email, by text, or both, each under its own consent', async () => {
    const a = await automation({ trigger: 'member_joined', channel: 'both', subject: 'Welcome', body: 'Welcome {{first_name}}' })
    const [full, remindersOnly] = await Promise.all([person(ag.id, 'marketing'), person(ag.id, 'operational')])
    for (const m of [full, remindersOnly]) await fireTrigger(prisma, ag.id, 'member_joined', { memberId: m.id, dedupeKey: m.id })
    await processDueRuns(ag.id)
    const rows = await prisma.message.findMany({ where: { ownerId: ag.id, automationId: a.id } })
    expect(rows).toHaveLength(4)
    expect(rows.filter((r) => r.channel === 'email')).toHaveLength(2)
    // A welcome is marketing: the text goes only to the member who agreed to marketing texts.
    expect(rows.find((r) => r.channel === 'sms' && r.memberId === full.id)).toMatchObject({ status: 'sent', kind: 'marketing' })
    expect(rows.find((r) => r.channel === 'sms' && r.memberId === remindersOnly.id)).toMatchObject({ status: 'skipped', error: 'No consent to marketing texts' })
    expect(from().map((s) => s.to)).toEqual([full.phone])
  })

  it('texts about a failed payment to anyone who agreed to reminders, once per failure', async () => {
    await automation({ trigger: 'payment_failed', body: '{{gym_name}}: your payment of {{amount}} did not go through.' })
    const m = await person(ag.id, 'operational')
    const before = from().length
    for (let i = 0; i < 3; i++) await fireTrigger(prisma, ag.id, 'payment_failed', { memberId: m.id, dedupeKey: 'inv-1:attempt-1', context: { amount: '$150.00' } })
    await Promise.all([processDueRuns(ag.id), processDueRuns(ag.id), processDueRuns(ag.id)])
    const mine = from().slice(before)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ to: m.phone, body: 'Test Gym: your payment of $150.00 did not go through.' })
    expect(await prisma.message.findFirstOrThrow({ where: { ownerId: ag.id, memberId: m.id, channel: 'sms' } })).toMatchObject({ kind: 'operational', status: 'sent' })
  })

  describe('appointment reminders', () => {
    let coach: { id: string }
    let type: { id: string }
    let plan: { id: string }
    const member = async (consent: Consent = 'operational') => {
      const m = await person(ag.id, consent)
      await tx((db) => sellMembership(db, { ownerId: ag.id, memberId: m.id, planId: plan.id, paymentMethod: 'cash', startDate: new Date(Date.now() - DAY) }))
      return m
    }
    const runs = (memberId: string) => prisma.automationRun.findMany({ where: { ownerId: ag.id, memberId, automation: { trigger: { in: ['appointment_reminder', 'appointment_soon'] } } }, include: { automation: true }, orderBy: { runAt: 'asc' } })

    beforeAll(async () => {
      plan = await createPlan(ag.id)
      coach = await prisma.staff.create({ data: { ownerId: ag.id, name: 'Coach Riley', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
      await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId: ag.id, staffId: coach.id, weekday, startMinute: 0, endMinute: 1440, kind: 'work' })) })
      type = await prisma.appointmentType.create({ data: { ownerId: ag.id, name: 'Personal Training', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 90, staff: { create: [{ staffId: coach.id, ownerId: ag.id }] } } })
    })

    it('times each reminder ahead of the appointment and follows it when it moves or is cancelled', async () => {
      await automation({ trigger: 'appointment_reminder', conditions: { hoursBefore: 24 }, body: 'Reminder: {{appointment_name}} with {{coach_name}} on {{appointment_time}}' })
      await automation({ trigger: 'appointment_soon', conditions: { minutesBefore: 60 }, body: '{{appointment_name}} starts at {{appointment_clock}}' })
      const m = await member()
      const startsAt = at(day(5), '10:00')
      const { appointment } = await bookAppointment({ ownerId: ag.id, typeId: type.id, memberId: m.id, staffId: coach.id, startsAt, source: 'staff' })
      let pending = await runs(m.id)
      expect(pending.map((r) => [r.automation.trigger, r.runAt.getTime(), r.status])).toEqual([
        ['appointment_reminder', startsAt.getTime() - 24 * HOUR, 'pending'],
        ['appointment_soon', startsAt.getTime() - HOUR, 'pending'],
      ])
      // Nothing is sent early.
      const before = from().length
      await processDueRuns(ag.id)
      expect(from().length).toBe(before)

      // Moved: the old reminders are withdrawn and new ones set for the new time.
      const moved = at(day(6), '14:00')
      await rescheduleAppointment({ ownerId: ag.id, appointmentId: appointment.id, startsAt: moved, by: 'staff' })
      pending = await runs(m.id)
      expect(pending.map((r) => r.runAt.getTime())).toEqual([moved.getTime() - 24 * HOUR, moved.getTime() - HOUR])

      // When the time comes, exactly one text, with the appointment's details in it.
      await prisma.automationRun.update({ where: { id: pending[0].id }, data: { runAt: new Date(Date.now() - 1000) } })
      await Promise.all([processDueRuns(ag.id), processDueRuns(ag.id)])
      const texts = from().slice(before).filter((s) => s.to === m.phone)
      expect(texts).toHaveLength(1)
      expect(texts[0].body).toContain('Reminder: Personal Training with Coach Riley on ')

      // Cancelled: the reminder still waiting is withdrawn.
      await cancelAppointment({ ownerId: ag.id, appointmentId: appointment.id, by: 'staff' })
      expect((await runs(m.id)).filter((r) => r.status === 'pending')).toHaveLength(0)
    })

    it('sets no reminder whose moment has already passed, and never sends one late', async () => {
      await automation({ trigger: 'appointment_reminder', conditions: { hoursBefore: 24 } })
      await automation({ trigger: 'appointment_soon', conditions: { minutesBefore: 60 }, body: 'Starting soon' })
      const m = await member()
      // Booked three hours ahead: too late for the day-before reminder, in time for the hour-before one.
      const startsAt = new Date(Math.ceil((Date.now() + 3 * HOUR) / 300_000) * 300_000)
      await bookAppointment({ ownerId: ag.id, typeId: type.id, memberId: m.id, staffId: coach.id, startsAt, source: 'staff', override: true })
      const pending = await runs(m.id)
      expect(pending.map((r) => r.automation.trigger)).toEqual(['appointment_soon'])
      // The queue was stuck until after the appointment began: the text is dropped, not sent late.
      await prisma.automationRun.update({ where: { id: pending[0].id }, data: { runAt: new Date(Date.now() - 1000), context: { ...(pending[0].context as object), not_after: new Date(Date.now() - 1000).toISOString() } } })
      const before = sentTo(m.phone!).length
      await processDueRuns(ag.id)
      expect(sentTo(m.phone!).length).toBe(before)
      expect(await prisma.automationRun.findUniqueOrThrow({ where: { id: pending[0].id } })).toMatchObject({ status: 'skipped' })
    })

    it('does not text a reminder to someone who has not agreed to texts', async () => {
      await automation({ trigger: 'appointment_booked', body: 'Booked: {{appointment_name}}' })
      const m = await member('none')
      await bookAppointment({ ownerId: ag.id, typeId: type.id, memberId: m.id, staffId: coach.id, startsAt: at(day(8), '09:00'), source: 'staff' })
      await processDueRuns(ag.id)
      expect(sentTo(m.phone!)).toHaveLength(0)
      expect(await prisma.message.findFirstOrThrow({ where: { ownerId: ag.id, memberId: m.id, channel: 'sms' } })).toMatchObject({ status: 'skipped', error: 'Has not agreed to text reminders' })
    })
  })

  it('texts a member who comes off the waitlist, once', async () => {
    const plan = await createPlan(ag.id)
    const join = async (consent: Consent) => {
      const m = await person(ag.id, consent)
      await tx((db) => sellMembership(db, { ownerId: ag.id, memberId: m.id, planId: plan.id, paymentMethod: 'cash', startDate: new Date(Date.now() - DAY) }))
      return m
    }
    const session = await createSession(ag.id, { capacity: 1, waitlistCapacity: 3 })
    const [holder, waiting] = [await join('operational'), await join('operational')]
    const booked = await tx((db) => bookClass(db, { ownerId: ag.id, memberId: holder.id, sessionId: session.id, source: 'staff' }))
    await tx((db) => bookClass(db, { ownerId: ag.id, memberId: waiting.id, sessionId: session.id, source: 'member', joinWaitlist: true }))
    expect(sentTo(waiting.phone!)).toHaveLength(0)
    await tx((db) => cancelBooking(db, { ownerId: ag.id, bookingId: (booked as any).booking?.id || (booked as any).id, by: 'staff' } as any))
    await Promise.all([deliverQueued(ag.id), deliverQueued(ag.id)])
    const texts = sentTo(waiting.phone!)
    expect(texts).toHaveLength(1)
    expect(texts[0].body).toContain('a spot opened up')
    expect(await prisma.message.findFirstOrThrow({ where: { ownerId: ag.id, memberId: waiting.id, channel: 'sms' } })).toMatchObject({ kind: 'operational', status: 'sent' })
  })
})

// ---------------------------------------------------------------------------
// Over HTTP: who may do what, and that nothing crosses between gyms.
// ---------------------------------------------------------------------------

async function call(auth: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, data: json?.data, text }
}

/** Post a form to a Twilio webhook the way Twilio does, signed with `token`. */
async function twilio(path: string, params: Record<string, string>, token: string | null = TOKEN, signedUrl = BASE + path) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(token !== null && { 'X-Twilio-Signature': twilioSignature(token, signedUrl, params) }) },
    body: new URLSearchParams(params),
  })
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') }
}

describe.skipIf(!simulated)('over HTTP', () => {
  const who: Record<string, { cookie: string; id: string }> = {}
  let owner: string
  let foreignOwner: string
  let downtown: { id: string }
  let uptown: { id: string }

  async function staffMember(role: string, extra: Record<string, unknown> = {}, ownerId = gym.id) {
    const row = await prisma.staff.create({ data: { ownerId, name: `${role} ${randomUUID().slice(0, 4)}`, email: `${randomUUID()}@test.local`, password: 'x', role, isCoach: role === 'coach' || role === 'trainer', ...extra } })
    return { id: row.id, cookie: `auth-token=${await createToken({ ownerId, staffId: row.id, role: role as any })}` }
  }

  beforeAll(async () => {
    owner = `auth-token=${await createToken({ ownerId: gym.id, emailVerified: true })}`
    foreignOwner = `auth-token=${await createToken({ ownerId: other.id, emailVerified: true })}`
    downtown = await prisma.location.create({ data: { ownerId: gym.id, name: 'Downtown' } })
    uptown = await prisma.location.create({ data: { ownerId: gym.id, name: 'Uptown' } })
    for (const role of ['manager', 'front_desk', 'coach', 'sales', 'accountant']) who[role] = await staffMember(role)
    who.deskDowntown = await staffMember('front_desk', { locationId: downtown.id })
    who.salesDowntown = await staffMember('sales', { locationId: downtown.id })
    who.accountantDowntown = await staffMember('accountant', { locationId: downtown.id })
    who.managerDowntown = await staffMember('manager', { locationId: downtown.id })
  })

  describe('Twilio webhooks', () => {
    it('rejects anything not signed by Twilio and stores nothing', async () => {
      const m = await person(gym.id)
      const params = { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'Forged' }
      expect((await twilio('/api/webhooks/twilio/inbound', params, null)).status).toBe(403)
      expect((await twilio('/api/webhooks/twilio/inbound', params, 'wrong-token')).status).toBe(403)
      // A real signature for a different address, or for different contents, is no good either.
      expect((await twilio('/api/webhooks/twilio/inbound', params, TOKEN, 'https://attacker.test/api/webhooks/twilio/inbound')).status).toBe(403)
      const signedForOther = await fetch(`${BASE}/api/webhooks/twilio/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(TOKEN, `${BASE}/api/webhooks/twilio/inbound`, { ...params, Body: 'Something else' }) }, body: new URLSearchParams(params) })
      expect(signedForOther.status).toBe(403)
      expect((await twilio('/api/webhooks/twilio/status', { MessageSid: sid(), MessageStatus: 'delivered' }, 'wrong-token')).status).toBe(403)
      expect(await prisma.message.count({ where: { ownerId: gym.id, memberId: m.id } })).toBe(0)
    })

    it('stores a genuine inbound text once, answers with empty TwiML, and applies STOP', async () => {
      const m = await person(gym.id, 'marketing')
      const params = { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'Is the 6am class on tomorrow?', NumMedia: '0' }
      const first = await twilio('/api/webhooks/twilio/inbound', params)
      expect(first.status).toBe(200)
      expect(first.type).toContain('text/xml')
      expect(first.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
      expect((await twilio('/api/webhooks/twilio/inbound', params)).status).toBe(200)
      expect(await prisma.message.count({ where: { ownerId: gym.id, memberId: m.id, direction: 'inbound' } })).toBe(1)
      // The ids and numbers in the body decide nothing beyond routing: a member id in the form is ignored.
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'STOP', memberId: randomUUID(), ownerId: other.id })
      expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ smsStopped: true, smsMarketingOptIn: false })
      expect(await prisma.message.count({ where: { ownerId: other.id, fromAddress: m.phone } })).toBe(0)
    })

    it('applies a genuine delivery report to the message it belongs to', async () => {
      const m = await person(gym.id)
      const reply = await call(who.sales.cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'sms', body: 'On my way' })
      expect(reply.data.status).toBe('sent')
      const row = await prisma.message.findUniqueOrThrow({ where: { id: reply.data.id } })
      expect(row.fromAddress).toBe(gym.number)
      expect((await twilio('/api/webhooks/twilio/status', { MessageSid: row.providerId!, MessageStatus: 'delivered' })).status).toBe(200)
      expect((await prisma.message.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('delivered')
      expect((await twilio('/api/webhooks/twilio/status', { MessageSid: row.providerId!, MessageStatus: 'failed', ErrorCode: '30008' })).status).toBe(200)
      expect((await prisma.message.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('delivered')
    })
  })

  describe('staff inbox', () => {
    it('lets only roles that may message members read or send, and shows the conversation both ways', async () => {
      const m = await person(gym.id)
      for (const role of ['coach', 'accountant']) {
        expect((await call(who[role].cookie, 'GET', '/api/conversations')).status, role).toBe(403)
        expect((await call(who[role].cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'sms', body: 'Hi' })).status, role).toBe(403)
      }
      expect((await call(null, 'GET', '/api/conversations')).status).toBe(401)
      expect(sentTo(m.phone!)).toHaveLength(0)

      const out = await call(who.sales.cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'sms', body: 'Your trial starts Monday' })
      expect(out.data).toMatchObject({ status: 'sent' })
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'Great, thanks!' })

      const unread = await call(who.manager.cookie, 'GET', '/api/conversations?filter=unread')
      const row = unread.data.conversations.find((c: any) => c.id === out.data.conversationId)
      expect(row).toMatchObject({ unreadCount: 1, needsResponse: true, lastDirection: 'inbound', lastPreview: 'Great, thanks!' })
      expect(row.member).toMatchObject({ id: m.id })
      expect(unread.data.configured).toBe(true)

      const thread = await call(who.manager.cookie, 'GET', `/api/conversations/${row.id}?read=1`)
      expect(thread.data.messages.map((x: any) => [x.direction, x.body])).toEqual([['outbound', 'Your trial starts Monday'], ['inbound', 'Great, thanks!']])
      expect(thread.data.messages[0].sender).toBeTruthy()
      expect(thread.data.consent.canReply).toBe(true)
      expect((await prisma.smsConversation.findUniqueOrThrow({ where: { id: row.id } })).unreadCount).toBe(0)

      const reply = await call(who.manager.cookie, 'POST', `/api/conversations/${row.id}`, { action: 'reply', body: 'See you then' })
      expect(reply.data.status).toBe('sent')
      expect(await prisma.smsConversation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ needsResponse: false, lastDirection: 'outbound' })
      expect((await call(who.manager.cookie, 'GET', '/api/conversations?filter=needs_response')).data.conversations.map((c: any) => c.id)).not.toContain(row.id)
      expect((await call(who.manager.cookie, 'GET', `/api/conversations?search=${encodeURIComponent(m.name)}`)).data.conversations.map((c: any) => c.id)).toContain(row.id)
      // The message shows on the member's own timeline too.
      const profile = await call(who.manager.cookie, 'GET', `/api/members/${m.id}/messages`)
      expect(profile.status).toBe(200)
      expect(JSON.stringify(profile.data)).toContain('See you then')
    })

    it('sends a double-clicked reply once', async () => {
      const m = await person(gym.id)
      const clientKey = randomUUID()
      const results = await Promise.all(Array.from({ length: 4 }, () => call(who.sales.cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'sms', body: 'One text only', clientKey })))
      expect(results.every((r) => r.status === 200)).toBe(true)
      expect(new Set(results.map((r) => r.data.id)).size).toBe(1)
      expect(await prisma.message.count({ where: { ownerId: gym.id, memberId: m.id, direction: 'outbound' } })).toBe(1)
      // The same key used by another gym is a different message, not a way to read this one.
      const theirs = await person(other.id)
      const cross = await call(foreignOwner, 'POST', `/api/members/${theirs.id}/messages`, { channel: 'sms', body: 'Different gym', clientKey })
      expect(cross.data.id).not.toBe(results[0].data.id)
    })

    it('refuses to text someone who has opted out, and says why', async () => {
      const m = await person(gym.id, 'marketing')
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'stop' })
      const tried = await call(who.manager.cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'sms', body: 'Please come back' })
      expect(tried.data.status).toBe('skipped')
      expect(tried.data.error).toContain('STOP')
      const thread = await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: gym.id, phone: m.phone! } } })
      const view = await call(who.manager.cookie, 'GET', `/api/conversations/${thread.id}`)
      expect(view.data.consent).toMatchObject({ stopped: true, canReply: false })
      expect((await call(who.manager.cookie, 'POST', `/api/conversations/${thread.id}`, { action: 'reply', body: 'Hello?' })).data.status).toBe('skipped')
      expect(await prisma.message.count({ where: { ownerId: gym.id, memberId: m.id, direction: 'outbound', status: { in: ['sent', 'delivered', 'queued'] } } })).toBe(0)
    })

    it('never shows, answers or changes another gym\'s conversations', async () => {
      const theirs = await person(other.id)
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: theirs.phone!, To: other.number, Body: 'Private to the other gym' })
      const thread = await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: other.id, phone: theirs.phone! } } })
      for (const cookie of [owner, who.manager.cookie, who.sales.cookie]) {
        expect((await call(cookie, 'GET', '/api/conversations')).text).not.toContain('Private to the other gym')
        expect((await call(cookie, 'GET', `/api/conversations?search=${encodeURIComponent(theirs.phone!)}`)).data.conversations).toHaveLength(0)
        expect((await call(cookie, 'GET', `/api/conversations/${thread.id}`)).status).toBe(404)
        for (const body of [{ action: 'reply', body: 'Hi' }, { action: 'read' }, { action: 'resolve', needsResponse: false }, { action: 'assign', staffId: null }]) {
          expect((await call(cookie, 'POST', `/api/conversations/${thread.id}`, body)).status).toBe(404)
        }
        expect((await call(cookie, 'POST', `/api/members/${theirs.id}/messages`, { channel: 'sms', body: 'Hi' })).status).toBe(404)
        expect((await call(cookie, 'GET', `/api/sms/consent?memberId=${theirs.id}`)).status).toBe(404)
        expect((await call(cookie, 'POST', '/api/sms/consent', { memberId: theirs.id, scope: 'marketing', optedIn: true, method: 'x' })).status).toBe(404)
      }
      expect(await prisma.smsConversation.findUniqueOrThrow({ where: { id: thread.id } })).toMatchObject({ unreadCount: 1, needsResponse: true })
      expect(await prisma.message.count({ where: { ownerId: other.id, memberId: theirs.id, direction: 'outbound' } })).toBe(0)
      expect((await call(foreignOwner, 'GET', `/api/conversations/${thread.id}`)).status).toBe(200)
      // Staff from one gym cannot be assigned a thread in another.
      const mine = await person(gym.id)
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: mine.phone!, To: gym.number, Body: 'Hi' })
      const own = await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: gym.id, phone: mine.phone! } } })
      const outsider = await staffMember('manager', {}, other.id)
      expect((await call(owner, 'POST', `/api/conversations/${own.id}`, { action: 'assign', staffId: outsider.id })).status).toBe(404)
      expect((await call(owner, 'POST', `/api/conversations/${own.id}`, { action: 'assign', staffId: who.sales.id })).status).toBe(200)
    })

    it('attaches an unknown number only to a member whose number it really is', async () => {
      const shared = phone()
      const [a] = await Promise.all([person(gym.id, 'operational', { phone: shared }), person(gym.id, 'operational', { phone: shared })])
      const stranger = await person(gym.id)
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: shared, To: gym.number, Body: 'Which of us is this?' })
      const thread = await prisma.smsConversation.findUniqueOrThrow({ where: { ownerId_phone: { ownerId: gym.id, phone: shared } } })
      expect(thread.memberId).toBeNull()
      expect((await call(owner, 'POST', `/api/conversations/${thread.id}`, { action: 'link', memberId: stranger.id })).json.code).toBe('phone_mismatch')
      expect((await call(owner, 'POST', `/api/conversations/${thread.id}`, { action: 'link', memberId: a.id })).status).toBe(200)
      expect((await prisma.smsConversation.findUniqueOrThrow({ where: { id: thread.id } })).memberId).toBe(a.id)
      expect(await prisma.message.count({ where: { conversationId: thread.id, memberId: a.id } })).toBe(1)
    })
  })

  describe('consent over HTTP', () => {
    it('lets roles that manage members record consent, with how it was given, and nobody else', async () => {
      const m = await person(gym.id, 'none')
      for (const role of ['coach', 'accountant']) expect((await call(who[role].cookie, 'POST', '/api/sms/consent', { memberId: m.id, scope: 'marketing', optedIn: true, method: 'They said yes' })).status, role).toBe(403)
      expect((await call(who.coach.cookie, 'PATCH', `/api/members/${m.id}`, { smsOptIn: true })).status).toBe(403)
      expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ smsOptIn: false, smsMarketingOptIn: false })

      // Opting someone in needs a note of how they agreed.
      expect((await call(who.front_desk.cookie, 'POST', '/api/sms/consent', { memberId: m.id, scope: 'operational', optedIn: true })).status).toBe(400)
      expect((await call(who.front_desk.cookie, 'POST', '/api/sms/consent', { memberId: m.id, scope: 'operational', optedIn: true, method: 'Signed the form at the desk' })).data.changed).toBeTruthy()
      expect((await call(who.manager.cookie, 'POST', '/api/sms/consent', { memberId: m.id, scope: 'marketing', optedIn: true, method: 'Asked by phone' })).status).toBe(200)
      const view = await call(who.front_desk.cookie, 'GET', `/api/sms/consent?memberId=${m.id}`)
      expect(view.data).toMatchObject({ operational: true, marketing: true, stopped: false, validPhone: true })
      expect(view.data.history.map((h: any) => [h.scope, h.status, h.method])).toEqual([['marketing', 'opted_in', 'Asked by phone'], ['operational', 'opted_in', 'Signed the form at the desk']])
      expect(view.data.history.every((h: any) => h.actorName)).toBe(true)
    })

    it('refuses every staff route to opting someone back in after STOP', async () => {
      const m = await person(gym.id, 'marketing')
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'STOP' })
      for (const cookie of [owner, who.manager.cookie, who.front_desk.cookie]) {
        for (const scope of ['operational', 'marketing']) {
          const tried = await call(cookie, 'POST', '/api/sms/consent', { memberId: m.id, scope, optedIn: true, method: 'They changed their mind' })
          expect(tried.status).toBe(409)
          expect(tried.json.code).toBe('sms_stopped')
        }
        expect((await call(cookie, 'PATCH', `/api/members/${m.id}`, { smsOptIn: true })).status).toBe(409)
      }
      expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ smsStopped: true, smsOptIn: false, smsMarketingOptIn: false })
    })

    it('lets a member set their own preferences in the app, recorded as theirs', async () => {
      const m = await person(gym.id, 'none')
      const { token } = await createInvite(gym.id, m.id)
      await setPasswordWithToken(token, 'a-long-test-password-1')
      const bearer = await memberBearer(m.id)
      expect((await call(bearer, 'PATCH', '/api/portal/me', { smsOptIn: true, smsMarketingOptIn: true })).status).toBe(200)
      expect((await call(bearer, 'GET', '/api/portal/me')).data.member).toMatchObject({ smsOptIn: true, smsMarketingOptIn: true, smsStopped: false })
      expect(await prisma.smsConsentEvent.count({ where: { memberId: m.id, source: 'member_portal', status: 'opted_in' } })).toBe(2)
      expect((await call(bearer, 'PATCH', '/api/portal/me', { smsMarketingOptIn: false })).status).toBe(200)
      expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ smsOptIn: true, smsMarketingOptIn: false })
      // After STOP, even the member cannot switch it back on from the app: they text START.
      await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'STOP' })
      expect((await call(bearer, 'PATCH', '/api/portal/me', { smsOptIn: true })).status).toBe(409)
    })
  })

  describe('settings and scheduling', () => {
    it('reports whether texting is set up without ever revealing a credential', async () => {
      const status = await call(owner, 'GET', '/api/sms')
      expect(status.data).toMatchObject({ configured: true, canSend: true, number: gym.number, ownNumber: gym.number, credentials: { authToken: true } })
      expect(status.data.webhooks.inbound).toBe(`${BASE}/api/webhooks/twilio/inbound`)
      expect(status.text).not.toContain(TOKEN)
      for (const path of ['/api/conversations', '/api/me', '/api/settings']) expect((await call(owner, 'GET', path)).text, path).not.toContain(TOKEN)
      expect((await call(who.coach.cookie, 'GET', '/api/sms')).status).toBe(403)
    })

    it('lets only people who manage settings change the sending number, and never onto another gym\'s', async () => {
      for (const role of ['manager', 'sales', 'front_desk']) expect((await call(who[role].cookie, 'POST', '/api/sms', { action: 'number', number: phone() })).status, role).toBe(403)
      expect((await call(who.front_desk.cookie, 'GET', '/api/sms')).status).toBe(200)
      expect((await call(owner, 'POST', '/api/sms', { action: 'number', number: other.number })).json.code).toBe('number_taken')
      expect((await call(owner, 'POST', '/api/sms', { action: 'number', number: '12345' })).json.code).toBe('invalid_phone')
      expect((await prisma.smsNumber.findUniqueOrThrow({ where: { ownerId: gym.id } })).number).toBe(gym.number)
      expect((await call(who.manager.cookie, 'POST', '/api/sms', { action: 'test', to: phone() })).status).toBe(403)
      expect((await call(owner, 'POST', '/api/sms', { action: 'test', to: phone() })).data.sent).toBe(true)
    })

    it('runs the message heartbeat only for a caller with the secret', async () => {
      expect((await fetch(`${BASE}/api/cron/messages`)).status).toBe(401)
      expect((await fetch(`${BASE}/api/cron/messages`, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401)
      const ok = await fetch(`${BASE}/api/cron/messages`, { headers: { Authorization: `Bearer ${process.env.TEST_CRON_SECRET || 'local-cron-secret'}` } })
      expect(ok.status).toBe(200)
    })

    it('previews, schedules and cancels a text campaign, inside the gym and with the right role', async () => {
      const a = await person(gym.id, 'marketing')
      const b = await person(gym.id, 'operational')
      const audience = { type: 'members', ids: [a.id, b.id] }
      const reach = await call(who.sales.cookie, 'GET', `/api/campaigns?channel=sms&count=${encodeURIComponent(JSON.stringify(audience))}`)
      expect(reach.data).toMatchObject({ count: 2, eligible: 1, blocked: [{ reason: 'No consent to marketing texts', count: 1 }] })
      expect((await call(who.front_desk.cookie, 'POST', '/api/campaigns', { name: 'x', channel: 'sms', body: 'x', audience })).status).toBe(403)

      const scheduledAt = new Date(Date.now() + 2 * HOUR).toISOString()
      const made = await call(who.sales.cookie, 'POST', '/api/campaigns', { name: 'Later', channel: 'sms', body: 'Open day Saturday', audience, scheduledAt })
      expect(made.data).toMatchObject({ status: 'scheduled' })
      expect(await prisma.message.count({ where: { campaignId: made.data.id } })).toBe(0)
      expect((await call(foreignOwner, 'POST', `/api/campaigns/${made.data.id}`, { action: 'cancel' })).status).toBe(400)
      expect((await call(foreignOwner, 'POST', `/api/campaigns/${made.data.id}`, { action: 'send' })).status).toBe(404)
      expect((await call(who.sales.cookie, 'POST', `/api/campaigns/${made.data.id}`, { action: 'cancel' })).data.status).toBe('draft')

      const now = await call(who.sales.cookie, 'POST', `/api/campaigns/${made.data.id}`, { action: 'send' })
      expect(now.data).toMatchObject({ recipients: 2, sent: 1, skipped: 1, remaining: 0 })
      // A campaign aimed at another gym's members by id reaches nobody.
      const theirs = await person(other.id, 'marketing')
      const cross = await call(who.sales.cookie, 'POST', '/api/campaigns', { name: 'Cross', channel: 'sms', body: 'Hello', audience: { type: 'members', ids: [theirs.id] }, send: true })
      expect(cross.data.recipients).toBe(0)
      expect(await prisma.message.count({ where: { memberId: theirs.id } })).toBe(0)
    })
  })

  describe('location locking on the older pages', () => {
    let home: Record<'down' | 'up' | 'none', Awaited<ReturnType<typeof createMember>>>
    const ids = (r: any) => (Array.isArray(r.data) ? r.data : r.data?.items || r.data?.rows || []).map((x: any) => x.member?.id || x.id)

    beforeAll(async () => {
      home = {
        down: await createMember(gym.id, { name: 'Dana Downtown', homeLocationId: downtown.id }),
        up: await createMember(gym.id, { name: 'Una Uptown', homeLocationId: uptown.id }),
        none: await createMember(gym.id, { name: 'Nico Nowhere' }),
      }
      let n = 0
      for (const [key, locationId] of [['down', downtown.id], ['up', uptown.id]] as const) {
        const invoice = await prisma.invoice.create({ data: { ownerId: gym.id, memberId: home[key].id, number: `LOC-${randomUUID().slice(0, 8)}`, status: 'open', totalCents: 5000 + n, subtotalCents: 5000 + n } })
        await prisma.transaction.create({ data: { ownerId: gym.id, memberId: home[key].id, invoiceId: invoice.id, locationId, amountCents: 5000 + n++, method: 'cash' } })
        await prisma.checkin.create({ data: { ownerId: gym.id, memberId: home[key].id, locationId } as any })
      }
    })

    it('limits staff tied to a location to it on members, billing and check-ins, whatever location they ask for', async () => {
      for (const query of ['', `locationId=${uptown.id}`, `locationId=${downtown.id}`]) {
        const members = await call(who.deskDowntown.cookie, 'GET', `/api/members?pageSize=100&${query}`)
        expect(members.status).toBe(200)
        const names = JSON.stringify(members.data)
        expect(names, query).toContain('Dana Downtown')
        expect(names, query).toContain('Nico Nowhere')
        expect(names, query).not.toContain('Una Uptown')

        const transactions = await call(who.deskDowntown.cookie, 'GET', `/api/billing/transactions?pageSize=100&${query}`)
        expect(transactions.text, query).toContain('Dana Downtown')
        expect(transactions.text, query).not.toContain('Una Uptown')
        const invoices = await call(who.deskDowntown.cookie, 'GET', `/api/billing/invoices?pageSize=100&${query}`)
        expect(invoices.text, query).toContain('Dana Downtown')
        expect(invoices.text, query).not.toContain('Una Uptown')
        const log = await call(who.deskDowntown.cookie, 'GET', `/api/checkin?range=today&${query}`)
        expect(log.text, query).toContain('Dana Downtown')
        expect(log.text, query).not.toContain('Una Uptown')
      }
      // The directory totals are theirs too, not the whole gym's.
      const locked = await call(who.deskDowntown.cookie, 'GET', '/api/members?pageSize=1')
      const everyone = await call(owner, 'GET', '/api/members?pageSize=1')
      expect(locked.json.meta.counts.all).toBeLessThan(everyone.json.meta.counts.all)
      // A search for the other location's member in the directory finds nothing, including by CSV export.
      expect((await call(who.deskDowntown.cookie, 'GET', '/api/members?search=Una')).text).not.toContain('Una Uptown')
      expect((await call(who.accountantDowntown.cookie, 'GET', `/api/billing/transactions?format=csv&locationId=${uptown.id}`)).text).not.toContain('Una Uptown')
      expect((await call(who.accountantDowntown.cookie, 'GET', `/api/billing/invoices?format=csv&locationId=${uptown.id}`)).text).not.toContain('Una Uptown')
    })

    it('gives the same figures on reports and the dashboard whichever location locked staff ask for', async () => {
      const asked = async (cookie: string, path: string) => Promise.all(['', `&locationId=${uptown.id}`, `&locationId=${downtown.id}`].map(async (q) => (await call(cookie, 'GET', `${path}?range=30d${q}`)).text.replace(/"generatedAt":"[^"]+"/g, '')))
      for (const path of ['/api/reports/members', '/api/reports/attendance', '/api/reports/sales']) {
        const [all, up2, down] = await asked(who.salesDowntown.cookie, path)
        expect(all, path).toBe(down)
        expect(up2, path).toBe(down)
      }
      const [all, up2, down] = await asked(who.accountantDowntown.cookie, '/api/reports/financial')
      expect(all).toBe(down)
      expect(up2).toBe(down)
      const [d1, d2] = await asked(who.salesDowntown.cookie, '/api/dashboard')
      expect(d1).toBe(d2)
      // Their revenue is Downtown's alone.
      const mine = await call(who.accountantDowntown.cookie, 'GET', '/api/reports/financial?range=30d')
      const downtownOnly = await call(owner, 'GET', `/api/reports/financial?range=30d&locationId=${downtown.id}`)
      const whole = await call(owner, 'GET', '/api/reports/financial?range=30d')
      expect(JSON.stringify(mine.data.summary ?? mine.data)).toBe(JSON.stringify(downtownOnly.data.summary ?? downtownOnly.data))
      expect(JSON.stringify(whole.data)).not.toBe(JSON.stringify(downtownOnly.data))
    })

    it('leaves owners and managers free to look at any location or all of them', async () => {
      for (const cookie of [owner, who.manager.cookie, who.managerDowntown.cookie]) {
        const all = await call(cookie, 'GET', '/api/members?pageSize=100')
        expect(all.text).toContain('Dana Downtown')
        expect(all.text).toContain('Una Uptown')
        const up2 = await call(cookie, 'GET', `/api/members?pageSize=100&locationId=${uptown.id}`)
        expect(up2.text).toContain('Una Uptown')
        expect(up2.text).not.toContain('Dana Downtown')
        expect(up2.text).not.toContain('Nico Nowhere')
        const tx2 = await call(cookie, 'GET', `/api/billing/transactions?pageSize=100&locationId=${uptown.id}`)
        expect(tx2.text).toContain('Una Uptown')
        expect(tx2.text).not.toContain('Dana Downtown')
        expect((await call(cookie, 'GET', '/api/billing/transactions?pageSize=100')).text).toContain('Dana Downtown')
      }
      // A location belonging to another gym is refused or filters to nothing; it never widens the view.
      const foreign = await prisma.location.create({ data: { ownerId: other.id, name: 'Elsewhere' } })
      const tried = await call(owner, 'GET', `/api/reports/members?range=30d&locationId=${foreign.id}`)
      expect(tried.status).toBe(404)
    })

    it('records what locked staff create at their own location', async () => {
      const lead = await call(who.deskDowntown.cookie, 'POST', '/api/leads', { name: 'Walk In', email: `${randomUUID()}@test.local`, locationId: uptown.id })
      expect(lead.status).toBe(200)
      expect((await prisma.prospect.findUniqueOrThrow({ where: { id: lead.data.id } })).locationId).toBe(downtown.id)
      const theirs = await call(who.manager.cookie, 'POST', '/api/leads', { name: 'Uptown Lead', email: `${randomUUID()}@test.local`, locationId: uptown.id })
      expect((await prisma.prospect.findUniqueOrThrow({ where: { id: theirs.data.id } })).locationId).toBe(uptown.id)
      const list = await call(who.deskDowntown.cookie, 'GET', `/api/leads?locationId=${uptown.id}`)
      expect(list.text).toContain('Walk In')
      expect(list.text).not.toContain('Uptown Lead')
    })
  })

  describe('one coach, one class at a time', () => {
    let coachId: string
    let otherCoachId: string
    let classTypeId: string
    const body = (date: string, startTime: string, extra: Record<string, unknown> = {}) => ({ classTypeId, coachId, date, startTime, durationMin: 60, capacity: 10, ...extra })
    const create = (date: string, startTime: string, extra: Record<string, unknown> = {}) => call(owner, 'POST', '/api/schedule/sessions', body(date, startTime, extra))

    beforeAll(async () => {
      coachId = (await staffMember('coach')).id
      otherCoachId = (await staffMember('coach')).id
      classTypeId = (await prisma.classType.create({ data: { ownerId: gym.id, name: 'Conflict Class' } })).id
    })

    it('refuses an overlapping class for the same coach on create, edit, move, coach change and copy', async () => {
      const first = await create(day(20), '10:00')
      expect(first.status).toBe(200)
      const clash = await create(day(20), '10:30')
      expect(clash.status).toBe(409)
      expect(clash.json.code).toBe('coach_has_class')
      expect(clash.json.error).toContain('already teaching')
      expect((await create(day(20), '09:30')).json.code).toBe('coach_has_class')
      expect((await create(day(20), '10:15', { durationMin: 15 })).json.code).toBe('coach_has_class')

      // Back-to-back either side, another coach, and no coach are all fine.
      const after = await create(day(20), '11:00')
      expect(after.status).toBe(200)
      const before = await create(day(20), '09:00')
      expect(before.status).toBe(200)
      const theirs = await create(day(20), '10:30', { coachId: otherCoachId })
      expect(theirs.status).toBe(200)
      expect((await create(day(20), '10:30', { coachId: null })).status).toBe(200)

      // Editing a class without moving it is not a clash with itself.
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${first.data.id}`, { capacity: 12, room: 'Studio 2' })).status).toBe(200)
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${first.data.id}`, { startTime: '10:00', durationMin: 60 })).status).toBe(200)
      // Moving, lengthening or re-assigning onto another of the coach's classes is.
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${after.data.id}`, { startTime: '10:30' })).json.code).toBe('coach_has_class')
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${before.data.id}`, { durationMin: 90 })).json.code).toBe('coach_has_class')
      expect((await call(owner, 'PATCH', `/api/schedule/sessions/${theirs.data.id}`, { coachId })).json.code).toBe('coach_has_class')
      expect((await call(owner, 'POST', `/api/schedule/sessions/${first.data.id}`, { action: 'duplicate', date: day(20), startTime: '10:45' })).json.code).toBe('coach_has_class')
      // Nothing moved.
      const rows = await prisma.classSession.findMany({ where: { id: { in: [after.data.id, before.data.id, theirs.data.id] } } })
      expect(rows.find((r) => r.id === after.data.id)!.startsAt.toISOString()).toBe(at(day(20), '11:00').toISOString())
      expect(rows.find((r) => r.id === before.data.id)!.endsAt.toISOString()).toBe(at(day(20), '10:00').toISOString())
      expect(rows.find((r) => r.id === theirs.data.id)!.coachId).toBe(otherCoachId)
      // A copy to a free day works, and a cancelled class no longer blocks its time.
      expect((await call(owner, 'POST', `/api/schedule/sessions/${first.data.id}`, { action: 'duplicate', date: day(21) })).status).toBe(200)
      expect((await call(owner, 'POST', `/api/schedule/sessions/${first.data.id}`, { action: 'cancel' })).status).toBe(200)
      expect((await create(day(20), '10:15', { durationMin: 30 })).status).toBe(200)
    })

    it('refuses a weekly class that would overlap one the coach already teaches', async () => {
      const weekly = (startTime: string, extra: Record<string, unknown> = {}) => call(owner, 'POST', '/api/schedule/schedules', { classTypeId, coachId, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime, durationMin: 60, capacity: 10, startDate: today, ...extra })
      // Onto a one-off class.
      expect((await create(day(25), '15:00')).status).toBe(200)
      const overOneOff = await weekly('15:30')
      expect(overOneOff.status).toBe(409)
      expect(overOneOff.json.code).toBe('coach_has_class')
      expect(await prisma.classSchedule.count({ where: { ownerId: gym.id, classTypeId, startTime: '15:30' } })).toBe(0)

      // Onto another weekly class, including one that only starts months from now.
      const morning = await weekly('06:00')
      expect(morning.status).toBe(200)
      expect((await weekly('06:30')).json.code).toBe('coach_has_class')
      expect((await weekly('06:30', { startDate: day(200) })).json.code).toBe('coach_has_class')
      expect((await weekly('06:30', { coachId: otherCoachId })).status).toBe(200)
      const backToBack = await weekly('07:00')
      expect(backToBack.status).toBe(200)

      // Editing a weekly class into another, by time or by coach.
      expect((await call(owner, 'PATCH', `/api/schedule/schedules/${backToBack.data.id}`, { startTime: '06:30' })).json.code).toBe('coach_has_class')
      const others = await prisma.classSchedule.findFirstOrThrow({ where: { ownerId: gym.id, coachId: otherCoachId, startTime: '06:30' } })
      expect((await call(owner, 'PATCH', `/api/schedule/schedules/${others.id}`, { coachId })).json.code).toBe('coach_has_class')
      expect((await prisma.classSchedule.findUniqueOrThrow({ where: { id: backToBack.data.id } })).startTime).toBe('07:00')
      expect((await prisma.classSchedule.findUniqueOrThrow({ where: { id: others.id } })).coachId).toBe(otherCoachId)
      // A one-off class on top of a generated weekly class is refused as well.
      expect((await create(day(3), '06:30')).json.code).toBe('coach_has_class')
      // No two scheduled classes of this coach overlap anywhere.
      const all = await prisma.classSession.findMany({ where: { ownerId: gym.id, coachId, status: 'scheduled' }, orderBy: { startsAt: 'asc' }, select: { startsAt: true, endsAt: true } })
      expect(all.length).toBeGreaterThan(50)
      for (let i = 1; i < all.length; i++) expect(all[i].startsAt.getTime(), `class ${i}`).toBeGreaterThanOrEqual(all[i - 1].endsAt.getTime())
    })

    it('lets exactly one of two overlapping classes created at the same moment through', async () => {
      const racer = (await staffMember('coach')).id
      for (let round = 0; round < 4; round++) {
        const date = day(30 + round)
        const results = await Promise.all([
          create(date, '12:00', { coachId: racer }),
          create(date, '12:30', { coachId: racer }),
          call(owner, 'POST', '/api/schedule/schedules', { classTypeId, coachId: racer, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '12:15', durationMin: 60, capacity: 10, startDate: date, endDate: date }),
        ])
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([200, 409, 409])
        expect(await prisma.classSession.count({ where: { ownerId: gym.id, coachId: racer, status: 'scheduled', startsAt: { gte: at(date, '00:00'), lt: at(date, '23:59') } } })).toBe(1)
      }
      // Two edits racing onto the same slot: one lands.
      const date = day(40)
      const [a, b] = [await create(date, '08:00', { coachId: racer }), await create(date, '14:00', { coachId: racer })]
      const moves = await Promise.all([
        call(owner, 'PATCH', `/api/schedule/sessions/${a.data.id}`, { startTime: '10:00' }),
        call(owner, 'PATCH', `/api/schedule/sessions/${b.data.id}`, { startTime: '10:30' }),
      ])
      expect(moves.map((r) => r.status).sort()).toEqual([200, 409])
    })
  })
})

describe('conversations only exist for real exchanges', () => {
  it('does not open a thread for a text that was never allowed out', async () => {
    const g = await gymWithNumber()
    try {
      const [blocked, allowed] = [await person(g.id, 'none'), await person(g.id, 'marketing')]
      for (const m of [blocked, allowed]) await sendMessage({ ownerId: g.id, channel: 'sms', memberId: m.id, body: 'Offer', kind: 'marketing' })
      const threads = await prisma.smsConversation.findMany({ where: { ownerId: g.id } })
      expect(threads.map((t) => t.memberId)).toEqual([allowed.id])
      // The refusal is still on record against the member, with its reason.
      expect(await prisma.message.findFirstOrThrow({ where: { ownerId: g.id, memberId: blocked.id } })).toMatchObject({ status: 'skipped', conversationId: null, error: 'No consent to marketing texts' })
      const { getPersonThread } = await import('@/lib/services/sms')
      const view = await getPersonThread(g.id, { memberId: blocked.id })
      expect(view).toMatchObject({ id: null, consent: { canReply: false } })
      expect(view.messages).toHaveLength(1)
    } finally { await destroyGym(g.id) }
  })
})

describe('an interrupted send', () => {
  it('is closed as failed, never sent a second time', async () => {
    const g = await gymWithNumber()
    try {
      const m = await person(g.id)
      const queued = await queueMessage(prisma, { ownerId: g.id, channel: 'sms', memberId: m.id, body: 'Cut off', kind: 'operational' })
      // The server stopped after claiming the message and before recording the outcome.
      await prisma.message.update({ where: { id: queued.id }, data: { status: 'sending', nextAttemptAt: new Date(Date.now() - 20 * 60_000) } })
      await deliverQueued(g.id)
      await deliverQueued(g.id, 50, new Date(Date.now() + DAY))
      expect(await prisma.message.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'failed', nextAttemptAt: null })
      expect(sentTo(m.phone!)).toHaveLength(0)
      // One still within its window is left alone.
      const live = await queueMessage(prisma, { ownerId: g.id, channel: 'sms', memberId: m.id, body: 'In flight', kind: 'operational' })
      await prisma.message.update({ where: { id: live.id }, data: { status: 'sending', nextAttemptAt: new Date() } })
      await deliverQueued(g.id)
      expect((await prisma.message.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('sending')
    } finally { await destroyGym(g.id) }
  })
})

describe.skipIf(!simulated)('front desk texting', () => {
  it('can use the inbox and text one member at a time, and nothing to do with campaigns, automations or email', async () => {
    const desk = await prisma.staff.create({ data: { ownerId: gym.id, name: 'Desk Dana', email: `${randomUUID()}@test.local`, password: 'x', role: 'front_desk' } })
    const cookie = `auth-token=${await createToken({ ownerId: gym.id, staffId: desk.id, role: 'front_desk' as any })}`
    const m = await person(gym.id, 'operational')
    const lead = await prisma.prospect.create({ data: { ownerId: gym.id, name: 'Lia Lead', email: `${randomUUID()}@test.local`, phone: phone(), smsOptIn: true } })

    // One-to-one texts, the inbox, a member's thread and consent state.
    const sentText = await call(cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'sms', body: 'Your locker key is at the desk' })
    expect(sentText.data).toMatchObject({ status: 'sent' })
    expect((await prisma.message.findUniqueOrThrow({ where: { id: sentText.data.id } })).staffName).toBe('Desk Dana')
    await twilio('/api/webhooks/twilio/inbound', { MessageSid: sid(), From: m.phone!, To: gym.number, Body: 'On my way' })
    const inbox = await call(cookie, 'GET', '/api/conversations?filter=needs_response')
    expect(inbox.status).toBe(200)
    const row = inbox.data.conversations.find((c: any) => c.member?.id === m.id)
    expect(row).toMatchObject({ unreadCount: 1 })
    expect((await call(cookie, 'GET', `/api/conversations/${row.id}?read=1`)).data.messages).toHaveLength(2)
    expect((await call(cookie, 'POST', `/api/conversations/${row.id}`, { action: 'reply', body: 'See you soon' })).data.status).toBe('sent')
    const thread = await call(cookie, 'GET', `/api/members/${m.id}/sms`)
    expect(thread.data.consent).toMatchObject({ operational: true, marketing: false, stopped: false, canReply: true })
    expect((await call(cookie, 'GET', `/api/sms/consent?memberId=${m.id}`)).data).toMatchObject({ operational: true, marketing: false })
    expect((await call(cookie, 'POST', `/api/leads/${lead.id}/messages`, { channel: 'sms', body: 'Still interested?' })).data.status).toBe('sent')
    expect((await call(cookie, 'GET', '/api/templates')).status).toBe(200)

    // The same consent rules as everyone else.
    const noConsent = await person(gym.id, 'none')
    expect((await call(cookie, 'POST', `/api/members/${noConsent.id}/messages`, { channel: 'sms', body: 'Hi' })).data.status).toBe('skipped')

    // Not email, not campaigns, not automations, not settings, and not another gym.
    expect((await call(cookie, 'POST', `/api/members/${m.id}/messages`, { channel: 'email', subject: 'Hi', body: 'Hello' })).status).toBe(403)
    expect((await call(cookie, 'POST', `/api/leads/${lead.id}/messages`, { channel: 'email', subject: 'Hi', body: 'Hello' })).status).toBe(403)
    for (const [method, path, body] of [
      ['GET', '/api/campaigns', undefined],
      ['POST', '/api/campaigns', { name: 'x', channel: 'sms', body: 'Offer', audience: { type: 'all_members' }, send: true }],
      ['GET', '/api/messages', undefined],
      ['POST', '/api/messages/drain', {}],
      ['GET', '/api/automations', undefined],
      ['POST', '/api/templates', { name: 'x', channel: 'sms', body: 'x' }],
      ['POST', '/api/sms', { action: 'test', to: phone() }],
    ] as const) expect((await call(cookie, method, path, body)).status, `${method} ${path}`).toBe(403)
    expect(await prisma.campaign.count({ where: { ownerId: gym.id, name: 'x' } })).toBe(0)
    const theirs = await person(other.id)
    expect((await call(cookie, 'POST', `/api/members/${theirs.id}/messages`, { channel: 'sms', body: 'Hi' })).status).toBe(404)
  })
})

describe('a conversation outlives the record it was attached to', () => {
  it('moves to the new member when the old one was deleted and the number is reused', async () => {
    const g = await gymWithNumber()
    try {
      const number = phone()
      const old = await person(g.id, 'operational', { phone: number, name: 'Old Record' })
      const first = await sendMessage({ ownerId: g.id, channel: 'sms', memberId: old.id, body: 'Hello', kind: 'operational' })
      await prisma.member.delete({ where: { id: old.id } })
      // A text from that number while nobody has it belongs to nobody.
      expect(await inbound(g, number, 'Still me')).toMatchObject({ status: 'received', memberId: null })
      const fresh = await person(g.id, 'operational', { phone: number, name: 'New Record' })
      const second = await sendMessage({ ownerId: g.id, channel: 'sms', memberId: fresh.id, body: 'Welcome back', kind: 'operational' })
      expect(second.conversationId).toBe(first.conversationId)
      expect(await prisma.smsConversation.findUniqueOrThrow({ where: { id: first.conversationId! } })).toMatchObject({ memberId: fresh.id })
      const { listConversations } = await import('@/lib/services/sms')
      expect((await listConversations(g.id, {})).conversations[0].member).toMatchObject({ id: fresh.id, name: 'New Record' })
    } finally { await destroyGym(g.id) }
  })
})
