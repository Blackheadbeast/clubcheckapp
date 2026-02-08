import { prisma } from './prisma'
import type { AuthPayload } from './auth'

export type AuditAction =
  // Authentication
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'password_reset'
  // Members
  | 'member_create'
  | 'member_update'
  | 'member_delete'
  | 'member_checkin'
  | 'member_bulk_action'
  // Staff
  | 'staff_create'
  | 'staff_update'
  | 'staff_delete'
  | 'staff_login'
  // Settings
  | 'settings_update'
  | 'waiver_update'
  | 'theme_change'
  // Billing
  | 'subscription_start'
  | 'subscription_cancel'
  | 'plan_change'
  // Prospects
  | 'prospect_create'
  | 'prospect_update'
  | 'prospect_convert'
  | 'prospect_delete'
  // Other
  | 'export_data'
  | 'broadcast_send'

interface AuditLogInput {
  action: AuditAction
  description: string
  ownerId: string
  actorType: 'owner' | 'staff'
  actorId: string
  actorEmail?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        description: input.description,
        ownerId: input.ownerId,
        actorType: input.actorType,
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    })
  } catch (error) {
    // Log errors but don't throw - audit logging should not break main functionality
    console.error('Failed to create audit log:', error)
  }
}

/**
 * Helper to create an audit log from a request with auth context
 */
export async function logAuditEvent(
  auth: AuthPayload,
  action: AuditAction,
  description: string,
  request?: Request,
  metadata?: Record<string, unknown>
): Promise<void> {
  const ipAddress = request?.headers.get('x-forwarded-for') ||
    request?.headers.get('x-real-ip') ||
    'unknown'
  const userAgent = request?.headers.get('user-agent') || undefined

  // Get actor email from database if not a staff member
  let actorEmail: string | undefined

  if (auth.staffId) {
    const staff = await prisma.staff.findUnique({
      where: { id: auth.staffId },
      select: { email: true },
    })
    actorEmail = staff?.email
  } else {
    const owner = await prisma.owner.findUnique({
      where: { id: auth.ownerId },
      select: { email: true },
    })
    actorEmail = owner?.email
  }

  await createAuditLog({
    action,
    description,
    ownerId: auth.ownerId,
    actorType: auth.staffId ? 'staff' : 'owner',
    actorId: auth.staffId || auth.ownerId,
    actorEmail,
    ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : undefined,
    userAgent,
    metadata,
  })
}

/**
 * Get audit logs for an owner with pagination
 */
export async function getAuditLogs(
  ownerId: string,
  options: {
    page?: number
    limit?: number
    action?: AuditAction
    startDate?: Date
    endDate?: Date
  } = {}
) {
  const { page = 1, limit = 50, action, startDate, endDate } = options

  const where: Record<string, unknown> = { ownerId }

  if (action) {
    where.action = action
  }

  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) {
      (where.createdAt as Record<string, Date>).gte = startDate
    }
    if (endDate) {
      (where.createdAt as Record<string, Date>).lte = endDate
    }
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
}

/**
 * Get human-readable label for audit action
 */
export function getActionLabel(action: AuditAction): string {
  const labels: Record<AuditAction, string> = {
    login: 'Login',
    logout: 'Logout',
    login_failed: 'Failed Login',
    password_reset: 'Password Reset',
    member_create: 'Member Created',
    member_update: 'Member Updated',
    member_delete: 'Member Deleted',
    member_checkin: 'Member Check-in',
    member_bulk_action: 'Bulk Member Action',
    staff_create: 'Staff Created',
    staff_update: 'Staff Updated',
    staff_delete: 'Staff Deleted',
    staff_login: 'Staff Login',
    settings_update: 'Settings Updated',
    waiver_update: 'Waiver Updated',
    theme_change: 'Theme Changed',
    subscription_start: 'Subscription Started',
    subscription_cancel: 'Subscription Cancelled',
    plan_change: 'Plan Changed',
    prospect_create: 'Prospect Created',
    prospect_update: 'Prospect Updated',
    prospect_convert: 'Prospect Converted',
    prospect_delete: 'Prospect Deleted',
    export_data: 'Data Exported',
    broadcast_send: 'Broadcast Sent',
  }
  return labels[action] || action
}

/**
 * Get category for audit action (for filtering/grouping)
 */
export function getActionCategory(action: AuditAction): string {
  if (['login', 'logout', 'login_failed', 'password_reset', 'staff_login'].includes(action)) {
    return 'Authentication'
  }
  if (action.startsWith('member_')) return 'Members'
  if (action.startsWith('staff_')) return 'Staff'
  if (action.startsWith('prospect_')) return 'Prospects'
  if (['settings_update', 'waiver_update', 'theme_change'].includes(action)) return 'Settings'
  if (['subscription_start', 'subscription_cancel', 'plan_change'].includes(action)) return 'Billing'
  return 'Other'
}
