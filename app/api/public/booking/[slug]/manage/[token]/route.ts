import { ApiError } from '@/lib/api'
import { bookingRoute } from '@/lib/public-booking/http'
import { readManageToken } from '@/lib/public-booking/tokens'
import { cancelOnline, manageView } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

const expired = () => new ApiError(404, 'This link has expired or is not valid.', 'not_found')

// GET - the one booking a "manage your booking" link names
export const GET = bookingRoute({ limit: 'read' }, async ({ site, params }) => {
  const ref = await readManageToken(params.token)
  if (!ref) throw expired()
  return manageView(site, ref)
})

// POST - cancel it
export const POST = bookingRoute({ limit: 'book', write: true }, async ({ site, params, origin }) => {
  const ref = await readManageToken(params.token)
  if (!ref || ref.ownerId !== site.ownerId) throw expired()
  return cancelOnline(site, { memberId: ref.memberId }, ref.kind, ref.id, origin)
})
