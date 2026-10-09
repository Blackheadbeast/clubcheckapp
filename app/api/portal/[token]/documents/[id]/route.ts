import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { portalHandler } from '@/lib/portal'
import { documentActionSchema, evidenceOf, runDocumentAction } from '@/lib/documents/actions'
import { openMemberDocument } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET - open one of their own documents to read it (recorded as viewed; never signs anything)
export const GET = portalHandler({}, async ({ member, ownerId, params, req, actor }) => ({ ...(await openMemberDocument(ownerId, member.id, params.id, actor, evidenceOf(req, 'Member app'))), signerHint: member.name }))

// POST { action: "fields" | "begin" | "sign" | "decline" }
export const POST = portalHandler({ write: true, body: documentActionSchema }, async ({ member, ownerId, params, body, req, actor }) => {
  const document = await prisma.memberDocument.findFirst({ where: { id: params.id, ownerId, memberId: member.id } })
  if (!document) throw notFound('Document')
  return runDocumentAction(document, body, actor, evidenceOf(req, 'Member app'))
})
