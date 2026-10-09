// Member accounts: how a gym member proves who they are.
//
// Staff and members are separate worlds. Staff sessions live in the
// `auth-token` cookie; member sessions live in `member-session` and are signed
// with a key derived from JWT_SECRET, so a member token can never verify as a
// staff token (and the other way round) even if it is pasted into the wrong
// cookie. A member session names one Member row; everything a member may see
// is derived from that row on the server, never from an id in the request.

import { createHash, createHmac, randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest } from '@/lib/api'
import { logActivity } from '@/lib/services/core'

export const MEMBER_COOKIE = 'member-session'
export const SESSION_DAYS = 14
const INVITE_HOURS = 7 * 24
const RESET_HOURS = 2
const VERIFY_HOURS = 48
const MAX_FAILED_LOGINS = 8
const LOCK_MINUTES = 15
// A real hash to compare against when no account matches, so timing does not reveal which emails exist.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8rZ8yQ4H1kq3zQqkWmC0mZ1yQyq0Ty'

export type TokenType = 'invite' | 'reset' | 'verify_email'

function memberSecret() {
  const base = process.env.JWT_SECRET
  if (!base) throw new Error('JWT_SECRET is not set')
  return createHmac('sha256', base).update('clubcheck:member-session:v1').digest()
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function validatePassword(password: string) {
  if (password.length < 10) throw badRequest('Use at least 10 characters for your password.', 'weak_password')
  if (password.length > 200) throw badRequest('That password is too long.', 'weak_password')
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) throw badRequest('Include at least one letter and one number.', 'weak_password')
}

// --- Sessions ----------------------------------------------------------------

export interface MemberSession {
  memberId: string
  ownerId: string
  sessionVersion: number
}

export async function signMemberSession(session: MemberSession, days = SESSION_DAYS) {
  return new SignJWT({ mid: session.memberId, gid: session.ownerId, sv: session.sessionVersion, typ: 'member' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('clubcheck-member')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + Math.round(days * 86_400))
    .sign(memberSecret())
}

export async function readMemberSessionToken(token: string | undefined | null): Promise<MemberSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, memberSecret(), { audience: 'clubcheck-member' })
    if (payload.typ !== 'member' || typeof payload.mid !== 'string' || typeof payload.gid !== 'string' || typeof payload.sv !== 'number') return null
    return { memberId: payload.mid, ownerId: payload.gid, sessionVersion: payload.sv }
  } catch {
    return null
  }
}

export function sessionCookie(token: string, days = SESSION_DAYS) {
  return {
    name: MEMBER_COOKIE, value: token, httpOnly: true, sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production', path: '/', maxAge: Math.round(days * 86_400),
  }
}

export const clearedCookie = () => ({ name: MEMBER_COOKIE, value: '', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })

/**
 * The signed-in member, re-read from the database on every request: an
 * archived member, a deleted account or a changed password ends the session
 * at once instead of when the cookie expires.
 */
export async function resolveMemberSession(token: string | undefined | null): Promise<Member | null> {
  const session = await readMemberSessionToken(token)
  if (!session) return null
  const account = await prisma.memberAccount.findUnique({ where: { memberId: session.memberId }, include: { member: true } })
  if (!account || account.ownerId !== session.ownerId || account.sessionVersion !== session.sessionVersion) return null
  if (account.member.ownerId !== session.ownerId || account.member.archivedAt) return null
  return account.member
}

export async function getSignedInMember(): Promise<Member | null> {
  return resolveMemberSession((await cookies()).get(MEMBER_COOKIE)?.value)
}

// --- Single-use links --------------------------------------------------------

