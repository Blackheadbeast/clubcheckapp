// lib/rate-limit.ts
// Simple in-memory rate limiter for auth endpoints

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store - resets on server restart
// For production at scale, use Redis or similar
const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}, 60000) // Clean up every minute

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
