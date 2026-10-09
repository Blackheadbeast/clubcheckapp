import { z } from 'zod'
import { portalHandler } from '@/lib/portal'
import { openSession, sessionView, sourceSchema } from '@/lib/services/workout-sessions'

export const dynamic = 'force-dynamic'

// POST { source, start? } - open the member's own workout for a program day, a class they are booked
// into, an appointment of theirs, or one their coach assigned. The member is who is signed in;
// nothing in the request can name another member.
export const POST = portalHandler({ write: true, body: z.object({ source: sourceSchema, start: z.boolean().optional() }) }, async ({ member, ownerId, body }) => {
  const id = await openSession({ ownerId, memberId: member.id, source: body.source, start: body.start })
  return sessionView(ownerId, id, { memberId: member.id })
})
