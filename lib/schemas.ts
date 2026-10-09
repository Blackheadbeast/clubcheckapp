// Zod schemas shared between API routes (route files may only export handlers).

import { z } from 'zod'
import { isValidTimeZone } from '@/lib/dates'

/** Trimmed optional text: empty strings become null so "cleared" fields are stored consistently. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v))

export const cents = z.number().int().min(0).max(100_000_000)

export const locationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  address: optionalText(200),
  city: optionalText(100),
  state: optionalText(50),
  postalCode: optionalText(20),
  phone: optionalText(30),
  timezone: z.string().refine((tz) => isValidTimeZone(tz), 'Unknown timezone').nullish(),
})

/** A calendar date (YYYY-MM-DD) or full ISO timestamp, as a Date. */
export const dateInput = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
  .transform((v) => new Date(v))

export const planSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: optionalText(500),
  type: z.enum(['recurring', 'class_pack', 'drop_in', 'trial', 'free', 'pt_package']),
  priceCents: cents,
  billingInterval: z.enum(['week', 'month', 'year', 'once']).default('month'),
  intervalCount: z.number().int().min(1).max(24).default(1),
  trialDays: z.number().int().min(0).max(365).default(0),
  contractMonths: z.number().int().min(0).max(60).default(0),
  enrollmentFeeCents: cents.default(0),
  classLimit: z.number().int().min(1).max(1000).nullish(),
  classLimitPeriod: z.enum(['week', 'month']).default('month'),
  credits: z.number().int().min(1).max(1000).nullish(),
  expiresAfterDays: z.number().int().min(1).max(3650).nullish(),
  freezeAllowed: z.boolean().default(true),
  maxFreezeDays: z.number().int().min(1).max(365).default(90),
  cancellationNoticeDays: z.number().int().min(0).max(180).default(0),
  autoRenew: z.boolean().default(true),
  taxRateBps: z.number().int().min(0).max(3000).default(0),
  locationIds: z.array(z.string().uuid()).max(50).default([]),
  classTypeIds: z.array(z.string().uuid()).max(100).default([]),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
})

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #f59e0b')

export const classTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: optionalText(1000),
  category: z.enum(['class', 'workshop', 'event', 'personal_training', 'open_gym']).default('class'),
  color: hexColor.default('#f59e0b'),
  defaultDurationMin: z.number().int().min(5).max(720).default(60),
  defaultCapacity: z.number().int().min(1).max(1000).default(20),
  isActive: z.boolean().default(true),
})

const sessionBase = {
  classTypeId: z.string().uuid(),
  locationId: z.string().uuid().nullish(),
  coachId: z.string().uuid().nullish(),
  room: optionalText(60),
  capacity: z.number().int().min(1).max(1000),
  waitlistCapacity: z.number().int().min(0).max(200).default(10),
}

export const sessionSchema = z.object({
  ...sessionBase,
  title: optionalText(100),
  notes: optionalText(1000),
  /** Gym-local date and time */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time'),
  durationMin: z.number().int().min(5).max(720),
  allowedPlanIds: z.array(z.string().uuid()).max(50).default([]),
})

export const scheduleSchema = z.object({
  ...sessionBase,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time'),
  durationMin: z.number().int().min(5).max(720),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('').transform(() => null)),
  isActive: z.boolean().default(true),
})

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  sku: optionalText(40),
  category: z.enum(['apparel', 'supplements', 'drinks', 'equipment', 'merchandise', 'other']).default('other'),
  priceCents: cents,
  costCents: cents.default(0),
  taxRateBps: z.number().int().min(0).max(3000).default(0),
  trackInventory: z.boolean().default(true),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  isActive: z.boolean().default(true),
})

export const staffSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
  role: z.enum(['admin', 'manager', 'front_desk', 'coach', 'trainer', 'sales', 'accountant']),
  phone: optionalText(30),
  title: optionalText(80),
  bio: optionalText(1000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  isCoach: z.boolean().default(false),
  locationId: z.string().uuid().nullish(),
  active: z.boolean().optional(),
})

export const businessSettingsSchema = z.object({
  timezone: z.string().refine((tz) => isValidTimeZone(tz), 'Unknown timezone'),
  currency: z.enum(['usd', 'cad', 'gbp', 'eur', 'aud', 'nzd']),
  defaultTaxRateBps: z.number().int().min(0).max(3000),
  bookingWindowDays: z.number().int().min(1).max(365),
  bookingCutoffMinutes: z.number().int().min(0).max(1440),
  cancelWindowHours: z.number().int().min(0).max(168),
  waitlistOfferMinutes: z.number().int().min(0).max(1440),
  lateCancelUsesCredit: z.boolean(),
  pastDueGraceDays: z.number().int().min(0).max(60),
  pastDueCancelDays: z.number().int().min(0).max(180).default(0),
  memberSelfCheckin: z.boolean().optional(),
  memberSelfFreeze: z.boolean().optional(),
  memberSelfCancel: z.boolean().optional(),
  memberSelfChangePlan: z.boolean().optional(),
})
