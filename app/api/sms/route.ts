import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, handler } from '@/lib/api'
import { defaultSmsNumber, getSmsProvider, toE164, webhookBase } from '@/lib/messaging/sms'
import { gymSmsNumber } from '@/lib/services/sms'
import { getGymSettings } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/sms - is texting set up for this gym? Never returns a credential, only whether one is present.
export const GET = handler({ permission: ['communication.text', 'communication.send', 'settings.manage'] }, async ({ ownerId }) => {
  const [own, number, last30, lastInbound] = await Promise.all([
    prisma.smsNumber.findUnique({ where: { ownerId } }),
    gymSmsNumber(ownerId),
    prisma.message.groupBy({ by: ['status'], where: { ownerId, channel: 'sms', direction: 'outbound', createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: { _all: true } }),
    prisma.message.findFirst({ where: { ownerId, channel: 'sms', direction: 'inbound' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ])
  const base = webhookBase()
  const counts: Record<string, number> = {}
  for (const row of last30) counts[row.status] = row._count._all
  return {
    configured: !!getSmsProvider(),
    credentials: { accountSid: !!process.env.TWILIO_ACCOUNT_SID, authToken: !!process.env.TWILIO_AUTH_TOKEN, messagingService: !!process.env.TWILIO_MESSAGING_SERVICE_SID },
    number, ownNumber: own?.number || null, sharedNumber: defaultSmsNumber(),
    canSend: !!getSmsProvider() && (!!number || !!process.env.TWILIO_MESSAGING_SERVICE_SID),
    webhooks: base ? { inbound: `${base}/api/webhooks/twilio/inbound`, status: `${base}/api/webhooks/twilio/status` } : null,
    last30: counts, lastInboundAt: lastInbound?.createdAt || null,
  }
})

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('number'), number: z.string().trim().max(30).nullable() }),
  z.object({ action: z.literal('test'), to: z.string().trim().min(5).max(30) }),
])

// POST { action: "number" | "test" } - set this gym's own sending number, or send one test text
export const POST = handler({ permission: 'settings.manage', write: true, body: schema, rateLimit: { key: 'sms-settings', windowMs: 60 * 60_000, maxRequests: 20 } }, async ({ ownerId, body, audit }) => {
  if (body.action === 'number') {
    if (!body.number) {
      await prisma.smsNumber.deleteMany({ where: { ownerId } })
      await audit('sms.number', 'Removed the gym\'s own sending number', { entityType: 'settings' })
      return { number: defaultSmsNumber() }
    }
    const number = toE164(body.number)
    if (!number) throw badRequest('Enter the number in full, for example +1 207 555 0142.', 'invalid_phone')
    const taken = await prisma.smsNumber.findUnique({ where: { number } })
    if (taken && taken.ownerId !== ownerId) throw new ApiError(409, 'That number is already in use by another account.', 'number_taken')
    await prisma.$transaction([prisma.smsNumber.deleteMany({ where: { ownerId } }), prisma.smsNumber.create({ data: { ownerId, number } })])
    await audit('sms.number', `Set the sending number to ${number}`, { entityType: 'settings' })
    return { number }
  }
  // A single plain text to a number the person setting this up types in, to prove the connection end to end.
  const provider = getSmsProvider()
  if (!provider) throw new ApiError(409, 'Texting is not connected yet.', 'sms_not_configured')
  const to = toE164(body.to)
  if (!to) throw badRequest('Enter a full mobile number, for example +1 207 555 0142.', 'invalid_phone')
  const settings = await getGymSettings(ownerId)
  const base = webhookBase()
  const result = await provider.send({ to, from: await gymSmsNumber(ownerId), body: `Test message from ${settings.name} via ClubCheck. Reply to check two-way texting.`, statusCallback: base ? `${base}/api/webhooks/twilio/status` : null })
  await audit('sms.test', result.ok ? `Sent a test text to ${to}` : `Test text to ${to} failed: ${result.error}`, { entityType: 'settings' })
  if (!result.ok) throw new ApiError(502, result.error, 'sms_failed', { code: result.code })
  return { sent: true, id: result.id }
})
