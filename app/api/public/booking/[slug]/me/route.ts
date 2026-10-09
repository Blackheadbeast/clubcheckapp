import { z } from 'zod'
import { bookingRoute } from '@/lib/public-booking/http'
import { cancelOnline, myUpcoming } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// GET - what this person has coming up here
export const GET = bookingRoute({ limit: 'read', viewer: 'required' }, async ({ site, viewer }) => myUpcoming(site, viewer!))

// POST { kind, id } - cancel one of their own, by the gym's cancellation rules
export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true, body: z.object({ kind: z.enum(['class', 'appointment']), id: z.string().uuid() }) }, async ({ site, viewer, body, origin }) =>
  cancelOnline(site, { memberId: viewer!.member.id }, body.kind, body.id, origin))
