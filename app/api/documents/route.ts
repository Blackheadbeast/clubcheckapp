import { Paginated, handler, paging } from '@/lib/api'
import { DOCUMENT_STATUSES, DOCUMENT_TYPE_KEYS } from '@/lib/documents/content'
import { searchDocuments } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET /api/documents?search=&status=&type=&templateId=&memberId=&signed=yes|no&from=&to=&expiringDays=
// Every document sent to a member: who, what, where it has got to. Never the wording or the signature.
export const GET = handler({ permission: 'documents.view' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = paging(query, 25)
  const one = <T extends string>(name: string, allowed: readonly T[]) => (allowed.includes(query.get(name) as T) ? (query.get(name) as T) : null)
  const date = (name: string) => { const v = query.get(name); const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : undefined }
  const expiringDays = parseInt(query.get('expiringDays') || '', 10)
  const result = await searchDocuments(ownerId, {
    search: query.get('search'), status: one('status', DOCUMENT_STATUSES), type: one('type', DOCUMENT_TYPE_KEYS), templateId: query.get('templateId'), memberId: query.get('memberId'),
    signed: one('signed', ['yes', 'no'] as const), from: date('from'), to: date('to'),
    expiringBefore: expiringDays > 0 ? new Date(Date.now() + Math.min(expiringDays, 3650) * 86_400_000) : undefined, skip, take,
  })
  return new Paginated(result.items, result.total, page, pageSize, { counts: result.counts })
})
