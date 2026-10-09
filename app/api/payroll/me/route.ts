import { handler, notFound } from '@/lib/api'
import { myEarnings, myLines } from '@/lib/services/payroll'

export const dynamic = 'force-dynamic'

// GET /api/payroll/me?periodId= - the signed-in staff member's own earnings, and nobody else's
export const GET = handler({ permission: null }, async ({ ownerId, actor, query }) => {
  // The account owner is not on the payroll.
  if (actor.type !== 'staff') return { periods: [], lines: null }
  const periodId = query.get('periodId')
  if (periodId && !/^[0-9a-f-]{36}$/i.test(periodId)) throw notFound('Pay period')
  return { ...(await myEarnings(ownerId, actor.id)), lines: periodId ? await myLines(ownerId, actor.id, periodId) : null }
})
