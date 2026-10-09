// Shared request shapes and checks for the appointment routes.

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, assertAllOwned, type Actor } from '@/lib/api'
import { cents, optionalText } from '@/lib/schemas'
import { GRID_MIN, PAYMENT_MODES } from '@/lib/services/appointments'

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #8b5cf6')

const idList = (max: number) => z.array(z.string().uuid()).max(max)

// No defaults in here: an update must only change what it was sent.
const typeFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: optionalText(1000),
  color: hexColor,
  durationMin: z.number().int().min(10).max(480).refine((n) => n % GRID_MIN === 0, 'Duration must be in 5-minute steps'),
  paymentMode: z.enum(PAYMENT_MODES),
  priceCents: cents,
  taxRateBps: z.number().int().min(0).max(3000),
  creditsRequired: z.number().int().min(1).max(20),
  requiredPlanIds: idList(50),
  locationIds: idList(50),
  cancelWindowHours: z.number().int().min(0).max(336),
  minNoticeMinutes: z.number().int().min(0).max(20160),
  maxAdvanceDays: z.number().int().min(1).max(365),
  slotIntervalMin: z.number().int().refine((n) => [5, 10, 15, 20, 30, 60].includes(n), 'Choose 5, 10, 15, 20, 30 or 60 minutes'),
  memberBookable: z.boolean(),
  memberReschedule: z.boolean(),
  isActive: z.boolean(),
  staffIds: idList(200),
})

const TYPE_DEFAULTS = {
  color: '#8b5cf6', paymentMode: 'credit' as const, priceCents: 0, taxRateBps: 0, creditsRequired: 1, requiredPlanIds: [] as string[], locationIds: [] as string[],
  cancelWindowHours: 12, minNoticeMinutes: 120, maxAdvanceDays: 30, slotIntervalMin: 30, memberBookable: true, memberReschedule: true, isActive: true, staffIds: [] as string[],
}
const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T

/** Creating a type: only the name and length are required; the rest starts from sensible defaults. */
export const typeSchema = typeFields.partial().required({ name: true, durationMin: true }).transform((v) => ({ ...TYPE_DEFAULTS, ...defined(v) }))
/** Updating a type: every field optional, and absent fields are left exactly as they are. */
export const typeUpdateSchema = typeFields.partial().transform(defined)
export type TypeInput = z.infer<typeof typeSchema>

/** Every id in an appointment type must belong to the caller's gym. */
export async function assertTypeRefs(ownerId: string, input: Partial<TypeInput>) {
  await assertAllOwned(ownerId, 'membershipPlan', input.requiredPlanIds, 'Membership plan')
  await assertAllOwned(ownerId, 'location', input.locationIds, 'Location')
  await assertAllOwned(ownerId, 'staff', input.staffIds, 'Staff member')
  if (input.paymentMode === 'paid' && !input.priceCents) throw new ApiError(400, 'Set a price for a paid appointment, or choose "Included".', 'validation_error')
}

export const typeInclude = { staff: { select: { staff: { select: { id: true, name: true, active: true } } } }, _count: { select: { appointments: true } } } as const

export function publicType(t: { staff: { staff: { id: string; name: string; active: boolean } }[]; _count: { appointments: number } } & Record<string, unknown>) {
  const { staff, _count, ...rest } = t
  return { ...rest, staff: staff.map((s) => s.staff).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })), appointmentCount: _count.appointments }
}

/**
 * Coaches and trainers manage their own diary only. Returns the staff id they
 * are limited to, or null for roles that see everyone's.
 */
export function ownDiaryOnly(actor: Actor): string | null {
  return actor.type === 'staff' && (actor.role === 'coach' || actor.role === 'trainer') ? actor.id : null
}

export async function assertOwnAppointment(ownerId: string, actor: Actor, appointmentId: string) {
  const limit = ownDiaryOnly(actor)
  if (!limit) return
  const mine = await prisma.appointment.findFirst({ where: { id: appointmentId, ownerId, staffId: limit }, select: { id: true } })
  if (!mine) throw new ApiError(404, 'Appointment not found', 'not_found')
}

const minute = z.number().int().min(0).max(1440).refine((n) => n % GRID_MIN === 0, 'Times must be in 5-minute steps')
const span = z.object({ weekday: z.number().int().min(0).max(6), startMinute: minute, endMinute: minute }).refine((s) => s.endMinute > s.startMinute, 'End time must be after start time')
export const availabilitySchema = z.object({
  hours: z.array(span.and(z.object({ locationId: z.string().uuid().nullish() }))).max(42),
  breaks: z.array(span).max(42).default([]),
})
