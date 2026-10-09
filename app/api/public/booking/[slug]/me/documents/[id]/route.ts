import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api'
import { bookingRoute } from '@/lib/public-booking/http'
import { documentActionSchema, evidenceOf, runDocumentAction } from '@/lib/documents/actions'
import { openDocument } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

const actorOf = (viewer: { member: { id: string; name: string } }) => ({ type: 'member' as const, id: viewer.member.id, name: viewer.member.name })

// A document the person booking has to sign first. Only ever their own, and only this gym's.
async function own(ownerId: string, memberId: string, id: string) {
  const document = await prisma.memberDocument.findFirst({ where: { id, ownerId, memberId } })
  if (!document) throw notFound('Document')
  return document
}

// GET - read it
export const GET = bookingRoute({ limit: 'read', viewer: 'required' }, async ({ site, viewer, params, req }) =>
  // The name they gave a moment ago is offered as the name to sign with; they can change it.
  ({ ...(await openDocument(await own(site.ownerId, viewer!.member.id, params.id), actorOf(viewer!), evidenceOf(req, 'Online booking'))), signerHint: viewer!.member.name }))

// POST { action: "fields" | "begin" | "sign" | "decline" }
export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true, body: documentActionSchema }, async ({ site, viewer, params, body, req }) =>
  runDocumentAction(await own(site.ownerId, viewer!.member.id, params.id), body, actorOf(viewer!), evidenceOf(req, 'Online booking')))
