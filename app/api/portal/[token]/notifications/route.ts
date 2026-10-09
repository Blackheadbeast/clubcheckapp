import { portalHandler } from '@/lib/portal'
import { CATEGORIES, listNotifications } from '@/lib/services/member-notifications'

export const dynamic = 'force-dynamic'

// GET ?before=<ISO>&category=&take= - the member's notification center, newest first
export const GET = portalHandler({}, async ({ req, member }) => {
  const query = req.nextUrl.searchParams
  const before = query.get('before')
  const category = query.get('category')
  return listNotifications(member.id, {
    take: parseInt(query.get('take') || '20', 10) || 20,
    before: before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null,
    category: category && (CATEGORIES as readonly string[]).includes(category) ? category : null,
  })
})
