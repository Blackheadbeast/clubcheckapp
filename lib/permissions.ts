// Role-based access control. This is the single source of truth for what each
// staff role may do; lib/api.ts enforces it on every API route, and the UI
// only uses it to hide things the server would reject anyway.

export const PERMISSIONS = {
  'members.view': 'View members and their profiles',
  'members.manage': 'Create and edit members, tags and notes',
  'members.delete': 'Archive, delete, import and export members',
  'memberships.manage': 'Sell, freeze, cancel and change memberships',
  'billing.view': 'View transactions, invoices and balances',
  'billing.manage': 'Take payments, create invoices and coupons',
  'billing.refund': 'Issue refunds and account credits',
  'classes.view': 'View the schedule and rosters',
  'classes.manage': 'Create, edit and cancel classes',
  'bookings.manage': 'Book, cancel and waitlist members',
  'attendance.manage': 'Check members in and mark attendance',
  'leads.view': 'View leads and the sales pipeline',
  'leads.manage': 'Create, edit and convert leads',
  'pos.sell': 'Ring up product sales',
  'pos.manage': 'Manage products and inventory',
  'reports.view': 'View member, attendance and sales reports',
  'reports.financial': 'View financial reports and revenue',
  'communication.send': 'Send messages and campaigns',
  'automations.manage': 'Manage automations and templates',
  'staff.manage': 'Manage staff accounts and roles',
  'locations.manage': 'Manage locations',
  'settings.manage': 'Change business settings',
  'audit.view': 'View the audit log',
} as const

export type Permission = keyof typeof PERMISSIONS

export const ROLE_KEYS = [
  'owner',
  'admin',
  'manager',
  'front_desk',
  'coach',
  'trainer',
  'sales',
  'accountant',
] as const

export type Role = (typeof ROLE_KEYS)[number]

/** Roles that can be assigned to a staff account ("owner" is the account holder). */
export const ASSIGNABLE_ROLES = ROLE_KEYS.filter((r) => r !== 'owner') as Exclude<Role, 'owner'>[]

const ALL = Object.keys(PERMISSIONS) as Permission[]

const COACH: Permission[] = [
  'members.view',
  'classes.view',
  'bookings.manage',
  'attendance.manage',
]

export const ROLES: Record<Role, { label: string; description: string; permissions: Permission[] }> = {
  owner: {
    label: 'Owner',
    description: 'Full access, including the ClubCheck subscription.',
    permissions: ALL,
  },
  admin: {
    label: 'Admin',
    description: 'Full access to the business, including staff and settings.',
    permissions: ALL,
  },
  manager: {
    label: 'Manager',
    description: 'Runs day-to-day operations. No staff, location or settings management.',
    permissions: ALL.filter(
      (p) => !['staff.manage', 'locations.manage', 'settings.manage', 'audit.view'].includes(p)
    ),
  },
  front_desk: {
    label: 'Front Desk',
    description: 'Check-ins, bookings, payments at the desk and product sales.',
    permissions: [
      'members.view',
      'members.manage',
      'classes.view',
      'bookings.manage',
      'attendance.manage',
      'leads.view',
      'leads.manage',
      'pos.sell',
      'billing.view',
      'billing.manage',
    ],
  },
  coach: {
    label: 'Coach',
    description: 'Sees the schedule and rosters, and takes attendance.',
    permissions: COACH,
  },
  trainer: {
    label: 'Trainer',
    description: 'Like a coach, and can also schedule their own sessions.',
    permissions: [...COACH, 'classes.manage'],
  },
  sales: {
    label: 'Sales',
    description: 'Works leads, sells memberships and sends messages.',
    permissions: [
      'members.view',
      'members.manage',
      'memberships.manage',
      'leads.view',
      'leads.manage',
      'classes.view',
      'bookings.manage',
      'communication.send',
      'billing.view',
      'billing.manage',
      'reports.view',
    ],
  },
  accountant: {
    label: 'Accountant',
    description: 'Read access to members plus full billing and financial reporting.',
    permissions: [
      'members.view',
      'billing.view',
      'billing.manage',
      'billing.refund',
      'reports.view',
      'reports.financial',
    ],
  },
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value)
}

/** Unknown or missing roles get no permissions. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!isRole(role)) return false
  return ROLES[role].permissions.includes(permission)
}

export function permissionsFor(role: string | null | undefined): Permission[] {
  return isRole(role) ? ROLES[role].permissions : []
}
