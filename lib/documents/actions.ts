// The things a signer can do to their document, and the short-lived token that lets someone who
// has just signed download their copy. Shared by the member app, the emailed signing link and the
// public booking page, so all three behave identically.

import { createHmac } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import type { MemberDocument } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { getClientIP } from '@/lib/rate-limit'
import type { ActorRef } from '@/lib/services/core'
import { declineDocument, declineSchema, markSigningStarted, saveFields, signDocument, signSchema, type Evidence } from '@/lib/services/documents'

export const documentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fields'), fields: z.record(z.string(), z.union([z.string().max(2500), z.boolean()])) }),
  z.object({ action: z.literal('begin') }),
  z.object({ action: z.literal('sign'), ...signSchema.shape }),
  z.object({ action: z.literal('decline'), ...declineSchema.shape }),
])

export const evidenceOf = (req: NextRequest, via: Evidence['via']): Evidence => ({ ip: getClientIP(req), userAgent: req.headers.get('user-agent'), via })

export async function runDocumentAction(document: MemberDocument, body: z.infer<typeof documentActionSchema>, actor: ActorRef, evidence: Evidence, tokenId?: string) {
  switch (body.action) {
    case 'fields':
      return saveFields({ document, fields: body.fields, actor, evidence })
    case 'begin':
      return markSigningStarted(document, actor, evidence)
    case 'sign': {
      const { action: _action, ...input } = body
      const signed = await signDocument({ document, tokenId, actor, evidence, ...input })
      // Whoever signs can take their copy away with them, without needing an account.
      return { ...signed, downloadToken: await signDownloadToken(document) }
    }
    case 'decline':
      return declineDocument({ document, tokenId, reason: body.reason, actor, evidence })
  }
}

function secret() {
  const base = process.env.JWT_SECRET
  if (!base) throw new Error('JWT_SECRET is not set')
  return createHmac('sha256', base).update('clubcheck:document-download:v1').digest()
}
const DOWNLOAD_MINUTES = 15

/** Good for one document, for a quarter of an hour. */
export async function signDownloadToken(document: Pick<MemberDocument, 'id' | 'ownerId' | 'memberId'>) {
  return new SignJWT({ did: document.id, gid: document.ownerId, mid: document.memberId, typ: 'document-download' })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('clubcheck-document').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + DOWNLOAD_MINUTES * 60).sign(secret())
}

export async function readDownloadToken(token: string): Promise<{ documentId: string; ownerId: string; memberId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: 'clubcheck-document' })
    if (payload.typ !== 'document-download' || typeof payload.did !== 'string' || typeof payload.gid !== 'string' || typeof payload.mid !== 'string') return null
    return { documentId: payload.did, ownerId: payload.gid, memberId: payload.mid }
  } catch {
    return null
  }
}
