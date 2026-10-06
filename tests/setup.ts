import { config } from 'dotenv'

// Tests write real rows, so they only ever run against the local dev database.
// JWT_SECRET comes from .env; the database URL must come from the local override.
config({ path: '.env' })
config({ path: '.env.development.local', override: true })

const url = process.env.DATABASE_URL || ''
let host = ''
try {
  host = new URL(url).hostname
} catch {}
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL points at "${host || 'nothing'}", not a local database. ` +
      'Start one with `npx prisma dev --detach --name clubcheck-dev` and set it in .env.development.local.'
  )
}
process.env.RESEND_API_KEY = ''
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
