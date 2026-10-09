import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { evidenceOf } from '@/lib/documents/actions'
import { pdfResponse, signedPdf } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET - the signed document as a PDF. Needs its own permission: seeing that something was signed is not seeing what it says.
export const GET = handler({ permission: 'documents.download' }, async ({ ownerId, params, actor, req, audit }) => {
  const document = await prisma.memberDocument.findFirst({ where: { id: params.id, ownerId } })
  if (!document) throw notFound('Document')
  const file = await signedPdf(document, actor, evidenceOf(req, 'Staff'))
  await audit('document.download', `Downloaded the signed ${document.name}`, { entityType: 'document', entityId: document.id, metadata: { memberId: document.memberId } })
  return pdfResponse(file)
})
