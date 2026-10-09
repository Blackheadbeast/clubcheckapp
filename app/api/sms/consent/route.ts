import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertOwned, badRequest, handler, notFound } from '@/lib/api'
import { toE164 } from '@/lib/messaging/sms'
import { consentHistory, setSmsConsent } from '@/lib/services/sms'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/sms/consent?memberId= - where a member stands on texts, and how they got there
export const GET = handler({ permission: 'members.view' }, async ({ ownerId, query }) => {
  const memberId = query.get('memberId')
  if (!memberId) throw badRequest('memberId is required.')
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId }, select: { phone: true, smsOptIn: true, smsMarketingOptIn: true, smsStopped: true, smsConsentAt: true, smsStoppedAt: true, emailOptIn: true } })
  if (!member) throw notFound('Member')
  return {
    phone: member.phone, validPhone: !!toE164(member.phone), operational: member.smsOptIn, marketing: member.smsMarketingOptIn, stopped: member.smsStopped,
    consentAt: member.smsConsentAt, stoppedAt: member.smsStoppedAt, emailMarketing: member.emailOptIn, history: await consentHistory(ownerId, memberId),
  }
})

const schema = z.object({
  memberId: z.string().uuid().optional(),
  prospectId: z.string().uuid().optional(),
  scope: z.enum(['operational', 'marketing']),
  optedIn: z.boolean(),
  /** How the person gave (or withdrew) consent, in the staff member's words. Required when opting someone in. */
  method: z.string().trim().max(200).optional(),
}).refine((v) => !!v.memberId !== !!v.prospectId, 'Choose a member or a lead').refine((v) => !v.optedIn || !!v.method, 'Say how they agreed, for example "Asked at the front desk"')

// POST - staff record a change of consent on someone's behalf. Only roles that manage members may,
// every change is kept with who made it, and a STOP cannot be reversed here.
export const POST = handler({ permission: 'members.manage', write: true, body: schema }, async ({ ownerId, body, actor, audit }) => {
  await assertOwned(ownerId, 'member', body.memberId, 'Member')
  await assertOwned(ownerId, 'prospect', body.prospectId, 'Lead')
  const changed = await prisma.$transaction(async (db) => {
    const did = await setSmsConsent(db, { ownerId, memberId: body.memberId, prospectId: body.prospectId, scope: body.scope, optedIn: body.optedIn, source: 'staff', method: body.method || 'Changed by staff', actorName: actor.name })
    if (did && body.memberId) await logActivity(db, { ownerId, memberId: body.memberId, type: body.optedIn ? 'sms_opt_in' : 'sms_opt_out', title: `${body.optedIn ? 'Opted in to' : 'Opted out of'} ${body.scope === 'marketing' ? 'marketing' : 'reminder'} texts`, detail: body.method, actor })
    return did
  })
  if (changed) await audit(body.optedIn ? 'sms.opt_in' : 'sms.opt_out', `Recorded ${body.scope} text ${body.optedIn ? 'consent' : 'opt-out'}${body.method ? `: ${body.method}` : ''}`, { entityType: body.memberId ? 'member' : 'lead', entityId: body.memberId || body.prospectId })
  return { changed }
})
