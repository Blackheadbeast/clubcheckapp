// lib/rate-limit.ts
// Rate limiter optimized for Vercel serverless
//
// SCALING NOTE: This in-memory rate limiter works per-instance.
// For 100+ concurrent users, consider upgrading to:
// - Upstash Redis (recommended for Vercel): https://upstash.com
// - Vercel KV: https://vercel.com/docs/storage/vercel-kv
//
// Current approach is sufficient for:
// - 100+ signups (not concurrent)
// - Typical gym usage patterns (staff + members spread throughout day)
// - Protection against single-source abuse

interface RateLimitEntry {
  count: number
  resetAt: number
  firstRequest: number // For sliding window calculation
}

// In-memory store with LRU-style cleanup
const rateLimitStore = new Map<string, RateLimitEntry>()
const MAX_ENTRIES = 10000 // Prevent memory bloat

// Clean up old entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    let deleted = 0
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key)
        deleted++
      }
      // Stop if we've cleaned enough
      if (deleted >= 1000) break
    }

    // If still too many entries, remove oldest
    if (rateLimitStore.size > MAX_ENTRIES) {
      const entriesToRemove = rateLimitStore.size - MAX_ENTRIES
      const keys = Array.from(rateLimitStore.keys()).slice(0, entriesToRemove)
      keys.forEach(key => rateLimitStore.delete(key))
    }
  }, 30000) // Clean up every 30 seconds
}

interface RateLimitConfig {
  windowMs: number    // Time window in milliseconds
  maxRequests: number // Max requests per window
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now()
  const key = identifier

  let entry = rateLimitStore.get(key)

  // If no entry or window expired, create new entry
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 1,
      resetAt: now + config.windowMs,
      firstRequest: now,
    }
    rateLimitStore.set(key, entry)
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: entry.resetAt,
    }
  }

  // Increment count
  entry.count++

  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    }
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  }
}

// Stricter rate limit for authentication - uses both IP and fingerprint
export function checkAuthRateLimit(
  request: Request,
  endpoint: string,
  config: RateLimitConfig
): RateLimitResult {
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  // Create a fingerprint from IP + partial user agent
  const fingerprint = `${ip}:${userAgent.slice(0, 50)}`
  const identifier = `${endpoint}:${fingerprint}`

  return checkRateLimit(identifier, config)
}

// Predefined rate limit configs
export const AUTH_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,          // 10 attempts per 15 min
}

export const SIGNUP_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5,           // 5 signups per hour per IP
}

export const API_RATE_LIMIT = {
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 100,         // 100 requests per minute
}

// Email-sending endpoints (verification, password reset, etc.)
export const EMAIL_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,           // 5 emails per 15 min
}

// Feedback submission
export const FEEDBACK_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10,          // 10 submissions per hour
}

// Member portal access
export const MEMBER_PORTAL_RATE_LIMIT = {
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 30,          // 30 requests per minute
}

// Check-in operations
export const CHECKIN_RATE_LIMIT = {
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 60,          // 60 check-ins per minute (busy gym)
}

// Bulk operations (export, import, etc.)
export const BULK_RATE_LIMIT = {
  windowMs: 5 * 60 * 1000,  // 5 minutes
  maxRequests: 10,          // 10 bulk operations per 5 min
}

// Stripe/billing operations
export const BILLING_RATE_LIMIT = {
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 10,          // 10 billing requests per minute
}

// Helper to get client IP from request
export function getClientIP(request: Request): string {
  // Check common headers for proxied requests
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }

  // Fallback - in serverless this might not be accurate
  return 'unknown'
}

// Convenience function that returns a NextResponse if rate limited
export function rateLimitResponse(
  request: Request,
  endpoint: string,
  config: RateLimitConfig
): { limited: false } | { limited: true; retryAfter: number } {
  const ip = getClientIP(request)
  const identifier = `${endpoint}:${ip}`

  const result = checkRateLimit(identifier, config)

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
    return { limited: true, retryAfter }
  }

  return { limited: false }
}
