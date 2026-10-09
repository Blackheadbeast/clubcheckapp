import { z } from 'zod'
import { bookingRoute } from '@/lib/public-booking/http'
import { startPlanOnline } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// POST { planId } - start a free trial, or buy a plan or package with the saved card
export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true, idempotent: true, body: z.object({ planId: z.string().uuid() }) }, async ({ site, viewer, body }) =>
  startPlanOnline(site, viewer!, body.planId))
