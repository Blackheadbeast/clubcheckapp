// Permission map for the older API routes that predate lib/api.ts and only
// check "is someone signed in". Edge-safe (no Node or database imports) so the
// middleware can use it; lib/auth.ts re-checks it against the live staff record.
//
// Routes built on handler() declare their own permission and are not listed here.

import type { Permission } from './permissions'

/** "owner" = account holder only (subscription, owner password). "any" = any signed-in user. */
export type LegacyRequirement = Permission | 'owner' | 'any'

interface Rule {
  pattern: RegExp
  /** Requirement per method; "*" is the fallback. */
  methods: Record<string, LegacyRequirement>
}

const RULES: Rule[] = [
  { pattern: /^\/api\/members\/import$/, methods: { '*': 'members.delete' } },
  { pattern: /^\/api\/members\/[^/]+\/(billing|payments)$/, methods: { GET: 'billing.view', '*': 'billing.manage' } },
  { pattern: /^\/api\/members\/[^/]+\/(qr|checkins)$/, methods: { '*': 'members.view' } },
  { pattern: /^\/api\/members\/[^/]+\/(send-qr|send-waiver)$/, methods: { '*': 'members.manage' } },
  { pattern: /^\/api\/checkin\/export$/, methods: { '*': 'reports.view' } },
  { pattern: /^\/api\/kiosk\/pin$/, methods: { '*': 'attendance.manage' } },
  { pattern: /^\/api\/prospects(\/.*)?$/, methods: { GET: 'leads.view', '*': 'leads.manage' } },
  { pattern: /^\/api\/broadcast$/, methods: { '*': 'communication.send' } },
  { pattern: /^\/api\/analytics$/, methods: { '*': 'reports.view' } },
  { pattern: /^\/api\/settings$/, methods: { GET: 'any', PATCH: 'any', '*': 'settings.manage' } },
  { pattern: /^\/api\/settings\/waiver$/, methods: { GET: 'any', '*': 'settings.manage' } },
  { pattern: /^\/api\/settings\/password$/, methods: { '*': 'owner' } },
  { pattern: /^\/api\/billing-status$/, methods: { GET: 'any', '*': 'owner' } },
  { pattern: /^\/api\/(invoices|billing-events|referrals|stripe\/create-subscription)(\/.*)?$/, methods: { '*': 'owner' } },
  { pattern: /^\/api\/(feedback|walkthrough|system-status|auth\/.*)$/, methods: { '*': 'any' } },
]

/** null = not a legacy route (it enforces its own permission through handler()). */
export function legacyRequirement(pathname: string, method: string): LegacyRequirement | null {
  for (const rule of RULES) {
    if (rule.pattern.test(pathname)) return rule.methods[method.toUpperCase()] ?? rule.methods['*'] ?? 'owner'
  }
  return null
}

export const REQUIREMENT_HEADER = 'x-cc-requires'