async function issueToken(member: Pick<Member, 'id' | 'ownerId'>, type: TokenType, hours: number, email?: string) {
  const token = randomBytes(32).toString('base64url')
  // A newer link replaces any older unused one of the same kind.
  await prisma.memberAuthToken.deleteMany({ where: { memberId: member.id, type, usedAt: null } })
  await prisma.memberAuthToken.create({
    data: { ownerId: member.ownerId, memberId: member.id, type, tokenHash: hashToken(token), email: email || null, expiresAt: new Date(Date.now() + hours * 3_600_000) },
  })
  return token
}

async function findToken(token: string, type: TokenType | TokenType[]) {
  if (!token || token.length < 20 || token.length > 200) return null
  const row = await prisma.memberAuthToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { member: true } })
  const types = [type].flat()
  if (!row || !types.includes(row.type as TokenType) || row.usedAt || row.expiresAt < new Date() || row.member.archivedAt) return null
  return row
}

const invalidLink = () => new ApiError(410, 'This link has expired or has already been used. Ask for a new one.', 'invalid_token')

/** What a link is for, so the page can greet the member before they type a password. */
export async function describeToken(token: string) {
  const row = await findToken(token, ['invite', 'reset', 'verify_email'])
  if (!row) throw invalidLink()
  const profile = await prisma.gymProfile.findUnique({ where: { ownerId: row.ownerId }, select: { name: true, logoUrl: true } })
  return { type: row.type as TokenType, firstName: row.member.name.split(' ')[0], email: row.email || row.member.email, gymName: profile?.name || 'your gym', gymLogoUrl: profile?.logoUrl || null }
}

// --- Invitations and activation ------------------------------------------------

export async function accountStatus(ownerId: string, memberId: string) {
  const [account, invite] = await Promise.all([
    prisma.memberAccount.findFirst({ where: { memberId, ownerId }, select: { createdAt: true, lastLoginAt: true, emailVerifiedAt: true } }),
    prisma.memberAuthToken.findFirst({ where: { memberId, ownerId, type: 'invite' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, expiresAt: true, usedAt: true } }),
  ])
  if (account) return { status: 'active' as const, activatedAt: account.createdAt, lastLoginAt: account.lastLoginAt, invitedAt: invite?.createdAt || null }
  if (invite && !invite.usedAt) return { status: invite.expiresAt > new Date() ? ('invited' as const) : ('invite_expired' as const), invitedAt: invite.createdAt, activatedAt: null, lastLoginAt: null }
  return { status: 'none' as const, invitedAt: null, activatedAt: null, lastLoginAt: null }
}

/** Create an invitation link for an existing member. Returns the raw token; only its hash is stored. */
export async function createInvite(ownerId: string, memberId: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId, archivedAt: null } })
  if (!member) throw new ApiError(404, 'Member not found', 'not_found')
  if (!member.email) throw badRequest('Add an email address to this member first.', 'no_email')
  const existing = await prisma.memberAccount.findUnique({ where: { memberId: member.id }, select: { id: true } })
  if (existing) throw new ApiError(409, `${member.name} already has an account. Send a password reset instead.`, 'already_active')
  return { member, token: await issueToken(member, 'invite', INVITE_HOURS) }
}

async function startSession(member: Member, sessionVersion: number) {
  await prisma.memberAccount.update({ where: { memberId: member.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } })
  return signMemberSession({ memberId: member.id, ownerId: member.ownerId, sessionVersion })
}

/**
 * Set a password from an invitation or reset link. Opening the link proves the
 * member controls the address, so it also verifies their email. Never creates
 * a Member: the account always attaches to the one the link was issued for.
 */
