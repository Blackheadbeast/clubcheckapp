import { prisma } from '@/lib/prisma'
import { handler, notFound } from '@/lib/api'
import { memberDocumentHistory } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET - everything this member has been sent, signed, declined or had voided
export const GET = handler({ permission: 'documents.view' }, async ({ ownerId, params, can }) => {
  if (!(await prisma.member.findFirst({ where: { id: params.id, ownerId }, select: { id: true } }))) throw notFound('Member')
  const [documents, templates] = await Promise.all([
    memberDocumentHistory(ownerId, params.id),
    prisma.documentTemplate.findMany({ where: { ownerId, archivedAt: null, publishedVersionId: { not: null } }, orderBy: { name: 'asc' }, select: { id: true, name: true, type: true } }),
  ])
  return { documents, templates, can: { send: can('documents.send'), download: can('documents.download'), manage: can('documents.manage') } }
})
