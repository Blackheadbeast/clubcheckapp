// Demo mode constants and helpers

// The demo owner's ID - this is a fixed UUID for the seeded demo account
export const DEMO_OWNER_ID = 'demo-owner-00000000-0000-0000-0000'
export const DEMO_EMAIL = 'demo@clubcheckapp.com'

/**
 * Check if the given owner ID is the demo account
 */
export function isDemoOwner(ownerId: string): boolean {
  return ownerId === DEMO_OWNER_ID
}

/**
 * Error message returned when demo users try to modify data
 */
export const DEMO_READ_ONLY_MESSAGE = 'Demo mode is read-only. Sign up for a free account to make changes!'
