import { handler } from '@/lib/api'
import { memberCard } from '@/lib/services/checkin'

export const dynamic = 'force-dynamic'

// GET /api/checkin/card/:memberId - what the desk needs to see before checking someone in
export const GET = handler({ permission: ['attendance.manage', 'members.view'] }, async ({ ownerId, params, can }) => {
  const card = await memberCard(ownerId, params.memberId)
  if (can('billing.view')) return card
  // Staff without billing access see that there is a balance, not the figures.
  return { ...card, balanceCents: null, creditBalanceCents: null, alerts: card.alerts.map((a) => (/\$/.test(a.message) ? { ...a, message: 'Has a balance due' } : a)) }
})
