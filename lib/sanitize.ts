// lib/sanitize.ts
// Input sanitization utilities for security

/**
 * Sanitize a string to prevent XSS attacks
 * Removes or escapes potentially dangerous characters
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return ''

  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .replace(/data:/gi, '') // Remove data: protocol
    .trim()
}

/**
 * Sanitize HTML content - more aggressive than sanitizeString
 * Use for user-generated content that will be displayed
 */
export function sanitizeHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;')
    .trim()
}

/**
 * Sanitize email address
 * Returns empty string if invalid format
 */
export function sanitizeEmail(input: string): string {
  if (!input || typeof input !== 'string') return ''

  const email = input.toLowerCase().trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRegex.test(email)) return ''
  if (email.length > 254) return '' // RFC 5321 limit

  return email
}

/**
 * Sanitize phone number
 * Returns only digits and common phone characters
 */
export function sanitizePhone(input: string): string {
  if (!input || typeof input !== 'string') return ''

  // Keep only digits, plus, parentheses, dashes, and spaces
  return input.replace(/[^\d+\-() ]/g, '').trim().slice(0, 20)
}

/**
 * Sanitize a name (person's name)
 * Allows letters, spaces, hyphens, apostrophes
 */
export function sanitizeName(input: string): string {
  if (!input || typeof input !== 'string') return ''

  // Remove anything that's not a letter, space, hyphen, or apostrophe
  return input
    .replace(/[^a-zA-Z\u00C0-\u017F\s\-']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/**
 * Sanitize a URL
 * Only allows http/https protocols
 */
export function sanitizeUrl(input: string): string {
  if (!input || typeof input !== 'string') return ''

  const trimmed = input.trim()

  // Only allow http and https protocols
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return ''
  }

  try {
    const url = new URL(trimmed)
    // Prevent javascript: and data: in any part
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ''
    }
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * Sanitize numeric input
 * Returns null if not a valid number
 */
export function sanitizeNumber(input: unknown): number | null {
  if (typeof input === 'number' && !isNaN(input) && isFinite(input)) {
    return input
  }

  if (typeof input === 'string') {
    const parsed = parseFloat(input)
    if (!isNaN(parsed) && isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

/**
 * Sanitize integer input
 * Returns null if not a valid integer
 */
export function sanitizeInteger(input: unknown): number | null {
  const num = sanitizeNumber(input)
  if (num === null) return null
  return Number.isInteger(num) ? num : null
}

/**
 * Validate and sanitize a UUID
 * Returns empty string if invalid
 */
export function sanitizeUuid(input: string): string {
  if (!input || typeof input !== 'string') return ''

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const trimmed = input.trim().toLowerCase()

  return uuidRegex.test(trimmed) ? trimmed : ''
}

/**
 * Generic object sanitizer
 * Recursively sanitizes all string values in an object
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        typeof item === 'string' ? sanitizeString(item) :
        typeof item === 'object' && item !== null ? sanitizeObject(item as Record<string, unknown>) :
        item
      )
    } else {
      result[key] = value
    }
  }

  return result as T
}

/**
 * Check for SQL injection patterns
 * Returns true if suspicious patterns found
 */
export function hasSqlInjectionPatterns(input: string): boolean {
  if (!input || typeof input !== 'string') return false

  const patterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|UNION|DECLARE)\b)/i,
    /(['";])/,
    /(--|\*\/|\/\*)/,
    /(\bOR\b|\bAND\b).*[=<>]/i,
  ]

  return patterns.some(pattern => pattern.test(input))
}

/**
 * Validate file extension against allowed list
 */
export function isAllowedFileExtension(filename: string, allowed: string[]): boolean {
  if (!filename || typeof filename !== 'string') return false

  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return allowed.includes(ext)
}
