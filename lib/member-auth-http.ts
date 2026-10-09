// Plumbing for the member sign-in endpoints: rate limiting, validation,
// consistent errors, and the emails that carry single-use links.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Resend } from 'resend'
import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, fail, readJson } from '@/lib/api'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { emailHtml } from '@/lib/services/messaging'

export function appOrigin(req: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
}

/** Reject cookie-authenticated writes that come from another site. */
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    const host = new URL(origin).host
    return host === req.nextUrl.host || host === req.headers.get('host') || origin === (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  } catch {
    return false
  }
}

/**
 * Native apps cannot rely on cookies. A client that identifies itself with
 * `X-ClubCheck-Client: native` gets the session back in the response body to
 * keep in the device's secure storage and send as a bearer token. Browsers
 * never ask for this, so a web session token is never readable by page scripts.
 */
export function wantsToken(req: NextRequest) {
  return (req.headers.get('x-clubcheck-client') || '').toLowerCase() === 'native'
}

export function authRoute<S extends z.ZodTypeAny | undefined = undefined>(
  opts: { body?: S; limit?: { key: string; windowMs: number; maxRequests: number } },
  fn: (ctx: { req: NextRequest; body: S extends z.ZodTypeAny ? z.infer<S> : undefined; params: Record<string, string> }) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx: { params?: Record<string, string> | Promise<Record<string, string>> } = {}) => {
    try {
      if (req.method !== 'GET' && !wantsToken(req) && !req.headers.get('authorization') && !sameOrigin(req)) return fail(403, 'This request did not come from ClubCheck.', 'bad_origin')
      if (opts.limit) {
        const result = checkRateLimit(`${opts.limit.key}:${getClientIP(req)}`, opts.limit)
        if (!result.allowed) {
          return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) } })
        }
      }
      let body: unknown
      if (opts.body) {
        const parsed = opts.body.safeParse(await readJson(req).catch(() => null))
        if (!parsed.success) return fail(400, parsed.error.issues[0].message, 'validation_error')
        body = parsed.data
      }
      const result = await fn({ req, body: body as any, params: (await routeCtx.params) || {} })
      if (result instanceof Response) return result
      return NextResponse.json({ data: result ?? null }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code, error.details)
      console.error(`[member-auth] ${req.method} ${req.nextUrl.pathname.replace(/[A-Za-z0-9_-]{30,}/, ':token')} failed:`, error)
      return fail(500, 'Something went wrong. Please try again.', 'internal_error')
    }
  }
}

type Kind = 'invite' | 'reset' | 'verify_email'

const COPY: Record<Kind, { subject: (gym: string) => string; lead: (gym: string) => string; action: string; path: string; expiry: string }> = {
  invite: {
    subject: (gym) => `Set up your ${gym} member account`,
    lead: (gym) => `You've been invited to access your member account at ${gym}. Choose a password to see your schedule, book classes, and manage your membership and billing.`,
    action: 'Set up your account', path: '/member/activate', expiry: 'This link works once and expires in 7 days.',
  },
  reset: {
    subject: (gym) => `Reset your ${gym} password`,
    lead: (gym) => `We received a request to reset the password for your ${gym} member account.`,
    action: 'Choose a new password', path: '/member/reset', expiry: "This link works once and expires in 2 hours. If you didn't ask for it, you can ignore this email and your password stays the same.",
  },
  verify_email: {
    subject: (gym) => `Confirm your email for ${gym}`,
    lead: (gym) => `Confirm this address to use it for your ${gym} member account.`,
    action: 'Confirm email address', path: '/member/verify', expiry: 'This link works once and expires in 48 hours. Until then your account keeps using your previous address.',
  },
}

/**
 * Email a single-use link. The link is never written to the message log or
 * returned to a browser. Without an email provider (local development) it is
 * printed to the server console instead.
 */
export async function sendAccountEmail(member: Pick<Member, 'ownerId' | 'name'>, to: string, kind: Kind, token: string, origin: string, next?: string | null) {
  const profile = await prisma.gymProfile.findUnique({ where: { ownerId: member.ownerId }, select: { name: true } })
  const gym = profile?.name || 'your gym'
  const copy = COPY[kind]
  // `next` is where to go once the password is set: only ever a path on this site, chosen by the server.
  const url = `${origin}${copy.path}/${token}${next ? `?next=${encodeURIComponent(next)}` : ''}`
  const text = `Hi ${member.name.split(' ')[0]},\n\n${copy.lead(gym)}\n\n${copy.action}: ${url}\n\n${copy.expiry}`
  // Reserved test domains can never receive mail, so do not hand them to the email provider.
  const undeliverable = /\.(local|test|invalid|example|localhost)$/i.test(to)
  if (!process.env.RESEND_API_KEY || undeliverable) {
    if (process.env.NODE_ENV !== 'production') console.log(`[member-auth] ${kind} link for ${to}: ${url}`)
    return { delivered: false }
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({ from: process.env.EMAIL_FROM || 'ClubCheck <onboarding@resend.dev>', to, subject: copy.subject(gym), text, html: emailHtml(gym, text) })
    if (error) {
      console.error(`[member-auth] could not send ${kind} email:`, error.message)
      return { delivered: false }
    }
    return { delivered: true }
  } catch (error) {
    console.error(`[member-auth] could not send ${kind} email:`, error instanceof Error ? error.message : error)
    return { delivered: false }
  }
}
