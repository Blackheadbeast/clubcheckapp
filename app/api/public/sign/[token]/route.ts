import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { documentActionSchema, evidenceOf, runDocumentAction } from '@/lib/documents/actions'
import { documentForToken, openDocument } from '@/lib/services/documents'
import { getGymSettings } from '@/lib/services/core'
import { kickWebhooks } from '@/lib/services/webhooks'

export const dynamic = 'force-dynamic'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', ...headers } })

/** An emailed signing link. The token in the address is the only credential; it is looked up by its hash and never logged. */
async function run(req: NextRequest, params: { token: string }, fn: (found: Awaited<ReturnType<typeof documentForToken>>) => Promise<unknown>) {
  try {
    const limit = checkRateLimit(`sign-link:${getClientIP(req)}`, { windowMs: 60_000, maxRequests: 40 })
    if (!limit.allowed) return json(429, { error: 'Too many requests. Please wait a moment and try again.', code: 'rate_limited' }, { 'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) })
    return json(200, { data: await fn(await documentForToken(params.token)) })
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: error.message, code: error.code || 'error', ...(error.details !== undefined && error.code === 'fields_incomplete' && { details: error.details }) })
    console.error(`[documents] ${req.method} /api/public/sign/:token failed:`, (error as Error).message)
    return json(500, { error: 'Something went wrong on our side. Please try again.', code: 'internal_error' })
  }
}

// GET - open the document the link is for. Recorded as viewed; nothing is signed by opening it.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  return run(req, params, async ({ document }) => {
    const member = await prisma.member.findUnique({ where: { id: document.memberId }, select: { name: true, archivedAt: true } })
    if (!member || member.archivedAt) throw new ApiError(404, 'This link has expired or is no longer valid.', 'invalid_link')
    const actor = { type: 'member' as const, id: document.memberId, name: member.name }
    const [view, settings] = await Promise.all([openDocument(document, actor, evidenceOf(req, 'Signing link')), getGymSettings(document.ownerId)])
    return { ...view, gymName: settings.name, signerHint: member.name }
  })
}

// POST { action: "fields" | "begin" | "sign" | "decline" } - signing or declining uses the link up
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  return run(req, params, async ({ document, tokenId }) => {
    const parsed = documentActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message, 'validation_error')
    const member = await prisma.member.findUnique({ where: { id: document.memberId }, select: { name: true, archivedAt: true } })
    if (!member || member.archivedAt) throw new ApiError(404, 'This link has expired or is no longer valid.', 'invalid_link')
    const result = await runDocumentAction(document, parsed.data, { type: 'member', id: document.memberId, name: member.name }, evidenceOf(req, 'Signing link'), tokenId)
    kickWebhooks(document.ownerId)
    return result
  })
}
