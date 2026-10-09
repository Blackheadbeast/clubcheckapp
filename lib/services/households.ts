// Households: members who are billed together.
//
// A household shares exactly one thing: who pays. One member is the payer, and every invoice raised
// for anyone in the household is charged to the payer's saved card or bank account. Nothing else is
// merged. Each member keeps their own membership, invoices, bookings, attendance, credits and profile,
// and an invoice always belongs to the member it is for.
//
// Who pays is looked up at the moment money is collected, so changing the payer, or a member leaving,
// affects future charges only. Past invoices and payments are never rewritten.

import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { ActorRef, Db, lockRow, logActivity } from './core'
import { invoiceBalance } from './payments'
import { LIVE_STATUSES } from './memberships'

const conflict = (message: string, code: string) => new ApiError(409, message, code)

/**
 * Who is charged for this member's invoices: their household's payer, or themselves.
 * The payer must still be a member of the same household and the same gym to count.
 */
export async function billingPayer(db: Db, ownerId: string, memberId: string) {
  const member = await db.member.findFirst({ where: { id: memberId, ownerId }, select: { id: true, householdId: true } })
  if (!member?.householdId) return { payerId: memberId, viaHousehold: false, householdId: null as string | null }
  const household = await db.household.findFirst({ where: { id: member.householdId, ownerId }, select: { id: true, payerMemberId: true } })
  if (!household?.payerMemberId || household.payerMemberId === memberId) return { payerId: memberId, viaHousehold: false, householdId: household?.id || null }
  const payer = await db.member.findFirst({ where: { id: household.payerMemberId, ownerId, householdId: household.id }, select: { id: true } })
  if (!payer) return { payerId: memberId, viaHousehold: false, householdId: household.id }
  return { payerId: payer.id, viaHousehold: true, householdId: household.id }
}

async function loadHousehold(db: Db, ownerId: string, id: string) {
  await lockRow(db, 'Household', id)
  const household = await db.household.findFirst({ where: { id, ownerId }, include: { members: { select: { id: true, name: true } } } })
  if (!household) throw notFound('Household')
  return household
}

/** A member who can join: in this gym, not archived, and not already in a household. */
async function joinable(db: Db, ownerId: string, memberId: string, householdId?: string) {
  await lockRow(db, 'Member', memberId)
  const member = await db.member.findFirst({ where: { id: memberId, ownerId }, select: { id: true, name: true, householdId: true, archivedAt: true } })
  if (!member) throw notFound('Member')
  if (member.archivedAt) throw badRequest(`${member.name} is archived. Restore them first.`, 'member_archived')
  if (member.householdId && member.householdId !== householdId) throw conflict(`${member.name} is already in another household. Remove them from it first.`, 'already_in_household')
  return member
}

export async function createHousehold(db: Db, input: { ownerId: string; name?: string | null; payerMemberId: string; memberIds?: string[]; actor?: ActorRef }) {
  const ids = Array.from(new Set([input.payerMemberId, ...(input.memberIds || [])]))
  if (ids.length > 20) throw badRequest('A household can have at most 20 members.', 'household_too_large')
  // Lock in a fixed order so two requests naming the same people cannot deadlock.
  const members = []
  for (const id of [...ids].sort()) members.push(await joinable(db, input.ownerId, id))
  const payer = members.find((m) => m.id === input.payerMemberId)!
  if (members.some((m) => m.householdId)) throw conflict(`${members.find((m) => m.householdId)!.name} is already in a household.`, 'already_in_household')
  const household = await db.household.create({
    data: { ownerId: input.ownerId, name: input.name?.trim() || `${payer.name.split(/\s+/).slice(-1)[0]} household`, payerMemberId: payer.id },
  })
  await db.member.updateMany({ where: { ownerId: input.ownerId, id: { in: ids } }, data: { householdId: household.id } })
  for (const m of members) {
    await logActivity(db, {
      ownerId: input.ownerId, memberId: m.id, type: 'household', actor: input.actor,
      title: m.id === payer.id ? `Became the payer for the ${household.name}` : `Joined the ${household.name}`,
      detail: m.id === payer.id ? undefined : `Billed to ${payer.name}`, metadata: { householdId: household.id },
    })
  }
  return { household, payer, members }
}

