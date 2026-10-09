// Failed sign-in attempts, counted in the database. The in-memory limiter in lib/rate-limit.ts
// only sees the requests that reach one server instance, which on a serverless host is not much
// of a limit. This one is shared by every instance, so guessing a password stops after a handful
// of tries wherever the requests land. Only failures are counted; a correct password is never slowed.

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

/** Who, or what, is being guessed at. */
export type AttemptKind = 'owner' | 'staff' | 'sales' | 'waiver'

const WINDOW_MINUTES = 15
export const MAX_FAILED_SIGN_INS = 10

/** One bucket per account per quarter of an hour. The address is hashed: the table holds no emails. */
function bucket(kind: AttemptKind, account: string) {
  const slot = Math.floor(Date.now() / (WINDOW_MINUTES * 60_000))
  return `login:${kind}:${createHash('sha256').update(account.toLowerCase().trim()).digest('hex').slice(0, 32)}:${slot}`
}

/** True when this account has had too many wrong passwords in the current window. */
export async function signInBlocked(kind: AttemptKind, account: string) {
  const row = await prisma.apiRateWindow.findUnique({ where: { id: bucket(kind, account) }, select: { count: true } }).catch(() => null)
  return (row?.count || 0) >= MAX_FAILED_SIGN_INS
}

export async function recordFailedSignIn(kind: AttemptKind, account: string) {
  const id = bucket(kind, account)
  const expiresAt = new Date(Date.now() + 2 * WINDOW_MINUTES * 60_000)
  // One statement, so simultaneous guesses are all counted.
  await prisma.$executeRaw`INSERT INTO "ApiRateWindow" (id, count, "expiresAt") VALUES (${id}, 1, ${expiresAt}) ON CONFLICT (id) DO UPDATE SET count = "ApiRateWindow".count + 1`.catch(() => {})
}

/**
 * Count one use of something that should only happen a few times in a window (an account email
 * to one address, say), and say whether this use is still within the limit. Shared by every
 * server instance, like the sign-in counter above.
 */
export async function withinLimit(what: string, subject: string, max: number): Promise<boolean> {
  const slot = Math.floor(Date.now() / (WINDOW_MINUTES * 60_000))
  const id = `limit:${what}:${createHash('sha256').update(subject.toLowerCase().trim()).digest('hex').slice(0, 32)}:${slot}`
  const expiresAt = new Date(Date.now() + 2 * WINDOW_MINUTES * 60_000)
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`INSERT INTO "ApiRateWindow" (id, count, "expiresAt") VALUES (${id}, 1, ${expiresAt}) ON CONFLICT (id) DO UPDATE SET count = "ApiRateWindow".count + 1 RETURNING count`
    return (rows[0]?.count ?? 1) <= max
  } catch {
    // If the counter cannot be reached, do not lock people out of their own account emails.
    return true
  }
}
