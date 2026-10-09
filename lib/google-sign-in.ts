// What to do with a Google sign-in. Kept apart from the route so the rules can be tested without Google.

export interface GoogleProfile { id?: unknown; email?: unknown; verified_email?: unknown }
export interface ExistingAccount { emailVerified: Date | null; provider: string | null; providerAccountId: string | null }

export type GoogleDecision =
  | { action: 'reject'; reason: 'no_profile' | 'unverified_email' | 'different_google_account' }
  | { action: 'create' }
  | { action: 'sign_in'; link: boolean; resetPassword: boolean }

export function googleSignInDecision(profile: GoogleProfile, existing: ExistingAccount | null): GoogleDecision {
  if (typeof profile.email !== 'string' || !profile.email || typeof profile.id !== 'string' || !profile.id) return { action: 'reject', reason: 'no_profile' }
  // Google says whether the address has been proven to belong to this Google account. Without that,
  // anyone could make a Google account claiming someone else's address and be signed in as them.
  if (profile.verified_email !== true) return { action: 'reject', reason: 'unverified_email' }
  if (!existing) return { action: 'create' }
  // An account already tied to one Google identity is not opened by another that happens to share the address.
  if (existing.provider === 'google' && existing.providerAccountId && existing.providerAccountId !== profile.id) return { action: 'reject', reason: 'different_google_account' }
  return {
    action: 'sign_in',
    link: !existing.provider,
    // If the address was never verified, whoever set the password never proved the address was theirs.
    // The real owner is arriving now, so that password must stop working.
    resetPassword: !existing.emailVerified,
  }
}
