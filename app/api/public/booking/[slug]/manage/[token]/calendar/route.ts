import { ApiError } from '@/lib/api'
import { bookingRoute } from '@/lib/public-booking/http'
import { readManageToken } from '@/lib/public-booking/tokens'
import { calendarFile, manageView } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET - an .ics file for the booking, for any calendar app
export const GET = bookingRoute({ limit: 'read' }, async ({ site, params }) => {
  const ref = await readManageToken(params.token)
  if (!ref) throw new ApiError(404, 'This link has expired or is not valid.', 'not_found')
  const c = await manageView(site, ref)
  return new Response(calendarFile(site, c), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'booking'}.ics"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
})
