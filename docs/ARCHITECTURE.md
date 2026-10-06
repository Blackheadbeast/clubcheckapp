# ClubCheck architecture

A map of how the platform is put together: what lives where, the rules that
hold it together, and what is deliberately not built yet.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 14 App Router, React 18, TypeScript, Tailwind |
| Data | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) |
| Auth | JWT in an httpOnly cookie (`jose`), bcrypt password hashes |
| Email / SMS | Resend; Twilio through a provider boundary (optional) |
| SaaS billing | Stripe subscriptions for the gym's own ClubCheck plan |
| Charts | Recharts behind `components/charts.tsx` |
| Tests | Vitest (`npm test`), against a local database only |

## Tenancy

`Owner` is the tenant (the organisation). Every other table carries `ownerId`
and every query filters on it. Three rules keep tenants apart:

1. Route handlers never take an `ownerId` from the client. It comes from the session (`ctx.ownerId`).
2. Any id a client sends (member, plan, location, coach, class type, tag, product) is checked with
   `assertOwned` / `assertAllOwned` before it is stored or followed. Foreign keys alone do not enforce tenancy.
3. Lookups by id always include `ownerId` in the `where`, so another tenant's id is a 404, never a 403.

`Location` hangs off the owner. Members have a home location; classes, staff, check-ins, orders and
transactions carry a `locationId`. The top-bar location switcher filters lists and reports; "All locations"
is the organisation-wide view.

## Authentication and authorisation

- Owners sign in at `/login`; staff at `/staff-login` with the gym code. Both get the same `auth-token` cookie.
  ClubCheck's own sales reps use a separate cookie and never reach gym data.
- `lib/permissions.ts` is the single source of truth: 8 roles, 23 permissions.
- `lib/api.ts` `handler({ permission, write, body })` wraps every new route: session, role check, rate limit,
  demo and subscription write gates, Zod validation, consistent `{ data, meta }` / `{ error, code }` responses, audit helper.
- `getOwnerFromCookie` re-reads the owner or staff row on every request, so deleting an account, deactivating a
  staff member or changing a role takes effect immediately rather than when the 7-day token expires.
- Older routes that only checked "signed in" are covered by `lib/route-permissions.ts`: the middleware attaches the
  required permission as an internal header (stripping any client copy) and `getOwnerFromCookie` enforces it.
- The UI hides what a role cannot use, but that is cosmetic. `tests/http.test.ts` asserts the server-side matrix.
- Members use the portal through the long random token in their link (`/member/[token]`, `/api/portal/[token]/*`).
  `lib/portal.ts` resolves the member from the token; portal routes can only act on that member.

## Modules

Business rules live in `lib/services/*` and are called by thin route handlers. Screens are client components
that talk to the API through `lib/client.ts`.

| Area | Screens (`app/(app)/…`) | API (`app/api/…`) | Rules (`lib/services/…`) |
|---|---|---|---|
| Dashboard | `dashboard` | `dashboard` | `reports.ts` |
| Members / CRM | `members`, `members/[id]` | `members/*`, `tags` | `members.ts`, `core.ts` (timeline) |
| Membership plans | `memberships` | `membership-plans`, `memberships/[id]` | `memberships.ts` |
| Billing | `billing/*` | `billing/*` | `payments.ts`, `lib/payments/provider.ts` |
| Classes & calendar | `schedule`, `schedule/classes` | `schedule/*` | `classes.ts` |
| Booking & waitlist | `schedule/bookings` | `bookings/*` | `bookings.ts` |
| Check-in & attendance | `checkin`, `attendance`, `/kiosk` | `checkin/*` | `checkin.ts` |
| Leads / sales | `leads` | `leads/*` | route handlers + `automations.ts` |
| POS | `pos`, `pos/products`, `pos/orders` | `pos/*` | `pos.ts` |
| Communication | `communication/*` | `messages`, `campaigns`, `templates`, `automations` | `messaging.ts`, `campaigns.ts`, `audience.ts`, `automations.ts` |
| Reports | `reports/[type]` | `reports/[type]` | `reports.ts` |
| Staff & roles | `staff`, `staff/permissions` | `staff/*` | `lib/permissions.ts` |
| Locations, rules | `locations`, `settings/rules` | `locations`, `business-settings` | `core.ts` |
| Member portal | `/member/[token]` | `portal/[token]/*` | same services, `source: 'member'` |
| ClubCheck subscription | `settings/subscription`, `settings/invoices` | `stripe/*`, `billing-status`, `invoices` | `lib/billing.ts` |

