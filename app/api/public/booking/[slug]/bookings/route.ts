import { z } from 'zod'
import { bookingRoute } from '@/lib/public-booking/http'
import { bookClassOnline } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// POST { classId, joinWaitlist? } - book a class or join its waitlist
export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true, idempotent: true, body: z.object({ classId: z.string().uuid(), joinWaitlist: z.boolean().optional() }) }, async ({ site, viewer, body, origin }) =>
  bookClassOnline(site, viewer!, body, origin))
