import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { evidenceOf } from '@/lib/documents/actions'
import { pdfResponse, signedPdf } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET - the member's own signed copy, as a PDF
export const GET = portalHandler({}, async ({ member, ownerId, params, req, actor }) => {
  const document = await prisma.memberDocument.findFirst({ where: { id: params.id, ownerId, memberId: member.id } })
  if (!document) throw notFound('Document')
  return pdfResponse(await signedPdf(document, actor, evidenceOf(req, 'Member app')))
})
