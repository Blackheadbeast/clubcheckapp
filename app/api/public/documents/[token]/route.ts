import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'
import { evidenceOf, readDownloadToken } from '@/lib/documents/actions'
import { pdfResponse, signedPdf } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const gone = () => NextResponse.json({ error: 'This download link has expired. Sign in to your member account to download the document.', code: 'invalid_link' }, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

// GET - a signed document, for the quarter of an hour after signing it, to whoever holds the token given at that moment
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const limit = checkRateLimit(`doc-download:${getClientIP(req)}`, { windowMs: 60_000, maxRequests: 20 })
  if (!limit.allowed) return NextResponse.json({ error: 'Too many requests.', code: 'rate_limited' }, { status: 429 })
  const ref = await readDownloadToken(params.token)
  if (!ref) return gone()
  const document = await prisma.memberDocument.findFirst({ where: { id: ref.documentId, ownerId: ref.ownerId, memberId: ref.memberId }, include: { member: { select: { name: true, archivedAt: true } } } })
  if (!document || document.member.archivedAt) return gone()
  try {
    const { member, ...row } = document
    return pdfResponse(await signedPdf(row, { type: 'member', id: document.memberId, name: member.name }, evidenceOf(req, 'Signing link')))
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    throw error
  }
}
