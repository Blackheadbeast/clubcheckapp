import { prisma } from '@/lib/prisma'
import { assertOwned, handler, notFound } from '@/lib/api'
import { accountStatus, createInvite, createReset } from '@/lib/member-auth'
import { appOrigin, sendAccountEmail } from '@/lib/member-auth-http'
import { logActivity } from '@/lib/services/core'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/invite - does this member have a sign-in account yet?
export const GET = handler({ permission: 'members.view' }, async ({ ownerId, params }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  return accountStatus(ownerId, params.id)
})

// POST /api/members/:id/invite - email an invitation, or a password reset if they already have an account
export const POST = handler({ permission: 'members.manage', write: true, rateLimit: { key: 'member-invite', windowMs: 60_000, maxRequests: 30 } }, async ({ ownerId, params, req, actor, audit }) => {
  const member = await prisma.member.findFirst({ where: { id: params.id, ownerId, archivedAt: null } })
  if (!member) throw notFound('Member')
  const status = await accountStatus(ownerId, member.id)
  const origin = appOrigin(req)
  let kind: 'invite' | 'reset'
  let token: string
  if (status.status === 'active') {
    // Staff never see or set a member's password; they can only send the member a reset link.
    kind = 'reset'
    token = (await createReset(ownerId, member.id)).token
  } else {
    kind = 'invite'
    token = (await createInvite(ownerId, member.id)).token
  }
  const sent = await sendAccountEmail(member, member.email, kind, token, origin)
  await logActivity(prisma, { ownerId, memberId: member.id, type: kind === 'invite' ? 'account_invited' : 'password_reset_sent', title: kind === 'invite' ? 'Invited to set up their member account' : 'Sent a password reset link', actor })
  await audit(kind === 'invite' ? 'member.invite' : 'member.password_reset', kind === 'invite' ? `Invited ${member.name} to set up their account` : `Sent ${member.name} a password reset link`, { entityType: 'member', entityId: member.id })
  return { kind, delivered: sent.delivered, email: member.email, account: await accountStatus(ownerId, member.id) }
})
