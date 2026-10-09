import { z } from 'zod'
import { ApiError, handler } from '@/lib/api'
import { appOrigin } from '@/lib/member-auth-http'
import { documentDetail, resendDocument, voidDocument } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET - one document's state and its audit trail
export const GET = handler({ permission: 'documents.view' }, async ({ ownerId, params, can }) => ({ ...(await documentDetail(ownerId, params.id)), canDownload: can('documents.download'), canSend: can('documents.send'), canManage: can('documents.manage') }))

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resend') }),
  z.object({ action: z.literal('void'), reason: z.string().trim().min(3, 'Say why this document is being voided').max(500) }),
])

// POST { action: "resend" } or { action: "void", reason }
export const POST = handler({ permission: ['documents.send', 'documents.manage'], write: true, body: actionSchema, rateLimit: { key: 'document-action', windowMs: 60_000, maxRequests: 60 } }, async ({ ownerId, params, body, actor, audit, can, req }) => {
  if (body.action === 'resend') {
    if (!can('documents.send')) throw new ApiError(403, 'You do not have permission to send documents.', 'forbidden')
    const result = await resendDocument({ ownerId, id: params.id, actor, origin: appOrigin(req) })
    if (result.resent) await audit('document.resend', `Resent ${result.name}`, { entityType: 'document', entityId: params.id })
    return result
  }
  if (!can('documents.manage')) throw new ApiError(403, 'You do not have permission to void documents.', 'forbidden')
  const result = await voidDocument({ ownerId, id: params.id, reason: body.reason, actor })
  await audit('document.void', `Voided ${result.name}`, { entityType: 'document', entityId: params.id, metadata: { reason: body.reason } })
  return result
})
