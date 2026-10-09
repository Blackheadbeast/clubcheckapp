import { portalHandler } from '@/lib/portal'
import { memberDocuments } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET - the member's own documents: what needs signing, what is signed, what has expired or was declined
export const GET = portalHandler({}, async ({ member, ownerId }) => memberDocuments(ownerId, member.id))
