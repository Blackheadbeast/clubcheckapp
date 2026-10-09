import { bookingRoute } from '@/lib/public-booking/http'
import { continueLink, resumeSchema } from '@/lib/public-booking/links'
import { personSchema, startAccount } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// POST { name, email, phone, resume? } - create an account. Whoever the address belongs to, the
// answer is the same: a link has been emailed. Setting the password there is the member app's own
// activation step, and it comes back to the booking that was in progress.
export const POST = bookingRoute({ limit: 'identify', write: true, body: personSchema.extend({ resume: resumeSchema }) }, async ({ site, body, origin }) => {
  const { resume, ...person } = body
  return startAccount(site, person, continueLink(site, origin, resume))
})
