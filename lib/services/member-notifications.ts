// The member notification center.
//
// notifyMember() is the single place a member-facing notification is created.
// Today it writes the row the app shows. Push (and any other channel) plugs in
// at deliver(): the row, its category and the screen it points at are already
// what a push payload needs, and MemberDevice holds the registered tokens.

import { prisma } from '@/lib/prisma'
import type { ActivityInput, Db } from './core'

export const CATEGORIES = ['booking', 'waitlist', 'appointment', 'payment', 'membership', 'account', 'message', 'workout', 'document'] as const
export type Category = (typeof CATEGORIES)[number]
export type Screen = 'home' | 'schedule' | 'checkin' | 'membership' | 'profile' | 'workouts' | 'documents'

export interface MemberNotificationInput {
  ownerId: string
  memberId: string
  category: Category
  type: string
  title: string
  body?: string | null
  screen?: Screen
}

/** Hook for future channels. Called after the row exists; must never throw. */
async function deliver(_notification: { id: string; memberId: string; title: string; body: string | null; screen: string | null }) {
  // Push: look up MemberDevice rows for the member and hand them to the provider (APNs/FCM/Web Push).
}

export async function notifyMember(db: Db, input: MemberNotificationInput) {
  const row = await db.memberNotification.create({
    data: { ownerId: input.ownerId, memberId: input.memberId, category: input.category, type: input.type, title: input.title.slice(0, 200), body: input.body?.slice(0, 2000) || null, screen: input.screen || null },
  })
  await deliver(row).catch(() => {})
  return row
}

// Timeline events a member should hear about, and how to say them to the member
// (the timeline itself is written for staff: "Reset their account password").
const EVENTS: Record<string, { category: Category; screen: Screen; title?: (title: string) => string }> = {
  class_booked: { category: 'booking', screen: 'home' },
  class_cancelled: { category: 'booking', screen: 'schedule' },
  class_late_cancelled: { category: 'booking', screen: 'schedule' },
  class_missed: { category: 'booking', screen: 'schedule' },
  waitlist_joined: { category: 'waitlist', screen: 'home' },
  waitlist_left: { category: 'waitlist', screen: 'schedule' },
  waitlist_promoted: { category: 'waitlist', screen: 'home' },
  waitlist_offered: { category: 'waitlist', screen: 'home' },
  waitlist_expired: { category: 'waitlist', screen: 'schedule' },
  appointment_booked: { category: 'appointment', screen: 'schedule' },
  appointment_cancelled: { category: 'appointment', screen: 'schedule' },
  appointment_late_cancelled: { category: 'appointment', screen: 'schedule' },
  appointment_rescheduled: { category: 'appointment', screen: 'schedule' },
  appointment_no_show: { category: 'appointment', screen: 'schedule' },
  payment: { category: 'payment', screen: 'membership' },
  payment_failed: { category: 'payment', screen: 'membership' },
  refund: { category: 'payment', screen: 'membership' },
  credit: { category: 'payment', screen: 'membership' },
  payment_method_added: { category: 'payment', screen: 'membership' },
  payment_method_removed: { category: 'payment', screen: 'membership' },
  membership_purchased: { category: 'membership', screen: 'membership' },
  membership_frozen: { category: 'membership', screen: 'membership' },
  membership_unfrozen: { category: 'membership', screen: 'membership' },
  membership_cancel_scheduled: { category: 'membership', screen: 'membership' },
  membership_resumed: { category: 'membership', screen: 'membership' },
  membership_changed: { category: 'membership', screen: 'membership' },
  membership_cancelled: { category: 'membership', screen: 'membership' },
  membership_expired: { category: 'membership', screen: 'membership' },
  membership_past_due: { category: 'membership', screen: 'membership' },
  trial_converted: { category: 'membership', screen: 'membership' },
  document_assigned: { category: 'document', screen: 'documents' },
  document_reminder: { category: 'document', screen: 'documents' },
  document_signed: { category: 'document', screen: 'documents' },
  document_expired: { category: 'document', screen: 'documents' },
  document_voided: { category: 'document', screen: 'documents' },
  program_assigned: { category: 'workout', screen: 'workouts' },
  workout_assigned: { category: 'workout', screen: 'workouts' },
  program_completed: { category: 'workout', screen: 'workouts' },
  program_paused: { category: 'workout', screen: 'workouts' },
  program_resumed: { category: 'workout', screen: 'workouts' },
  coach_feedback: { category: 'workout', screen: 'workouts' },
  personal_record: { category: 'workout', screen: 'workouts' },
  account_activated: { category: 'account', screen: 'profile', title: () => 'Your account is set up' },
  password_changed: { category: 'account', screen: 'profile', title: () => 'Your password was changed' },
  password_reset: { category: 'account', screen: 'profile', title: () => 'Your password was reset' },
  email_verified: { category: 'account', screen: 'profile', title: (t) => (t.startsWith('Changed') ? 'Your email address was changed' : 'Your email address was confirmed') },
}

/** Called by logActivity for every timeline entry that belongs to a member. */
export async function notifyMemberOfActivity(db: Db, activity: ActivityInput) {
  const event = EVENTS[activity.type]
  if (!event || !activity.memberId) return
  await notifyMember(db, {
    ownerId: activity.ownerId,
    memberId: activity.memberId,
    category: event.category,
    type: activity.type,
    title: event.title ? event.title(activity.title) : activity.title,
    body: activity.detail || null,
    screen: event.screen,
  })
}

export async function listNotifications(memberId: string, options: { take?: number; before?: Date | null; category?: string | null } = {}) {
  const take = Math.min(50, Math.max(1, options.take || 20))
  const [items, unread] = await Promise.all([
    prisma.memberNotification.findMany({
      where: { memberId, ...(options.before && { createdAt: { lt: options.before } }), ...(options.category && { category: options.category }) },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      select: { id: true, category: true, type: true, title: true, body: true, screen: true, readAt: true, createdAt: true },
    }),
    prisma.memberNotification.count({ where: { memberId, readAt: null } }),
  ])
  const page = items.slice(0, take)
  return { items: page.map((n) => ({ ...n, read: !!n.readAt })), unread, nextBefore: items.length > take ? page[page.length - 1].createdAt : null }
}

/** Mark some (or all) of one member's notifications read. Ids belonging to anyone else are ignored. */
export async function markRead(memberId: string, ids?: string[]) {
  const result = await prisma.memberNotification.updateMany({ where: { memberId, readAt: null, ...(ids && { id: { in: ids } }) }, data: { readAt: new Date() } })
  return { updated: result.count, unread: await prisma.memberNotification.count({ where: { memberId, readAt: null } }) }
}
