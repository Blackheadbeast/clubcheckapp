// Session credits on a membership (class packs, drop-ins, PT packages).
// Classes and appointments both spend and return them through here, so there
// is one rule for "does this member have a session left".

import { ApiError } from '@/lib/api'
import type { Db } from './core'

/** Take credits atomically. Two simultaneous bookings cannot both spend the last one. */
export async function spendCredits(db: Db, membership: { id: string; plan: { name: string } }, count = 1) {
  if (count <= 0) return
  const spent = await db.membership.updateMany({
    where: { id: membership.id, creditsRemaining: { gte: count } },
    data: { creditsRemaining: { decrement: count } },
  })
  if (spent.count === 0) throw new ApiError(422, `No sessions left on ${membership.plan.name}.`, 'insufficient_credits')
}

export async function returnCredits(db: Db, membershipId: string, count = 1) {
  if (count <= 0) return
  await db.membership.update({ where: { id: membershipId }, data: { creditsRemaining: { increment: count } } })
}
