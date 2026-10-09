// The public shape of each resource. These are the contract: a field is added here on purpose, and
// what is left out is left out on purpose (medical notes, check-in codes, portal tokens, signatures,
// staff-only notes, internal bookkeeping). Webhook payloads use the same shapes as the API.

import type { Appointment, Booking, Checkin, ClassSession, Invoice, InvoiceItem, Member, Membership, MembershipPlan, Program, ProgramAssignment, Prospect, Transaction, Workout, WorkoutSession, WorkoutVersion } from '@prisma/client'
import type { WorkoutContent } from '@/lib/workouts/content'
import { memberStatusValues, normalizeLeadStage, normalizeMemberStatus } from '@/lib/format'

export { memberStatusValues }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

export const memberOut = (m: Member) => ({
  id: m.id, object: 'member' as const,
  name: m.name, email: m.email, phone: m.phone, status: normalizeMemberStatus(m.status),
  dateOfBirth: day(m.dateOfBirth),
  address: { line1: m.addressLine1, city: m.city, state: m.state, postalCode: m.postalCode },
  leadSource: m.leadSource, emailOptIn: m.emailOptIn, smsOptIn: m.smsOptIn && !m.smsStopped,
  homeLocationId: m.homeLocationId, householdId: m.householdId,
  creditBalanceCents: m.creditBalanceCents,
  lastCheckInAt: iso(m.lastCheckInAt), archivedAt: iso(m.archivedAt), createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt),
})

export const planOut = (p: MembershipPlan) => ({
  id: p.id, object: 'membership_plan' as const, name: p.name, description: p.description, type: p.type,
  priceCents: p.priceCents, billingInterval: p.billingInterval, intervalCount: p.intervalCount, trialDays: p.trialDays, credits: p.credits, isActive: p.isActive, isPublic: p.isPublic,
})

export const membershipOut = (m: Membership & { plan?: MembershipPlan | null }) => ({
  id: m.id, object: 'membership' as const, memberId: m.memberId, planId: m.planId, planName: m.plan?.name ?? null,
  status: m.status, priceCents: m.priceCents, discountPercent: m.discountPercent, autoRenew: m.autoRenew, creditsRemaining: m.creditsRemaining,
  startDate: iso(m.startDate), endDate: iso(m.endDate), currentPeriodStart: iso(m.currentPeriodStart), currentPeriodEnd: iso(m.currentPeriodEnd), trialEndsAt: iso(m.trialEndsAt),
  frozenAt: iso(m.frozenAt), freezeEndsAt: iso(m.freezeEndsAt), cancelAt: iso(m.cancelAt), cancelledAt: iso(m.cancelledAt), cancelReason: m.cancelReason,
  pendingPlanId: m.pendingPlanId, createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt),
})

type SessionRow = ClassSession & { classType?: { name: string; category: string } | null; coach?: { id: string; name: string } | null; location?: { id: string; name: string } | null }
export const classOut = (s: SessionRow, counts?: { booked: number; waitlisted: number }) => ({
  id: s.id, object: 'class' as const, name: s.title || s.classType?.name || null, classTypeId: s.classTypeId, category: s.classType?.category ?? null,
  startsAt: iso(s.startsAt), endsAt: iso(s.endsAt), status: s.status, cancelReason: s.cancelReason,
  capacity: s.capacity, waitlistCapacity: s.waitlistCapacity,
  ...(counts && { bookedCount: counts.booked, waitlistCount: counts.waitlisted, spotsLeft: Math.max(0, s.capacity - counts.booked) }),
  coach: s.coach ? { id: s.coach.id, name: s.coach.name } : null,
  locationId: s.locationId, locationName: s.location?.name ?? null, room: s.room, workoutId: s.workoutId, recurring: !!s.scheduleId,
  createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
})

export const bookingOut = (b: Booking) => ({
  id: b.id, object: 'booking' as const, classId: b.sessionId, memberId: b.memberId, membershipId: b.membershipId,
  status: b.status, source: b.source, creditUsed: b.creditUsed,
  waitlistedAt: iso(b.waitlistedAt), offerExpiresAt: iso(b.offerExpiresAt), checkedInAt: iso(b.checkedInAt), cancelledAt: iso(b.cancelledAt), createdAt: iso(b.createdAt), updatedAt: iso(b.updatedAt),
})

type AppointmentRow = Appointment & { type?: { name: string } | null; staff?: { id: string; name: string } | null }
export const appointmentOut = (a: AppointmentRow) => ({
  id: a.id, object: 'appointment' as const, typeId: a.typeId, typeName: a.type?.name ?? null, memberId: a.memberId,
  staff: a.staff ? { id: a.staff.id, name: a.staff.name } : { id: a.staffId, name: null },
  locationId: a.locationId, startsAt: iso(a.startsAt), endsAt: iso(a.endsAt), status: a.status,
  paymentMode: a.paymentMode, priceCents: a.priceCents, invoiceId: a.invoiceId, source: a.source, notes: a.notes,
  cancelledAt: iso(a.cancelledAt), cancelReason: a.cancelReason, completedAt: iso(a.completedAt),
  rescheduleCount: a.rescheduleCount, previousStartsAt: iso(a.previousStartsAt), workoutId: a.workoutId,
  createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
})

