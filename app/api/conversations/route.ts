import { handler } from '@/lib/api'
import { listConversations } from '@/lib/services/sms'
import { getSmsProvider } from '@/lib/messaging/sms'

export const dynamic = 'force-dynamic'

// GET /api/conversations?filter=unread|needs_response&search= - the staff text inbox for this gym
export const GET = handler({ permission: ['communication.text', 'communication.send'] }, async ({ ownerId, query }) => {
  const inbox = await listConversations(ownerId, { filter: query.get('filter'), search: query.get('search') })
  return { ...inbox, configured: !!getSmsProvider() }
})