export async function addHouseholdMember(db: Db, input: { ownerId: string; householdId: string; memberId: string; actor?: ActorRef }) {
  const household = await loadHousehold(db, input.ownerId, input.householdId)
  if (household.members.some((m) => m.id === input.memberId)) return { household, added: false }
  if (household.members.length >= 20) throw badRequest('A household can have at most 20 members.', 'household_too_large')
  const member = await joinable(db, input.ownerId, input.memberId, household.id)
  await db.member.update({ where: { id: member.id }, data: { householdId: household.id } })
  const payer = household.members.find((m) => m.id === household.payerMemberId)
  await logActivity(db, {
    ownerId: input.ownerId, memberId: member.id, type: 'household', actor: input.actor, title: `Joined the ${household.name}`,
    detail: payer ? `Future invoices are billed to ${payer.name}` : undefined, metadata: { householdId: household.id },
  })
  return { household, added: true, member }
}

/**
 * Take a member out of a household. Their memberships, invoices and history are untouched; from now
 * on their invoices are charged to them. The payer cannot leave while others depend on them.
 */
export async function removeHouseholdMember(db: Db, input: { ownerId: string; householdId: string; memberId: string; actor?: ActorRef }) {
  const household = await loadHousehold(db, input.ownerId, input.householdId)
  const member = household.members.find((m) => m.id === input.memberId)
  if (!member) throw notFound('Household member')
  const others = household.members.filter((m) => m.id !== member.id)
  if (household.payerMemberId === member.id && others.length > 0) {
    throw conflict(`${member.name} pays for this household. Choose another payer before removing them.`, 'payer_cannot_leave')
  }
  await db.member.update({ where: { id: member.id }, data: { householdId: null } })
  await logActivity(db, {
    ownerId: input.ownerId, memberId: member.id, type: 'household', actor: input.actor, title: `Left the ${household.name}`,
    detail: 'Future invoices are billed to them directly. Past invoices are unchanged.', metadata: { householdId: household.id },
  })
  // Nobody left to bill together: the household itself goes, the financial records do not.
  let dissolved = false
  if (others.length === 0) {
    await db.household.delete({ where: { id: household.id } })
    dissolved = true
  }
  return { household, member, dissolved }
}

export async function setHouseholdPayer(db: Db, input: { ownerId: string; householdId: string; payerMemberId: string; actor?: ActorRef }) {
  const household = await loadHousehold(db, input.ownerId, input.householdId)
  const payer = household.members.find((m) => m.id === input.payerMemberId)
  // Only someone already in the household can pay for it: a payer is never a way in for an outsider.
  if (!payer) throw badRequest('The payer has to be a member of this household. Add them first.', 'payer_not_in_household')
  if (household.payerMemberId === payer.id) return { household, previous: payer, payer, changed: false }
  const previous = household.members.find((m) => m.id === household.payerMemberId) || null
  const updated = await db.household.update({ where: { id: household.id }, data: { payerMemberId: payer.id } })
  for (const m of household.members) {
    await logActivity(db, {
      ownerId: input.ownerId, memberId: m.id, type: 'household', actor: input.actor,
      title: m.id === payer.id ? `Became the payer for the ${household.name}` : `Billing moved to ${payer.name}`,
      detail: previous ? `Was ${previous.name}. Applies to charges from now on.` : 'Applies to charges from now on.', metadata: { householdId: household.id },
    })
  }
  return { household: updated, previous, payer, changed: true }
}

export async function renameHousehold(db: Db, input: { ownerId: string; householdId: string; name: string }) {
  const result = await db.household.updateMany({ where: { id: input.householdId, ownerId: input.ownerId }, data: { name: input.name.trim() } })
  if (result.count === 0) throw notFound('Household')
}

/** Stop billing these members together. Every record stays; each member is billed directly from now on. */
export async function dissolveHousehold(db: Db, input: { ownerId: string; householdId: string; actor?: ActorRef }) {
  const household = await loadHousehold(db, input.ownerId, input.householdId)
  await db.member.updateMany({ where: { ownerId: input.ownerId, householdId: household.id }, data: { householdId: null } })
  for (const m of household.members) {
    await logActivity(db, { ownerId: input.ownerId, memberId: m.id, type: 'household', actor: input.actor, title: `The ${household.name} was dissolved`, detail: 'Future invoices are billed to them directly.', metadata: { householdId: household.id } })
  }
  await db.household.delete({ where: { id: household.id } })
  return household
}

