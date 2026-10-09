// One place that turns "this row just changed" into a webhook event with the public shape of the
// row as its payload. Services call these inside their own transaction, at the single point where
// the operation is decided, so each operation produces one event however it was started (the staff
// app, the member app, the public API, or a background job).
//
// The key passed to emitEvent is what makes an event unique. Things that happen once to a row use
// the row's id. Things that can happen again (a membership frozen twice, a booking cancelled and
// rebooked) add the row's updatedAt, which is new for every write.

import type { Db } from './core'
import { emitEvent, type WebhookEventType } from './webhooks'
import { appointmentOut, assignmentOut, bookingOut, invoiceOut, leadOut, memberOut, membershipOut, paymentOut, workoutSessionOut } from '@/lib/public-api/serialize'

type Of<P extends string> = Extract<WebhookEventType, `${P}.${string}`>
const stamp = (id: string, at: Date) => `${id}:${at.getTime()}`
const currencyOf = async (db: Db, ownerId: string) => (await db.gymProfile.findUnique({ where: { ownerId }, select: { currency: true } }))?.currency || 'USD'

export async function memberEvent(db: Db, ownerId: string, type: Of<'member'>, memberId: string) {
  const row = await db.member.findFirst({ where: { id: memberId, ownerId } })
  if (!row) return
  await emitEvent(db, ownerId, type, type === 'member.created' ? row.id : stamp(row.id, row.updatedAt), () => memberOut(row))
}

export async function membershipEvent(db: Db, ownerId: string, type: Of<'membership'>, membershipId: string) {
  const row = await db.membership.findFirst({ where: { id: membershipId, ownerId }, include: { plan: true } })
  if (!row) return
  await emitEvent(db, ownerId, type, type === 'membership.created' ? row.id : stamp(row.id, row.updatedAt), () => membershipOut(row))
}

export async function bookingEvent(db: Db, ownerId: string, type: Of<'booking'>, bookingId: string) {
  const row = await db.booking.findFirst({ where: { id: bookingId, ownerId } })
  if (!row) return
  await emitEvent(db, ownerId, type, stamp(row.id, row.updatedAt), () => bookingOut(row))
}

export async function appointmentEvent(db: Db, ownerId: string, type: Of<'appointment'>, appointmentId: string) {
  const row = await db.appointment.findFirst({ where: { id: appointmentId, ownerId }, include: { type: { select: { name: true } }, staff: { select: { id: true, name: true } } } })
  if (!row) return
  await emitEvent(db, ownerId, type, type === 'appointment.created' ? row.id : stamp(row.id, row.updatedAt), () => appointmentOut(row))
}

/** `occurrence` separates repeats on one payment: each refund of it is its own event. */
export async function paymentEvent(db: Db, ownerId: string, type: Of<'payment'>, transactionId: string, occurrence?: string) {
  const row = await db.transaction.findFirst({ where: { id: transactionId, ownerId } })
  if (!row) return
  await emitEvent(db, ownerId, type, occurrence ? `${row.id}:${occurrence}` : row.id, async () => paymentOut(row, await currencyOf(db, ownerId)))
}

export async function invoiceEvent(db: Db, ownerId: string, type: Of<'invoice'>, invoiceId: string) {
  const row = await db.invoice.findFirst({ where: { id: invoiceId, ownerId }, include: { items: true } })
  if (!row) return
  // An invoice is created once and paid once; collecting it can fail once per attempt.
  await emitEvent(db, ownerId, type, type === 'invoice.failed' ? `${row.id}:${row.attemptCount}` : row.id, async () => invoiceOut(row, await currencyOf(db, ownerId)))
}

export async function workoutCompletedEvent(db: Db, ownerId: string, sessionId: string) {
  const row = await db.workoutSession.findFirst({ where: { id: sessionId, ownerId } })
  if (!row) return
  await emitEvent(db, ownerId, 'workout.completed', row.id, () => workoutSessionOut(row))
}

export async function programEvent(db: Db, ownerId: string, type: Of<'program'>, assignmentId: string) {
  const row = await db.programAssignment.findFirst({ where: { id: assignmentId, ownerId } })
  if (!row) return
  await emitEvent(db, ownerId, type, row.id, () => assignmentOut(row))
}

export async function leadEvent(db: Db, ownerId: string, type: Of<'lead'>, leadId: string) {
  const row = await db.prospect.findFirst({ where: { id: leadId, ownerId } })
  if (!row) return
  await emitEvent(db, ownerId, type, type === 'lead.created' ? row.id : stamp(row.id, row.updatedAt), () => leadOut(row))
}
