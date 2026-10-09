import { z } from 'zod'
import { bookingRoute } from '@/lib/public-booking/http'
import { dateInput } from '@/lib/schemas'
import { bookAppointmentOnline } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

const schema = z.object({
  typeId: z.string().uuid(),
  startsAt: dateInput,
  /** Omit for whoever is free. */
  staffId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
  notes: z.string().trim().max(500).nullish().transform((v) => v || null),
})

// POST - book an appointment. The time is checked again, and a paid type is charged, before anything is confirmed.
export const POST = bookingRoute({ limit: 'book', viewer: 'required', write: true, idempotent: true, body: schema }, async ({ site, viewer, body, origin }) =>
  bookAppointmentOnline(site, viewer!, body, origin))
