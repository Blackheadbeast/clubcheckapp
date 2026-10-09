import { handler } from '@/lib/api'
import { getPersonThread } from '@/lib/services/sms'

export const dynamic = 'force-dynamic'

// GET /api/members/:id/sms?read=1 - this member's text thread (both directions) and whether they may be texted
export const GET = handler({ permission: ['communication.text', 'communication.send'] }, async ({ ownerId, params, query }) => getPersonThread(ownerId, { memberId: params.id }, { markRead: query.get('read') === '1' }))
