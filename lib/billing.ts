// lib/billing.ts
// Unified billing status and permission checks

import { prisma } from '@/lib/prisma'
import { PLAN_LIMITS } from '@/lib/stripe'

export type BillingStatus =
  | 'unverified'    // Email not yet verified - no access
  | 'trialing'      // In 14-day trial period
  | 'active'        // Paid subscription active
  | 'past_due'      // Payment failed, in 7-day grace period
  | 'grace_expired' // Past 7-day grace period - read-only
  | 'canceled'      // Subscription canceled - read-only until period end
  | 'expired'       // Trial or subscription fully expired - no access

const GRACE_PERIOD_DAYS = 7
const TRIAL_DAYS = 14

interface OwnerBillingData {
  id: string
  emailVerified: Date | null
  subscriptionStatus: string | null
  currentPeriodEnd: Date | null
  trialEndsAt: Date | null
  planType: string
}

export interface BillingState {
  status: BillingStatus
  canWrite: boolean
  canRead: boolean
  message: string | null
  daysRemaining: number | null
  planType: string
  memberLimit: number
}

export function getBillingState(owner: OwnerBillingData): BillingState {
  const now = new Date()
  const planType = owner.planType || 'starter'
  const memberLimit = planType === 'pro' ? PLAN_LIMITS.pro : PLAN_LIMITS.starter

  // Case 0: Email not verified - block all access
  if (!owner.emailVerified) {
    return {
      status: 'unverified',
      canWrite: false,
      canRead: false,
      message: 'Please verify your email to access ClubCheck.',
      daysRemaining: null,
      planType,
      memberLimit,
    }
  }

  // Case 1: Active paid subscription (includes Stripe trialing — subscription set up, billing deferred)
  if (owner.subscriptionStatus === 'active' || owner.subscriptionStatus === 'trialing') {
    const daysRemaining = owner.currentPeriodEnd
      ? Math.ceil((owner.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null
    return {
      status: 'active',
      canWrite: true,
      canRead: true,
      message: null,
      daysRemaining,
      planType,
      memberLimit,
    }
  }

  // Case 2: Trialing (no subscription yet, within trial period)
  if (!owner.subscriptionStatus && owner.trialEndsAt) {
    const trialEnd = new Date(owner.trialEndsAt)
    if (now < trialEnd) {
      const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      return {
        status: 'trialing',
        canWrite: true,
        canRead: true,
        message: daysRemaining <= 3 ? `Trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}` : null,
        daysRemaining,
        planType,
        memberLimit,
      }
    } else {
      // Trial expired and no subscription
      return {
        status: 'expired',
        canWrite: false,
        canRead: true,
        message: 'Your trial has expired. Subscribe to continue using ClubCheck.',
        daysRemaining: 0,
        planType,
        memberLimit,
      }
    }
  }

  // Case 3: Past due (payment failed)
  if (owner.subscriptionStatus === 'past_due') {
    // Calculate grace period based on currentPeriodEnd
    // Grace period = 7 days after payment was due
    if (owner.currentPeriodEnd) {
      const gracePeriodEnd = new Date(owner.currentPeriodEnd)
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS)

      if (now < gracePeriodEnd) {
        const daysRemaining = Math.ceil((gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return {
          status: 'past_due',
          canWrite: true,
          canRead: true,
          message: `Payment failed. Update your payment method within ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
          daysRemaining,
          planType,
          memberLimit,
        }
      } else {
        // Grace period expired
        return {
          status: 'grace_expired',
          canWrite: false,
          canRead: true,
          message: 'Your account is suspended. Update your payment method to restore access.',
          daysRemaining: 0,
          planType,
          memberLimit,
        }
      }
    }
    // No currentPeriodEnd (shouldn't happen) - treat as grace expired
    return {
      status: 'grace_expired',
      canWrite: false,
      canRead: true,
      message: 'Your account is suspended. Update your payment method to restore access.',
      daysRemaining: 0,
      planType,
      memberLimit,
    }
  }

  // Case 4: Canceled subscription
  if (owner.subscriptionStatus === 'canceled') {
    // Allow read access until period end
    if (owner.currentPeriodEnd && now < owner.currentPeriodEnd) {
      const daysRemaining = Math.ceil((owner.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      return {
        status: 'canceled',
        canWrite: false,
        canRead: true,
        message: `Subscription canceled. Read-only access for ${daysRemaining} more day${daysRemaining === 1 ? '' : 's'}.`,
        daysRemaining,
        planType,
        memberLimit,
      }
    }
    // Period ended
    return {
      status: 'expired',
      canWrite: false,
      canRead: true,
      message: 'Your subscription has ended. Resubscribe to continue using ClubCheck.',
      daysRemaining: 0,
      planType,
      memberLimit,
    }
  }

  // Case 5: No subscription and no trial (legacy account or new signup without trial set)
  // Treat as expired - they need to subscribe
  if (!owner.subscriptionStatus && !owner.trialEndsAt) {
    // Check if account is very new (created in last 14 days) - give them trial benefit
    // This handles accounts created before trial tracking was added
    return {
      status: 'expired',
      canWrite: false,
      canRead: true,
      message: 'Please subscribe to use ClubCheck.',
      daysRemaining: 0,
      planType,
      memberLimit,
    }
  }

  // Default fallback
  return {
    status: 'expired',
    canWrite: false,
    canRead: true,
    message: 'Please subscribe to continue.',
    daysRemaining: 0,
    planType,
    memberLimit,
  }
}

export async function getOwnerBillingState(ownerId: string): Promise<BillingState | null> {
  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      emailVerified: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      planType: true,
    },
  })

  if (!owner) return null
  return getBillingState(owner)
}

export async function requireWriteAccess(ownerId: string): Promise<{ allowed: true } | { allowed: false; error: string; status: number }> {
  const billingState = await getOwnerBillingState(ownerId)

  if (!billingState) {
    return { allowed: false, error: 'Owner not found', status: 404 }
  }

  if (!billingState.canWrite) {
    return {
      allowed: false,
      error: billingState.message || 'Write access not allowed. Please check your subscription status.',
      status: 403
    }
  }

  return { allowed: true }
}

export async function checkMemberLimit(ownerId: string): Promise<{ allowed: true } | { allowed: false; error: string; currentCount: number; limit: number }> {
  const billingState = await getOwnerBillingState(ownerId)

  if (!billingState) {
    return { allowed: false, error: 'Owner not found', currentCount: 0, limit: 0 }
  }

  const activeMembers = await prisma.member.count({
    where: { ownerId, status: 'active' },
  })

  if (activeMembers >= billingState.memberLimit) {
    return {
      allowed: false,
      error: `Member limit reached (${activeMembers}/${billingState.memberLimit}). Upgrade your plan to add more members.`,
      currentCount: activeMembers,
      limit: billingState.memberLimit,
    }
  }

  return { allowed: true }
}

export function getTrialEndDate(): Date {
  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS)
  return trialEnd
}
