import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/** Compare two secrets without leaking, through timing, how much of a guess was right. */
export function sameSecret(given: string | null | undefined, expected: string | null | undefined) {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Whether a request to a scheduled job carries the CRON_SECRET. Vercel Cron sends it as
 * "Authorization: Bearer <secret>"; x-cron-secret is for other schedulers. With no CRON_SECRET
 * set, nothing is authorized. The secret is never accepted in the URL, where it would be logged.
 */
export function cronAuthorized(request: NextRequest) {
  const given = request.headers.get('authorization')?.replace(/^Bearer /, '') || request.headers.get('x-cron-secret')
  return sameSecret(given, process.env.CRON_SECRET)
}