export const attendanceOut = (c: Checkin) => ({
  id: c.id, object: 'attendance' as const, memberId: c.memberId, checkedInAt: iso(c.timestamp), type: c.type, source: c.source, classId: c.sessionId, locationId: c.locationId,
})

export const paymentOut = (t: Transaction, currency: string) => ({
  id: t.id, object: 'payment' as const, type: t.type, status: t.status, amountCents: t.amountCents, refundedCents: t.refundedCents, currency,
  memberId: t.memberId, payerMemberId: t.payerMemberId, invoiceId: t.invoiceId, locationId: t.locationId,
  method: t.method, cardLast4: t.cardLast4, processor: t.provider, processorReference: t.providerReference,
  failureReason: t.failureReason, refundReason: t.refundReason, refundOfPaymentId: t.parentTransactionId, disputeStatus: t.disputeStatus,
  createdAt: iso(t.createdAt),
})

export const invoiceOut = (i: Invoice & { items?: InvoiceItem[] }, currency: string) => ({
  id: i.id, object: 'invoice' as const, number: i.number, status: i.status, memberId: i.memberId, membershipId: i.membershipId, currency,
  subtotalCents: i.subtotalCents, discountCents: i.discountCents, taxCents: i.taxCents, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, refundedCents: i.refundedCents,
  balanceCents: Math.max(0, i.totalCents - i.amountPaidCents),
  dueDate: iso(i.dueDate), paidAt: iso(i.paidAt), periodStart: iso(i.periodStart), periodEnd: iso(i.periodEnd),
  ...(i.items && { items: i.items.map((x) => ({ description: x.description, type: x.type, quantity: x.quantity, unitPriceCents: x.unitPriceCents, amountCents: x.amountCents, planId: x.planId, productId: x.productId })) }),
  createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt),
})

export const leadOut = (p: Prospect) => ({
  id: p.id, object: 'lead' as const, name: p.name, email: p.email, phone: p.phone, status: normalizeLeadStage(p.status), source: p.source, interest: p.interest, notes: p.notes,
  estimatedValueCents: p.estimatedValueCents, assignedStaffId: p.assignedStaffId, locationId: p.locationId,
  trialDate: iso(p.trialDate), nextFollowUpAt: iso(p.nextFollowUpAt), contactedAt: iso(p.contactedAt), convertedAt: iso(p.convertedAt), convertedMemberId: p.convertedMemberId, lostReason: p.lostReason,
  smsOptIn: p.smsOptIn && !p.smsStopped, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt),
})

/** A workout as prescribed. `blocks` is included on a single workout, not in lists. */
export const workoutOut = (w: Workout, v: WorkoutVersion | null, full = false) => ({
  id: w.id, object: 'workout' as const, name: v?.name ?? null, description: v?.description ?? null, type: v?.type ?? null, difficulty: v?.difficulty ?? null,
  estimatedMinutes: v?.estimatedMinutes ?? null, equipment: v?.equipment ?? [], version: v?.version ?? null, archived: !!w.archivedAt,
  ...(full && v && { instructions: v.instructions, blocks: (v.content as unknown as WorkoutContent).blocks }),
  createdAt: iso(w.createdAt), updatedAt: iso(w.updatedAt),
})

export const programOut = (p: Program & { days?: { week: number; day: number; workoutId: string }[] }) => ({
  id: p.id, object: 'program' as const, name: p.name, description: p.description, goals: p.goals, audience: p.audience, difficulty: p.difficulty, weeks: p.weeks, archived: !!p.archivedAt,
  ...(p.days && { days: p.days.map((d) => ({ week: d.week, day: d.day, workoutId: d.workoutId })) }),
  createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt),
})

export const assignmentOut = (a: ProgramAssignment) => ({
  id: a.id, object: 'program_assignment' as const, programId: a.programId, memberId: a.memberId, status: a.status, coachId: a.coachId,
  startDate: day(a.startDate), endDate: day(a.endDate), pausedAt: iso(a.pausedAt), createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
})

/** A member's session of a workout: what they were given and how it went. Coach-only notes are not included. */
export const workoutSessionOut = (s: WorkoutSession) => ({
  id: s.id, object: 'workout_session' as const, memberId: s.memberId, workoutId: s.workoutId, workoutVersionId: s.workoutVersionId,
  programAssignmentId: s.assignmentId, classId: s.classSessionId, appointmentId: s.appointmentId, programName: s.programName,
  status: s.status, scheduledDate: day(s.scheduledDate), startedAt: iso(s.startedAt), completedAt: iso(s.completedAt), durationSec: s.durationSec,
  result: (s.result as { timeSec?: number; rounds?: number; reps?: number } | null) ?? null,
  createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
})