### Rules worth knowing

- **Member status is derived.** `syncMemberStatus` sets `Member.status` from the member's memberships
  (`active > trial > past_due > frozen > cancelled`). Members with no memberships keep a manual status.
  `overdue` and `paused` are legacy values read as `past_due` and `frozen`.
- **Money is integer cents.** Invoices hold line items, discount, tax and total; `Transaction` rows are
  payments, refunds and credits. Card numbers are never stored: only provider references and last four digits.
- **Recurring billing is idempotent.** `runMembershipBilling` raises one invoice per period, guarded by the
  unique `(membershipId, periodStart)`. It also converts trials, applies scheduled cancellations, ends freezes,
  expires packs and marks memberships past due after the grace period.
- **Spots are allocated under a row lock.** Booking, cancelling, claiming and promoting all `SELECT … FOR UPDATE`
  the `ClassSession` row first, so two requests cannot take the same last spot.
- **Waitlist.** A freed spot is offered to the next person for `waitlistOfferMinutes`; unclaimed offers pass down
  the queue (`expireOffers`, run lazily and by cron). With a window of 0 the next person is booked straight in.
- **Messages use an outbox.** Anything queued inside a transaction is a `Message` row with status `queued`;
  delivery happens after commit (`flushOutbox`), so a rolled-back booking never emails anyone.
- **Automations** are `trigger → conditions → delay → message`. Event triggers enqueue an `AutomationRun`;
  scheduled triggers are found by a scan. `(automationId, dedupeKey)` stops an event firing twice.
- **Timezones.** The server runs in UTC; "today", class times and report buckets use the gym's timezone
  (`lib/dates.ts`).

## Background work

`GET /api/cron/platform` (authorised by `CRON_SECRET`) runs billing, class generation, waitlist expiry,
no-show marking, automation scans and the message outbox for every account. Every step is idempotent.
`vercel.json` schedules it daily, which is all the Hobby plan allows; on Pro, change it to `*/15 * * * *`
so delayed automations and waitlist deadlines are timely. Recurring classes are also generated lazily when
the calendar looks ahead, and waitlist offers expire lazily whenever a schedule is read.

## Not built yet

- **Charging members' cards.** `lib/payments/provider.ts` is the seam. Only the manual provider exists:
  staff record cash, cheque and terminal payments, and "card" invoices stay open for collection. Automatic
  charging needs Stripe Connect (one connected account per gym). The platform's own Stripe key bills gyms for
  ClubCheck and must not be used to charge their members.
- **SMS** sends only when the `TWILIO_*` variables are set. The Twilio adapter has not been run against a live account.
- **Email open/click tracking** needs a Resend webhook pointed at `/api/webhooks/resend` and `RESEND_WEBHOOK_SECRET`.
- **Proration, partial order refunds, per-member custom forms and document uploads** are not implemented.
  Plan changes take effect at the next billing date; order refunds are whole-order (partial refunds are available per payment).
- **Rate limiting is in-memory**, per server instance. Move it to Redis before running several instances.
- **Photos** are URLs; there is no file upload.

## Running it

```bash
npm run db:dev                 # local Postgres (prisma dev), port 51214
npx prisma db push             # with DATABASE_URL pointing at the local database
npm run seed                   # demo gym "Iron Harbor Fitness"
npm run dev
npm test                       # service tests; HTTP tests run too when the dev server is up
```

`.env.development.local` overrides `DATABASE_URL` for `next dev`, the seed and the tests, so local work never
touches the hosted database. The seed and the tests refuse to run against a non-local host.

## Releasing to an existing database

1. `npx prisma db push` against the target. Every schema change is additive (new tables, new nullable or defaulted columns).
2. `npx tsx scripts/backfill-platform.ts` for a dry run, then `--apply`. It gives each account a first location and copies
   old payment records into transactions. `--convert-manual-billing` additionally turns the old per-member monthly fee
   settings into real memberships; it is opt-in because it changes how those members are billed.
3. Set `CRON_SECRET` (and optionally `RESEND_WEBHOOK_SECRET`, `TWILIO_*`, `DATABASE_POOL_MAX`).
