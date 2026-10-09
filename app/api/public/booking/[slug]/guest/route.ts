import { z } from 'zod'
import { bookingRoute, tokenFor } from '@/lib/public-booking/http'
import { continueLink, resumeSchema } from '@/lib/public-booking/links'
import { identifyGuest, personSchema, viewerOut } from '@/lib/services/public-booking'

export const dynamic = 'force-dynamic'

// POST { name, email, phone, resume? } - book without an account. A new address is taken at its
// word and given a short-lived token. An address this gym already knows is emailed a link instead,
// and the browser is told only to check its email.
export const POST = bookingRoute({ limit: 'identify', write: true, body: personSchema.extend({ resume: resumeSchema }) }, async ({ site, body, origin }) => {
  const { resume, ...person } = body
  const result = await identifyGuest(site, person, continueLink(site, origin, resume))
  if (result.status === 'check_email') return { status: 'check_email' as const }
  const viewer = { member: result.member, hasAccount: false }
  return { status: 'ok' as const, viewer: viewerOut(viewer), token: await tokenFor(viewer) }
})

export type GuestBody = z.infer<typeof personSchema>