export async function setPasswordWithToken(token: string, password: string) {
  validatePassword(password)
  const row = await findToken(token, ['invite', 'reset'])
  if (!row) throw invalidLink()
  const passwordHash = await bcrypt.hash(password, 11)
  const account = await prisma.$transaction(async (db) => {
    // Claim the link first: of two simultaneous submissions only one can win.
    const claimed = await db.memberAuthToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (claimed.count !== 1) throw invalidLink()
    const existing = await db.memberAccount.findUnique({ where: { memberId: row.memberId } })
    const saved = existing
      ? await db.memberAccount.update({ where: { id: existing.id }, data: { passwordHash, emailVerifiedAt: existing.emailVerifiedAt || new Date(), sessionVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } })
      : await db.memberAccount.create({ data: { ownerId: row.ownerId, memberId: row.memberId, passwordHash, emailVerifiedAt: new Date() } })
    await db.memberAuthToken.deleteMany({ where: { memberId: row.memberId, type: { in: ['invite', 'reset'] }, usedAt: null } })
    await logActivity(db, {
      ownerId: row.ownerId, memberId: row.memberId, type: existing ? 'password_reset' : 'account_activated',
      title: existing ? 'Reset their account password' : 'Activated their member account', actor: { type: 'member', id: row.memberId, name: row.member.name },
    })
    return saved
  })
  return { member: row.member, activated: row.type === 'invite', sessionToken: await startSession(row.member, account.sessionVersion) }
}

// --- Signing in --------------------------------------------------------------

export interface LoginResult {
  status: 'ok' | 'choose_gym'
  sessionToken?: string
  member?: Member
  /** The same email and password matched accounts at more than one gym. */
  gyms?: { id: string; name: string }[]
}

const badLogin = () => new ApiError(401, 'That email or password is not right.', 'invalid_credentials')

/**
 * Email and password. Member emails are unique within a gym, not across gyms,
 * so one person can have an account at two gyms; if the same password matches
 * more than one they pick which to open.
 */
export async function loginMember(email: string, password: string, gymId?: string | null): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase()
  const accounts = normalized
    ? await prisma.memberAccount.findMany({
        where: { member: { email: { equals: normalized, mode: 'insensitive' }, archivedAt: null }, ...(gymId && { ownerId: gymId }) },
        include: { member: true },
        take: 10,
      })
    : []
  if (accounts.length === 0) {
    await bcrypt.compare(password, DUMMY_HASH)
    throw badLogin()
  }
  const now = new Date()
  const open = accounts.filter((a) => !a.lockedUntil || a.lockedUntil <= now)
  if (open.length === 0) throw new ApiError(429, 'Too many attempts. Try again in a few minutes, or reset your password.', 'locked')
  const matched = []
  for (const account of open) if (await bcrypt.compare(password, account.passwordHash)) matched.push(account)
  if (matched.length === 0) {
    for (const account of open) {
      const failed = account.failedLogins + 1
      await prisma.memberAccount.update({
        where: { id: account.id },
        data: failed >= MAX_FAILED_LOGINS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
      })
    }
    throw badLogin()
  }
  if (matched.length > 1) {
    const profiles = await prisma.gymProfile.findMany({ where: { ownerId: { in: matched.map((m) => m.ownerId) } }, select: { ownerId: true, name: true } })
    return { status: 'choose_gym', gyms: matched.map((m) => ({ id: m.ownerId, name: profiles.find((p) => p.ownerId === m.ownerId)?.name || 'Gym' })) }
  }
  const account = matched[0]
  return { status: 'ok', member: account.member, sessionToken: await startSession(account.member, account.sessionVersion) }
}

/** End every session for this member (their own "sign out everywhere", or after a password change). */
export async function revokeSessions(memberId: string) {
  const account = await prisma.memberAccount.update({ where: { memberId }, data: { sessionVersion: { increment: 1 } } })
  return account.sessionVersion
}