/** Everything billing-related about a household: who is in it, what each is on, and what is owed. Billing only. */
export async function getHousehold(ownerId: string, id: string) {
  const household = await prisma.household.findFirst({ where: { id, ownerId } })
  if (!household) throw notFound('Household')
  const members = await prisma.member.findMany({
    where: { ownerId, householdId: household.id },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, photoUrl: true, status: true, creditBalanceCents: true, archivedAt: true,
      memberships: { where: { status: { in: LIVE_STATUSES } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, priceCents: true, currentPeriodEnd: true, paymentMethod: true, failedPaymentCount: true, plan: { select: { name: true, type: true, billingInterval: true, intervalCount: true } } } },
    },
  })
  const ids = members.map((m) => m.id)
  const now = new Date()
  const [invoices, payments, methods] = await Promise.all([
    prisma.invoice.findMany({
      where: { ownerId, memberId: { in: ids }, status: { in: ['open', 'paid', 'uncollectible'] } },
      orderBy: { createdAt: 'desc' }, take: 60,
      select: { id: true, number: true, status: true, totalCents: true, amountPaidCents: true, refundedCents: true, dueDate: true, createdAt: true, attemptCount: true, nextAttemptAt: true, memberId: true, items: { select: { description: true }, take: 1 } },
    }),
    prisma.transaction.findMany({
      where: { ownerId, memberId: { in: ids }, type: { in: ['payment', 'refund'] } },
      orderBy: { createdAt: 'desc' }, take: 60,
      select: { id: true, type: true, status: true, amountCents: true, refundedCents: true, method: true, cardLast4: true, failureReason: true, createdAt: true, memberId: true, payerMemberId: true, invoice: { select: { number: true } } },
    }),
    household.payerMemberId ? prisma.paymentMethod.findMany({ where: { ownerId, memberId: household.payerMemberId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], select: { id: true, type: true, brand: true, bankName: true, last4: true, expMonth: true, expYear: true, isDefault: true } }) : [],
  ])
  const name = (memberId: string | null) => members.find((m) => m.id === memberId)?.name || null
  const open = invoices.filter((i) => i.status === 'open')
  const owed = (memberId?: string) => open.filter((i) => !memberId || i.memberId === memberId).reduce((sum, i) => sum + invoiceBalance(i), 0)
  const overdue = open.filter((i) => i.dueDate && i.dueDate < now)
  return {
    id: household.id, name: household.name, payerMemberId: household.payerMemberId, createdAt: household.createdAt,
    payer: household.payerMemberId ? { id: household.payerMemberId, name: name(household.payerMemberId), paymentMethods: methods } : null,
    members: members.map((m) => ({
      id: m.id, name: m.name, photoUrl: m.photoUrl, status: m.status, archived: !!m.archivedAt, isPayer: m.id === household.payerMemberId,
      creditCents: m.creditBalanceCents, amountDueCents: owed(m.id),
      // Affected by a payment problem: a failed charge or an overdue invoice on one of their memberships.
      paymentProblem: m.memberships.some((x) => x.status === 'past_due') || open.some((i) => i.memberId === m.id && i.attemptCount > 0),
      memberships: m.memberships.map((x) => ({ id: x.id, status: x.status, priceCents: x.priceCents, nextBillingDate: x.plan.type === 'recurring' ? x.currentPeriodEnd : null, paymentMethod: x.paymentMethod, plan: x.plan.name, interval: x.plan.billingInterval, intervalCount: x.plan.intervalCount, recurring: x.plan.type === 'recurring' })),
    })),
    totals: {
      amountDueCents: owed(), overdueCents: overdue.reduce((sum, i) => sum + invoiceBalance(i), 0), openInvoices: open.length,
      creditCents: members.reduce((sum, m) => sum + m.creditBalanceCents, 0),
      // What the payer's card is charged each month if nothing changes, as a guide.
      recurringCents: members.flatMap((m) => m.memberships).filter((x) => x.plan.type === 'recurring' && ['active', 'trial', 'past_due'].includes(x.status)).reduce((sum, x) => sum + x.priceCents, 0),
    },
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, refundedCents: i.refundedCents, balanceCents: i.status === 'open' ? invoiceBalance(i) : 0, dueDate: i.dueDate, createdAt: i.createdAt, failedAttempts: i.attemptCount, nextAttemptAt: i.nextAttemptAt, memberId: i.memberId, memberName: name(i.memberId), description: i.items[0]?.description || null })),
    payments: payments.map((t) => ({ id: t.id, type: t.type, status: t.status, amountCents: t.amountCents, refundedCents: t.refundedCents, method: t.method, cardLast4: t.cardLast4, failureReason: t.failureReason, at: t.createdAt, memberId: t.memberId, memberName: name(t.memberId), paidByName: name(t.payerMemberId), invoiceNumber: t.invoice?.number || null })),
  }
}

/** The household a member is in, or null. */
export async function householdOf(ownerId: string, memberId: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId }, select: { householdId: true } })
  if (!member) throw notFound('Member')
  return member.householdId ? getHousehold(ownerId, member.householdId) : null
}
