import { z } from 'zod'
import { portalHandler } from '@/lib/portal'
import { approachSchema, completeSchema, completeSession, deleteSet, logSet, openSession, saveMemberNotes, sessionView, setApproach, setSchema, skipSession } from '@/lib/services/workout-sessions'

export const dynamic = 'force-dynamic'

// GET - one of the member's own workouts: what was prescribed and what they have logged
export const GET = portalHandler({}, async ({ member, ownerId, params }) => sessionView(ownerId, params.id, { memberId: member.id }))

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('set'), set: setSchema }),
  z.object({ action: z.literal('delete_set'), itemId: z.string().min(1).max(40), setNumber: z.number().int().min(1).max(100) }),
  z.object({ action: z.literal('approach'), approach: approachSchema }),
  z.object({ action: z.literal('notes'), notes: z.string().trim().max(2000).nullable() }),
  z.object({ action: z.literal('complete'), result: completeSchema.default({}) }),
  z.object({ action: z.literal('skip'), notes: z.string().trim().max(2000).nullish() }),
])

// POST { action } - start, log or correct a set, remove a set, scale / substitute / skip an exercise, add a note, finish or skip
export const POST = portalHandler({ write: true, body: schema }, async ({ member, ownerId, params, body }) => {
  const mine = { ownerId, memberId: member.id, sessionId: params.id }
  switch (body.action) {
    case 'start':
      await openSession({ ownerId, memberId: member.id, source: { sessionId: params.id }, start: true })
      return sessionView(ownerId, params.id, { memberId: member.id })
    case 'set':
      return { set: await logSet({ ...mine, ...body.set }) }
    case 'delete_set':
      return deleteSet({ ...mine, itemId: body.itemId, setNumber: body.setNumber })
    case 'approach':
      return { approach: await setApproach({ ...mine, ...body.approach }) }
    case 'notes':
      await saveMemberNotes({ ...mine, notes: body.notes })
      return { saved: true }
    case 'complete': {
      const done = await completeSession({ ...mine, ...body.result })
      return { ...done, session: await sessionView(ownerId, params.id, { memberId: member.id }) }
    }
    case 'skip':
      await skipSession({ ...mine, notes: body.notes })
      return { skipped: true }
  }
})