export async function changePassword(member: Member, currentPassword: string, newPassword: string) {
  const account = await prisma.memberAccount.findUnique({ where: { memberId: member.id } })
  if (!account || !(await bcrypt.compare(currentPassword, account.passwordHash))) throw new ApiError(400, 'Your current password is not right.', 'wrong_password')
  validatePassword(newPassword)
  if (await bcrypt.compare(newPassword, account.passwordHash)) throw badRequest('Choose a password you have not used here before.', 'same_password')
  const updated = await prisma.memberAccount.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(newPassword, 11), sessionVersion: { increment: 1 } } })
  await logActivity(prisma, { ownerId: member.ownerId, memberId: member.id, type: 'password_changed', title: 'Changed their account password', actor: { type: 'member', id: member.id, name: member.name } })
  // Other devices are signed out; this one continues on a fresh session.
  return signMemberSession({ memberId: member.id, ownerId: member.ownerId, sessionVersion: updated.sessionVersion })
}

// --- Recovery ----------------------------------------------------------------

export interface RecoveryLink {
  member: Member
  type: 'reset' | 'invite'
  token: string
}

/**
 * "Forgot password" and "I'm a member but have no password yet" are the same
 * request: every matching member gets a reset link if they have an account or
 * an activation link if they do not. The caller answers identically whether
 * or not anything matched, so the form cannot be used to discover members.
 */
export async function startRecovery(email: string): Promise<RecoveryLink[]> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return []
  const members = await prisma.member.findMany({
    where: { email: { equals: normalized, mode: 'insensitive' }, archivedAt: null },
    include: { account: { select: { id: true } } },
    take: 10,
  })
  const links: RecoveryLink[] = []
  for (const member of members) {
    const type = member.account ? 'reset' : 'invite'
    const { account: _account, ...plain } = member
    links.push({ member: plain as Member, type, token: await issueToken(member, type, type === 'reset' ? RESET_HOURS : INVITE_HOURS) })
  }
  return links
}

/** A reset link for one specific member (staff sending it on the member's behalf). */
export async function createReset(ownerId: string, memberId: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId, archivedAt: null }, include: { account: { select: { id: true } } } })
  if (!member || !member.account) throw new ApiError(404, 'Member account not found', 'not_found')
  return { token: await issueToken(member, 'reset', RESET_HOURS) }
}

// --- Changing email ----------------------------------------------------------

/** A signed-in member asks to move to a new address. Nothing changes until the new address is confirmed. */
export async function requestEmailChange(member: Member, newEmail: string) {
  const email = newEmail.trim().toLowerCase()
  const clash = await prisma.member.findFirst({ where: { ownerId: member.ownerId, email: { equals: email, mode: 'insensitive' }, archivedAt: null, id: { not: member.id } }, select: { id: true } })
  if (clash) throw new ApiError(409, 'That email address is already in use. Please contact the gym.', 'duplicate_email')
  await prisma.memberAccount.update({ where: { memberId: member.id }, data: { pendingEmail: email } })
  return issueToken(member, 'verify_email', VERIFY_HOURS, email)
}

export async function confirmEmail(token: string) {
  const row = await findToken(token, 'verify_email')
  if (!row || !row.email) throw invalidLink()
  const email = row.email
  return prisma.$transaction(async (db) => {
    const claimed = await db.memberAuthToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (claimed.count !== 1) throw invalidLink()
    const clash = await db.member.findFirst({ where: { ownerId: row.ownerId, email: { equals: email, mode: 'insensitive' }, archivedAt: null, id: { not: row.memberId } }, select: { id: true } })
    if (clash) throw new ApiError(409, 'That email address is now in use by someone else. Please contact the gym.', 'duplicate_email')
    const previous = row.member.email
    await db.member.update({ where: { id: row.memberId }, data: { email } })
    await db.memberAccount.updateMany({ where: { memberId: row.memberId }, data: { pendingEmail: null, emailVerifiedAt: new Date() } })
    await logActivity(db, {
      ownerId: row.ownerId, memberId: row.memberId, type: 'email_verified', title: previous.toLowerCase() === email ? 'Verified their email address' : 'Changed their email address',
      detail: previous.toLowerCase() === email ? undefined : `${previous} → ${email}`, actor: { type: 'member', id: row.memberId, name: row.member.name },
    })
    return { email, memberId: row.memberId }
  })
}
