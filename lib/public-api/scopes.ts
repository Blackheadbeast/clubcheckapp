// What an API key may do. A scope is a resource and "read" or "write"; a key holds only the ones
// chosen when it was made. Each scope also names the staff permission it stands for, so nobody can
// mint a key that does more than they are allowed to do themselves.

import type { Permission } from '@/lib/permissions'

export const SCOPES = {
  'members:read': { label: 'Read members', permission: 'members.view' },
  'members:write': { label: 'Create, update and archive members', permission: 'members.manage' },
  'memberships:read': { label: 'Read memberships and plans', permission: 'members.view' },
  'memberships:write': { label: 'Sell, freeze, cancel and change memberships', permission: 'memberships.manage' },
  'classes:read': { label: 'Read the class schedule', permission: 'classes.view' },
  'bookings:read': { label: 'Read class bookings', permission: 'classes.view' },
  'bookings:write': { label: 'Book and cancel classes', permission: 'bookings.manage' },
  'appointments:read': { label: 'Read appointments and free times', permission: 'appointments.view' },
  'appointments:write': { label: 'Book, move and cancel appointments', permission: 'appointments.manage' },
  'attendance:read': { label: 'Read check-ins', permission: 'members.view' },
  'payments:read': { label: 'Read payments and refunds', permission: 'billing.view' },
  'invoices:read': { label: 'Read invoices', permission: 'billing.view' },
  'workouts:read': { label: 'Read workouts, exercises and completed sessions', permission: 'workouts.view' },
  'workouts:write': { label: 'Assign workouts', permission: 'workouts.manage' },
  'programs:read': { label: 'Read programs and who is on them', permission: 'workouts.view' },
  'programs:write': { label: 'Assign programs', permission: 'workouts.manage' },
  'leads:read': { label: 'Read leads', permission: 'leads.view' },
  'leads:write': { label: 'Create and update leads', permission: 'leads.manage' },
} as const satisfies Record<string, { label: string; permission: Permission }>

export type Scope = keyof typeof SCOPES
export const SCOPE_KEYS = Object.keys(SCOPES) as Scope[]
export const isScope = (value: string): value is Scope => value in SCOPES

/** Requests a minute. One key cannot use the whole gym's allowance. */
export const DEFAULT_KEY_LIMIT = 120
export const GYM_LIMIT = 600
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 50
