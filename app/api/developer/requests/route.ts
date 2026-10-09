import { Paginated, handler, paging } from '@/lib/api'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/developer/requests?requestId=&keyId=&failed=1 - the public API's request log, to look up a request ID
export const GET = handler({ permission: 'developer.manage' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = paging(query, 20)
  const where = { ownerId, ...(query.get('requestId') && { id: query.get('requestId')!.trim() }), ...(query.get('keyId') && { apiKeyId: query.get('keyId')! }), ...(query.get('failed') === '1' && { status: { gte: 400 } }) }
  const [rows, total] = await Promise.all([prisma.apiRequestLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }), prisma.apiRequestLog.count({ where })])
  const keys = await prisma.apiKey.findMany({ where: { ownerId, id: { in: rows.map((r) => r.apiKeyId).filter(Boolean) as string[] } }, select: { id: true, name: true, prefix: true } })
  return new Paginated(rows.map((r) => ({ requestId: r.id, method: r.method, path: r.path, status: r.status, errorCode: r.errorCode, durationMs: r.durationMs, at: r.createdAt, key: keys.find((k) => k.id === r.apiKeyId) || null })), total, page, pageSize)
})
