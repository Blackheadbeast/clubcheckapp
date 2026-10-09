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
| Member payments | Stripe Connect: each gym's own Stripe account, direct charges |
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
- Members have their own accounts (`lib/member-auth.ts`): email and password at `/member/login`, a
  `member-session` cookie, and the account page at `/member/me`. The session is signed with a key derived from
  `JWT_SECRET`, so a member token never verifies as a staff token or the reverse, and it is re-read against the
  database on every request (archiving a member, a password change or "sign out everywhere" ends it at once).
- Staff invite a member from their profile; the member opens a single-use emailed link, chooses a password, and
  the account attaches to the existing `Member` row. Invitation, reset and email-change links are stored only as
  hashes. "Forgot password" also serves members who never had a password, and answers the same for any email.
- Every member route is `/api/portal/me/*`: `lib/portal.ts` works out the member from the session and no route
  accepts a member id. The older emailed link (`/member/[token]`) still works for members who have not set a
  password, and stops opening the account once they have.
- Member emails are unique per gym, not globally. If one email and password match accounts at two gyms, sign-in
  asks which gym.

## Modules

Business rules live in `lib/services/*` and are called by thin route handlers. Screens are client components
that talk to the API through `lib/client.ts`.

| Area | Screens (`app/(app)/…`) | API (`app/api/…`) | Rules (`lib/services/…`) |
|---|---|---|---|
| Today (staff daily operations) | `today`, `home` (role landing) | `today`, `today/members`, `members/[id]/quick` | `today.ts`, `conflicts.ts` |
| Dashboard | `dashboard` | `dashboard` | `reports.ts` |
| Members / CRM | `members`, `members/[id]` | `members/*`, `tags` | `members.ts`, `core.ts` (timeline) |
| Membership plans | `memberships` | `membership-plans`, `memberships/[id]` | `memberships.ts` |
| Billing | `billing/*`, `settings/payments` | `billing/*`, `members/[id]/payment-methods`, `webhooks/stripe-connect` | `payments.ts`, `collections.ts`, `lib/payments/*` |
| Classes & calendar | `schedule`, `schedule/classes` | `schedule/*` | `classes.ts` |
| Booking & waitlist | `schedule/bookings` | `bookings/*` | `bookings.ts` |
| Appointments | `appointments`, `appointments/types`, `appointments/availability`, and on the `schedule` calendar | `appointments/*`, `portal/me/appointments/*`, `portal/me/packages` | `appointments.ts`, `credits.ts` |
| Check-in & attendance | `checkin`, `attendance`, `/kiosk` | `checkin/*` | `checkin.ts` |
| Leads / sales | `leads` | `leads/*` | route handlers + `automations.ts` |
| POS | `pos`, `pos/products`, `pos/orders` | `pos/*` | `pos.ts` |
| Communication | `communication/*` | `messages`, `campaigns`, `templates`, `automations` | `messaging.ts`, `campaigns.ts`, `audience.ts`, `automations.ts` |
| Reports | `reports/[type]` | `reports/[type]` | `reports.ts` |
| Staff & roles | `staff`, `staff/permissions` | `staff/*` | `lib/permissions.ts` |
| Locations, rules | `locations`, `settings/rules` | `locations`, `business-settings` | `core.ts` |
| Member app | `/member/me` (Home, Schedule, Check in, Membership, Profile, notifications) | `portal/me/*` (see `docs/MEMBER-API.md`) | `member-notifications.ts`; existing booking, check-in, membership and payment services |
| Member accounts | `/member/login`, `/member/me`, `/member/activate`, `/member/reset` | `member-auth/*`, `portal/me/*`, `members/[id]/invite` | `lib/member-auth.ts`; same services, `source: 'member'` |
| ClubCheck subscription | `settings/subscription`, `settings/invoices` | `stripe/*`, `billing-status`, `invoices` | `lib/billing.ts` |

Advanced billing (plan changes, credits, households, refunds) adds: `lib/billing/proration.ts`,
`lib/services/{plan-change,account-credit,households,idempotency}.ts`, the routes
`/api/memberships/:id/plan-change`, `/api/members/:id/{credit,household}`, `/api/households`,
`/api/billing/transactions/:id/refund` and their `/api/portal/:token/...` counterparts, the staff components in
`components/billing/AdvancedBilling.tsx`, and the permissions `billing.households` and `communication.text`.
`scripts/stripe-advanced-billing.ts` checks all of it against Stripe test mode.

### Rules worth knowing

- **Member status is derived.** `syncMemberStatus` sets `Member.status` from the member's memberships
  (`active > trial > past_due > frozen > cancelled`). Members with no memberships keep a manual status.
  `overdue` and `paused` are legacy values read as `past_due` and `frozen`.
- **Money is integer cents.** Invoices hold line items, discount, tax and total; `Transaction` rows are
  payments, refunds and credits. Card numbers are never stored: only provider references and last four digits.
- **Recurring billing is idempotent.** `runMembershipBilling` raises one invoice per period, guarded by the
  unique `(membershipId, periodStart)`. It also converts trials, applies scheduled cancellations, ends freezes,
  expires packs, marks memberships past due after the grace period and, if `pastDueCancelDays` is set, cancels
  ones left unpaid beyond it.
- **ClubCheck owns the billing schedule; Stripe only moves the money.** There are no Stripe subscriptions for
  members. A membership is the subscription: Member → Membership → Invoice → Transaction. `runCollections`
  charges due invoices for memberships that pay by card or bank debit, using the member's default saved method.
- **The processor is never called inside a database transaction.** `collectInvoice` charges first with an
  idempotency key (`invoice:attempt:amount:method`), then records the outcome with `settlePayment`.
- **Recording is idempotent on the processor's reference.** `settlePayment`, `recordExternalRefund` and
  `recordDispute` can run any number of times for the same PaymentIntent, refund or dispute; the direct path and
  the webhook path both call them. Handled webhook event ids are also kept in `PaymentEvent`.
- **Failed payments.** A decline records a failed transaction, moves the membership to past due, fires the
  `payment_failed` automation and schedules retries on day 3, 5 and 7 after the first failure. After the fourth attempt the invoice
  is left for staff (Billing → Failed payments).
- **Bank debits are asynchronous.** They sit as a `pending` transaction until the webhook reports the result;
  an invoice with a pending payment is never charged again. Money that arrives for an invoice paid another way
  in the meantime becomes account credit.
- **Tenancy for payments.** Stripe customers and payment methods live on the gym's connected account. The
  webhook derives the tenant from the event's connected account, never from metadata. Only display details of a
  saved method (brand, last four, expiry) ever reach the browser.
- **Spots are allocated under a row lock.** Booking, cancelling, claiming and promoting all `SELECT … FOR UPDATE`
  the `ClassSession` row first, so two requests cannot take the same last spot.
- **Appointment availability is computed, never assumed.** `getSlots` offers a time only if it is inside the
  staff member's working hours, outside breaks and time off, clear of their other appointments and the classes
  they coach, inside the type's notice and advance limits, and clear of the member's own classes and appointments.
  Working hours are minutes from midnight in the gym's timezone, converted per date, so they survive daylight saving.
- **Double booking is impossible at the database.** A live appointment holds a `TimeClaim` row per five-minute
  slot for its staff member and for its member; the unique index on `(resource, slot)` rejects a second claim.
  Booking also locks the staff and member rows so the loser of a race gets a clear 409 rather than a raw error.
  Staff may override notice, advance limits and working hours; nobody can override a clash.
- **Appointment credits and money move once.** Session credits (PT packages are `Membership` rows with
  `creditsRemaining`, the same as class packs; `credits.ts` is shared) are spent in the booking transaction.
  Rescheduling never touches them. Cancelling returns them, or refunds a paid appointment through
  `refundPayment`, only outside the type's own `cancelWindowHours`, which is snapshotted on the appointment.
  A no-show keeps the credit. A member's online payment that is declined releases the slot.
- **Nobody can be in two places at once.** `conflicts.ts` is the one place that relates classes and
  appointments. Giving a member a place (a class spot, a claimed or promoted waitlist spot, an appointment)
  locks the member row and checks both tables; putting a class in a coach's diary locks the staff row and checks
  their appointments, as booking an appointment checks their classes. Lock order is always session, staff, member.
  Back-to-back is allowed; joining a waitlist is not a booking and is not checked until the spot is taken.
- **Recurring classes are generated before appointment times are offered**, even beyond the usual 56-day
  horizon, so an appointment can never land where a class was always going to be. If background generation still
  meets an appointment, the class is created without the coach and staff are notified.
- **Location scope.** Owners, admins and managers see every location. Other staff with a home location are
  locked to it everywhere a location filter exists (`effectiveLocation` in `today.ts`): Today, check-in, the
  check-in log, members, member export, transactions, invoices, membership billing, bookings, the class calendar,
  appointments, leads, orders, the dashboard and every report. The location they ask for is ignored. Members and
  invoices follow the member's home location (`homeScope`); members with no home location are visible to all.
  Looking one member up by name, and opening a member's profile, is not limited: members train at any location.
- **A membership valid only at some locations** does not check in at the others (staff with member-management
  rights can override).
- **Where each role lands** after sign-in is `homeFor()` in `lib/permissions.ts`: front desk, coaches and
  trainers on Today; sales on the pipeline; accountants on billing; owners, admins and managers on the dashboard.
- **Waitlist.** A freed spot is offered to the next person for `waitlistOfferMinutes`; unclaimed offers pass down
  the queue (`expireOffers`, run lazily and by cron). With a window of 0 the next person is booked straight in.
- **Messages use an outbox.** Anything queued inside a transaction is a `Message` row with status `queued`;
  delivery happens after commit (`flushOutbox`), so a rolled-back booking never emails anyone. `deliverMessage`
  claims a row before sending, so two workers never send the same one. Temporary provider failures are retried
  with a growing wait (up to five attempts); permanent ones are not. A send cut off by a crash is closed as
  failed after ten minutes and is never sent again automatically.
- **One logical message is sent once.** Callers pass a `dedupeKey` (`camp:<campaign>:<recipient>`,
  `auto:<run>:<channel>`, `waitlist:<booking>:…`, `direct:<gym>:<key from the browser>`); `MessageKey` holds it
  under a primary key, and a second request waits for and returns the first message.
- **Texting needs consent, and a phone number is not consent** (`smsBlock` in `messaging.ts`, `lib/services/sms.ts`).
  `Member.smsOptIn` is agreement to reminders and updates; `smsMarketingOptIn` is separate agreement to offers.
  Campaigns and promotional automations need the second; triggers marked `category: 'operational'` need the first;
  a member of staff writing to one person needs the first, or that person to have texted the gym. Every change goes
  through `setSmsConsent` and is kept in `SmsConsentEvent` with who made it and how. Texts that may not be sent
  are stored as `skipped` with the reason.
- **STOP is final for staff.** An inbound STOP (or a carrier "unsubscribed" error) sets `smsStopped` for everyone at
  that gym with that number and blocks every kind of text. No staff route can undo it (`sms_stopped`, 409); only
  the person can, by texting START, which restores reminders and never marketing. It is checked again at the
  moment of sending, so a STOP that arrives after a message was queued still wins.
- **Inbound texts** arrive at `/api/webhooks/twilio/inbound` and delivery reports at `/api/webhooks/twilio/status`.
  Both reject anything without a valid Twilio signature. The gym is found from the number texted (`SmsNumber`),
  the person from the sender's number, and a thread (`SmsConversation`, one per gym and phone) is attached to a
  member only when exactly one member has that number. Nothing in the request body can choose a gym, member or
  conversation. An inbound text is stored and staff are notified; it never triggers a reply, campaign or automation.
  Delivery reports only move a message forward (delivered is never undone).
- **Twilio credentials stay on the server.** They are read in `lib/messaging/sms.ts` and nowhere else;
  `GET /api/sms` reports only whether each is present. `SMS_PROVIDER=simulate` swaps in a stand-in carrier for
  local work and tests and is ignored in production.
- **Automations** are `trigger → conditions → delay → message`, by email, text or both. Event triggers enqueue an
  `AutomationRun`; scheduled triggers are found by a scan. `(automationId, dedupeKey)` stops an event firing twice.
  Appointment reminders are runs timed ahead of the appointment (`scheduleTimedRuns`): moving the appointment
  replaces them, cancelling it removes them, and one that could not go out before the start is dropped, not sent late.
- **Campaigns are queued, then worked off in batches** (`sendCampaign`, `drainOutbox`), at most 5,000 recipients
  each. A campaign is claimed before it is queued, so it cannot be sent twice. It can be scheduled and, until it
  starts, cancelled.
- **A coach teaches one class at a time.** `assertCoachFreeForClass` refuses a class that overlaps another class
  (or an appointment) of the same coach on create, edit, move, coach change and copy; `assertCoachFreeForSchedule`
  and strict generation do the same for weekly schedules. All take the coach's row lock first, so two requests at
  once cannot both land. Ending at 10:00 and starting at 10:00 is fine.
- **One proration calculation.** `calculateProration` in `lib/billing/proration.ts` is the only place a plan
  change is priced: integer cents, whole days in the gym's timezone, rounding half up. `computePlanChange`
  (`lib/services/plan-change.ts`) gathers the facts and calls it; the staff preview, the member preview, the
  invoice and the amount charged all come from that one result. Same billing cycle: the billing date stays, the
  unused part of what was paid is credited and the new plan is charged for the days left. Different cycle
  (monthly to yearly): a new period starts today. A change can instead wait for the next billing date
  (`Membership.pendingPlanId`), with no proration.
- **A plan change is confirmed against its preview.** The confirmation carries the plan it was from and the
  amount due and credit that were shown, plus an idempotency key. Under a row lock on the membership the figures
  are worked out again; if they differ, nothing happens and the caller gets the new preview. So two changes at
  once cannot both land, and a repeat of the same request returns the first result (`IdempotencyKey`,
  `lib/services/idempotency.ts`). Each change is a `PlanChange` row holding the whole calculation.
- **A downgrade is credit, never cash.** When the unused value is more than the new charge the difference
  becomes account credit. No refund is created.
- **Account credit is a ledger** (`lib/services/account-credit.ts`). Every credit is an `AccountCredit` row
  (original amount, what is left, source, reason, who created it) and every use or removal is a
  `CreditApplication` row naming the invoice and payment. `Member.creditBalanceCents` is kept equal to the sum
  of what is left. A balance from before the ledger becomes one "carried over" credit the first time it is
  touched. Credit marked for automatic use comes off the next renewal or plan-change invoice; staff can hold a
  credit back.
- **Refunds.** `refundPayment` (`collections.ts`) refunds all or part of a payment, to the card or bank account
  through the processor, or onto account credit. The payment row is locked while the amount is checked, so the
  total refunded cannot pass what was captured; Stripe enforces the same on its side. A caller's idempotency key
  makes a repeat the same refund here and at Stripe. Refunds carry a reason and a note. A refund Stripe reports
  as pending is recorded as pending and settled by webhook; one that later fails is reversed (`settleRefund`)
  and staff are told. A shop order's status follows what has been refunded.
- **Households share who pays, and nothing else** (`lib/services/households.ts`). `billingPayer` is asked at the
  moment money is collected: the household's payer if there is one, otherwise the member. The invoice, the
  payment record and the membership stay the member's own; the payment records the payer
  (`Transaction.payerMemberId`). Only the payer's saved methods can be charged for a household invoice. Changing
  the payer or leaving the household affects future charges only. A failed payer card puts each affected
  invoice through the ordinary failed-payment steps, one invoice at a time.
- **Row locks do not block child inserts.** `lockRow` takes `FOR NO KEY UPDATE`, so two transactions that each
  insert a payment for a member and then lock that member wait their turn instead of deadlocking.
- **Timezones.** The server runs in UTC; "today", class times and report buckets use the gym's timezone
  (`lib/dates.ts`).

### Workout programming

Coaches build workouts from an exercise library, arrange them into multi-week programs, and assign them; members
see and log them in the member app. Code: `lib/workouts/*` (pure rules), `lib/services/{exercises,workouts,
programs,workout-sessions,coaching}.ts`, staff API under `/api/coaching/*`, member API under
`/api/portal/:token/workouts/*`, staff screens under `/coaching`, the member's Workouts tab in
`components/member/Workouts.tsx`.

- **Exercises are built in or the gym's own.** Built-in exercises have no owner (`Exercise.ownerId` null), are seeded
  by `ensureSystemExercises`, and cannot be edited or retired by any gym; a gym copies one to adapt it. A gym's own
  exercises are visible to that gym only. A gym cannot have two active exercises of its own with the same name.
  Retiring keeps the row so old workouts still name it. Coach notes on an exercise never reach the member API.
- **A workout is versioned, and a version never changes once someone has trained from it.** `Workout` points at its
  current `WorkoutVersion`, which holds the whole prescription as one JSON document (blocks, items, scaling options,
  exercise names as they were). Saving a workout nobody has opened yet rewrites the current version; saving one with
  sessions creates the next version. A `WorkoutSession` is pinned to the version the member was given, so editing or
  archiving a workout, or renaming or retiring an exercise, cannot alter anyone's history. A session that has not
  been started picks up the newest version when the member starts it.
- **Programs point at workouts, not copies.** `ProgramDay` is (week, weekday, workout). Improving a workout improves
  every program that uses it for future sessions. A program with live assignments cannot be archived.
- **Assignment dates are computed, not stored per day.** `ProgramAssignment` has a start date; week 1 is the week
  that date falls in, and each training day's date is worked out from it (`lib/workouts/schedule.ts`). Pausing
  shifts every remaining day back by the length of the pause. Assigning to a membership plan is a snapshot of who
  holds it at that moment. A member already on a program is skipped, not assigned twice.
- **The prescription and the result are separate.** What the coach wrote lives in the version; what the member did
  lives in `WorkoutSetLog` (one row per set) and `WorkoutItemLog` (as written, scaled, substituted or skipped, with
  a note). Nothing a member logs ever writes to the prescription. A finished session's sets cannot be changed.
- **Attending is not completing.** A workout attached to a class or an appointment (`ClassSession.workoutId`,
  `Appointment.workoutId`) is visible to the members booked into it. Checking in or being marked attended creates
  no workout session; the member completing the workout is its own act and its own record.
- **Personal records are worked out at completion** (`lib/workouts/records.ts`): heaviest weight, most reps at a
  weight, an estimated one-rep max (Epley, sets of 1 to 10 reps only), longest time or distance, and for scored
  workouts done as written, fastest time or most rounds. The first result for something is stored as a baseline and
  is not called a record; a record always has an earlier result it beat. Pounds and kilograms are compared in
  kilograms.
- **Who can do what.** `workouts.view` and `workouts.manage` are held by coaches, trainers, managers, admins and the
  owner; front desk, sales and accounts have neither. A coach or trainer changes only what they built and reads only
  members they coach (an assignment, class or appointment of theirs); managers and above see everything. The member
  API takes the member from the session and never from the request.
- **Notifications reuse the existing engine.** Program assigned, paused, resumed and completed, a workout assigned,
  coach feedback and a personal record go through `logActivity` to the member notification centre; the coach is told
  through the staff notification feed; `program_assigned`, `workout_missed` and `program_completed` are automation
  triggers. Private coach notes (`WorkoutSession.coachNotes`) are staff only.

### Public API and webhooks

Outside software talks to a gym through `/api/v1`, and is told what happens through outbound webhooks. The
developer-facing reference is `docs/PUBLIC-API.md` and `docs/openapi.yaml`; this is how it is built.

- **`/api/v1` is its own surface, not the app's routes with the door open.** Every route goes through
  `publicHandler` (`lib/public-api/handler.ts`), which is separate from `handler`: request ID, API key, rate
  limits, scope, the demo and subscription write gates, body validation, optional idempotency, a fixed response
  and error shape, and a request log row. Routes are thin: they validate, call the same `lib/services/*`
  functions the staff app calls, and serialise through `lib/public-api/serialize.ts`. That file is the contract:
  what is not in it (medical notes, check-in codes, portal tokens, staff-only notes) cannot leak.
- **Rules that used to live in routes moved into services so both callers share them**: `addMember` and
  `updateMember` (`members.ts`), `createLead` and `updateLead` (`leads.ts`). The staff routes now call them too.
- **API keys** (`lib/public-api/keys.ts`, table `ApiKey`). A key is `cc_live_<8 hex>_<32 random bytes>`; only its
  SHA-256 hash and its first 16 characters are stored. It belongs to one gym, carries a list of scopes
  (`lib/public-api/scopes.ts`), may expire, and is revoked by setting `revokedAt`. Each scope names the staff
  permission it stands for, and nobody can create a key with a scope their own role lacks. Staff manage keys
  with the `developer.manage` permission (owner, admin, manager).
- **The API acts as staff without staff's overrides.** Bookings, appointments and memberships made through it
  follow the same service rules as the front desk, but the flags that let a person waive a rule (`override`,
  `waive`) are never passed. Payments and invoices are read only.
- **Rate limits are counted in the database** (`ApiRateWindow`, one row per key per minute and per gym per
  minute, incremented with a single upsert), so they hold across server instances. Requests with no valid key
  are throttled per address in memory and are not logged.
- **Idempotency** reuses the `IdempotencyKey` table with scope `v1:<METHOD> <path>`. The key is claimed before
  the work starts; a concurrent repeat waits for the first to finish and replays its response; a failed request
  releases the key.
- **Webhook events are an outbox** (`lib/services/webhooks.ts`). `emitEvent` runs inside the transaction that
  makes the change and writes a `WebhookEvent` (with the exact JSON to send) and one `WebhookDelivery` per
  subscribed endpoint. If the transaction rolls back, there is no event. `(ownerId, dedupeKey)` is unique, so one
  operation is one event however many code paths notice it. A gym with no endpoints pays one indexed lookup.
- **Events are emitted by services, not routes** (`lib/services/events.ts` holds the helpers), at the point each
  operation is decided: so a booking cancelled by staff, by the member, by the API, by a class being cancelled
  or by a membership ending all announce `booking.cancelled` once.
- **Delivery** (`deliverDue`) claims a delivery with a conditional update, POSTs it signed
  (`ClubCheck-Signature: v1=HMAC-SHA256("<timestamp>.<body>")`), and records an attempt row. Failures are
  retried after 1 min, 5 min, 30 min, 2 h, 6 h and 24 h, then marked dead. It is called right after a write
  request (`kickWebhooks`, not awaited), by the outbox drain, and by both cron routes. Retries, automatic or by
  hand, send the stored payload unchanged.
- **Signing secrets are encrypted, not hashed** (AES-256-GCM, key derived from `WEBHOOK_ENCRYPTION_KEY`, or
  `JWT_SECRET` if that is not set), because they must be used to sign. They are shown once and never returned.
- **Where a webhook may be sent.** `https` only; in production, hosts that are or resolve to loopback, private
  or link-local addresses are refused, and redirects are never followed.

### Online booking (the public page and website widget)

A gym's public booking page is `/book/<slug>`; the widget for its own website is that same page in a frame
(`public/embed/booking.js`). Code: `lib/services/public-booking.ts`, `lib/public-booking/*`, routes under
`/api/public/booking/[slug]/*`, the page in `app/book/[slug]`, the UI in `components/booking/BookingApp.tsx`,
settings in `app/(app)/settings/online-booking`.

- **It is a thin layer over the existing engines, not a second booking system.** Room in a class, free
  appointment times, eligibility, credits, prices, charging and cancellation all come from `bookClass`,
  `getSlots`, `bookAppointment`, `checkEligibility`, `sellMembership`, `collectInvoice`, `cancelBooking` and
  `cancelAppointment`, called as a member would call them (`source: 'member'`, no staff overrides). The layer
  adds only: which things are public, who the person is, a confirmation to come back to, and `channel = 'online'`
  on the booking or appointment.
- **`BookingSite`** holds what is particular to the public page: the slug, on/off, which locations, class types and
  appointment types are public, whether an account is required, whether guests may book, a shorter booking window,
  wording and branding. Classes, types, prices and rules stay where they were.
- **An unknown address and a switched-off page are indistinguishable** (`resolveSite` answers the same 404), and no
  public response carries the gym's internal id.
- **Who is booking.** Three ways to be known, and no other:
  1. *Sign in* with the member app's own account (`loginMember`, scoped to this gym).
  2. *Create an account*: the member record is made, and the member app's ordinary invitation email is sent with a
     `next` path back to the booking in progress. The answer to the browser is "check your email" whoever the
     address belongs to.
  3. *Guest* (if the gym allows): name, email, phone. Only for an address this gym has never seen. A known address
     is emailed a link instead and the browser is told only to check its email, so nobody can act as an existing
     member by typing their address.
  A new person is a `Member` with status `inactive` and `leadSource = 'online_booking'`; an open lead with the same
  email is closed onto that member and its original source kept. Existing members' sources are never touched.
- **Booking sessions are their own token** (`lib/public-booking/tokens.ts`): a signed token accepted only by the
  public booking endpoints, held by the page and sent as a bearer header. A cookie would not survive being embedded
  in another site. It is not a member-app session and opens nothing else. On the standalone page, a member already
  signed in to the member app on the same site is recognised and handed one. Guest tokens last two hours and stop
  working the moment that person has an account.
- **Manage links.** Every confirmation carries a signed link naming that one booking, so a guest can view it, add
  it to a calendar and cancel it without an account. It works only on the page of the gym it belongs to.
- **Guests and memberships.** A guest has no membership, so the booking engine refuses a class that needs one. The
  page then shows the plans the gym sells publicly: a free one-off plan (a trial class) can be started on the spot;
  anything that costs or renews needs an account and a saved card, and is sold by `buyPlanWithSavedMethod`
  (`lib/services/purchases.ts`), the same sale-then-charge-then-undo-on-decline the member app uses for packages.
- **Payment** is the existing path: a paid appointment is charged by `settleAppointmentPayment` through the gym's
  connected processor, and a decline cancels the appointment and answers 402. Card details are entered in the
  processor's own form (the shared `AddPaymentMethodModal`); nothing card-related touches ClubCheck's servers.
- **Double submits.** Booking and purchase requests carry an `Idempotency-Key`, handled by the same claim-then-run
  helper as the public API, keyed to the person as well as the gym.
- **Rate limits** are per caller address: 60 availability lookups, 12 bookings a minute; 8 sign-ups and 10
  sign-ins per ten minutes; one "continue" email per person per ten minutes.
- **Framing.** Only `/book/*` may be shown inside another site (`next.config.mjs`); every other page keeps
  `X-Frame-Options: DENY`. The embed script creates one frame of this origin, sizes it from height messages it
  accepts only from that frame, and writes no HTML into the host page.
- **Theme.** The gym's colour re-points the app's own design tokens for that page (`lib/public-booking/theme.ts`).
  The colour is validated as six hex digits and links as http(s) before they are stored, so settings cannot inject
  CSS or script.
- **Emails** (confirmation, waitlist, cancellation, "finish your booking") go through `queueMessage` like every
  other message. No text is sent to someone because they typed a phone number: SMS still needs recorded consent.
- **A local stand-in processor** (`PAYMENT_PROVIDER=simulate`, ignored in production) exists so paid flows can be
  exercised in a browser without Stripe.

### Documents and e-signatures

Waivers, agreements, policies and forms, sent to members to read and sign, with a signed record that cannot change.

- **Templates and versions** (`DocumentTemplate`, `DocumentTemplateVersion`). A version is `draft`, `published` or
  `archived`. A draft is edited in place; a published version is never edited: saving a change starts the next
  version as a draft, and publishing it retires the previous one. All of this is in `lib/services/documents.ts`.
- **Wording is a small plain markup, never HTML** (`lib/documents/content.ts`): `#` headings, `**bold**`, `*italic*`,
  `- ` and `1. ` lists, `[text](https://…)` links, `---` for a page break, and `{{merge.fields}}` from a fixed
  list. It is parsed into text runs; screens and the PDF draw those runs. Merge fields are looked up in that list
  and filled once, as plain text: a value is never parsed again, so nothing a member or gym types can run. A
  template with an unknown merge field cannot be published.
- **A member's copy** (`MemberDocument`) holds the version id and number and the resolved content exactly as it was
  sent (`content`). Later template edits, renames of the member or the gym, and new versions do not touch it.
  Statuses: `sent`, `viewed`, `partially_completed`, `signed`, `declined`, `expired`, `voided`. Assigning locks the
  member row, so the same template is never given to one person twice at once; someone who already has it (open,
  or signed and still valid) keeps the copy they have unless staff ask for it to be signed again.
- **Signing** needs the end of the document to have been on screen, every required field, a drawn or typed
  signature (unless the template only asks for acknowledgement), the signer's full name, and the consent box. The
  server checks all of it again; the consent flag has to be literally `true`. The row is locked while signing, so
  two tabs or a double tap give exactly one signature and the other gets `409 already_signed`.
  A drawn signature is stored as the points of its strokes, rounded to whole pixels: enough to draw it again, with
  no pressure, timing or device data.
- **The signed record** is `finalSnapshot`: the wording, the answers, the signature, the signer, and the evidence
  (when consent was given and its exact text, when it was signed, method, IP address, browser, and which route:
  member app, signing link or online booking). `snapshotHash` is the SHA-256 of that record with its keys in
  alphabetical order (the database does not keep JSON key order). No code path updates a signed record; voiding
  and expiry change the status beside it.
- **The PDF** (`lib/documents/pdf.ts`, no dependencies) is drawn only from the signed record, and the record is
  checked against its fingerprint every time before a copy is handed out. Drawing the same record twice gives the
  same bytes, so the stored file is a cache: it can be deleted and rebuilt.
- **Files** go through `lib/storage` (`put`, `get`, `delete` by a server-chosen key). `FILE_STORAGE=local` (the
  default) writes under `FILE_STORAGE_DIR` or `.data/files`; `memory` is for tests. An S3-compatible driver is one
  more class there. There are no public file URLs: every download is a route that checks who is asking.
- **Audit trail** (`DocumentEvent`): assigned, sent, resent, viewed, signature started, fields saved, consent
  given, signed, declined, voided, expired, reminded, downloaded, each with who, when, IP and browser. Rows are only
  ever inserted; there is no route that edits or deletes them, a document, or a template.
- **Emailed signing links** (`DocumentSigningToken`): 32 random bytes, only the SHA-256 kept, 14 days, one live link
  per document, spent on signing or declining, revoked when the document is resent, voided or replaced. The email
  is sent directly rather than through the message log, so the raw link is never stored. Opening a link shows the
  document and records a view; it signs nothing. Every way a link can be wrong gives the same 404.
  After signing, the signer gets a 15-minute signed token to download their copy without an account.
- **Required documents** (`DocumentRequirement`): on becoming a member, before a membership purchase or plan
  change, before booking a class, before booking an appointment, optionally limited to particular plans, class
  types or appointment types. `requireDocuments` runs inside the existing engines (member app booking, plan
  purchase and change, public booking page): it assigns what is missing and answers `409 documents_required` with
  the list. The booking page shows the document, signs it in place and then repeats the booking; a decline leaves
  the booking unmade and says so. **Staff are not blocked**: when staff sell a membership or book for someone, the
  document is assigned and emailed for the member to sign. Signup documents are assigned automatically and block
  nothing by themselves.
- **Expiry and reminders** run in the daily platform cron: an unsigned document past its deadline, or a signature
  past its validity, becomes `expired` (the signed record stays and can still be downloaded), and the member is
  asked afresh the next time it is required. One reminder is sent after three days unsigned. Notifications, staff
  alerts and automations (`document_assigned`, `document_reminder`, `document_signed`, `document_declined`,
  `document_expired`) use the existing engines.
- **Permissions**: `documents.view`, `documents.send`, `documents.download`, `documents.manage`. Owner, admin and
  manager have all four; accountant view and download; front desk and sales view and send; coach and trainer none.
  Viewing shows status and history, not the wording, answers or signature: those are only in the PDF, which needs
  `documents.download`. Members only ever reach their own documents.

### Payroll and commissions

What staff have earned, by pay period: base pay, commissions and adjustments, reviewed, approved, locked and
exported. It calculates and records; it does not pay anyone, withhold tax or talk to a payroll provider.

- **No second set of books.** Earnings are read from what the rest of the system already recorded: `Transaction`
  (payments and refunds), `Invoice`, `PlanChange`, `Appointment` (who delivered what, the record the appointments
  phase left for this) and `ClassSession`. Nothing in billing, memberships, appointments or bookings calls payroll;
  the one hook is `sellMembership` recording who made the sale.
- **Compensation** (`StaffCompensation`, `lib/services/payroll-config.ts`): per person, a base (none, hourly,
  salary, flat per period) plus an amount per completed appointment and per class taught. A second row for a
  location replaces the default for work done there. Commission sits on top.
- **Commission plans** (`CommissionPlan`, `CommissionRule`, `CommissionAssignment`): a plan is a list of rules,
  each a percentage or a fixed amount on one of: membership sales, upgrades, renewals, packages (class packs,
  drop-ins, PT packages), appointments delivered, classes taught. A rule can be limited to particular plans,
  appointment types or class types. A person is on one plan at a time, from a start date; the event's date decides
  which plan applies. Classes are fixed-amount only (a class has no price of its own).
- **What a percentage is taken of:** the money actually received (a succeeded payment), with sales tax taken out in
  the proportion it was charged. Unpaid invoices, failed and pending payments earn nothing. A fixed amount per sale
  is paid once per invoice, with the first payment.
- **Attribution** (`SaleAttribution`): a membership is credited to whoever sold it (the staff member making the
  sale, or the people named on the sale, in shares that add up to 100). Renewals go to the people credited;
  an upgrade goes to whoever made the change. Appointments and classes go to the staff member who delivered them.
  The account owner is not on the payroll, and nobody who has been deactivated earns anything new. Changing who is
  credited affects payments payroll has not yet worked out; commission already in the ledger moves only by adjustment.
- **The ledger** (`PayrollEntry`, `lib/services/payroll.ts`). One line per thing earned, reversed or adjusted,
  carrying the rule as it stood (plan name, rate, share, revenue basis), the source, the member and the location.
  Lines are only ever inserted. The one change a line sees is being placed in a pay period.
- **Exactly once.** `syncPayroll` looks for payments, refunds, completed or no-show appointments and classes it
  has not seen, works each out with the rates and rules in force at that moment, and writes a `PayrollSource`
  marker in the same transaction. It runs under a per-gym advisory lock, and every line has a unique key
  (`ownerId` + `sourceKey`), so a retry, a duplicate webhook or six people opening the page together cannot enter
  anything twice. Editing a plan never touches a line already written. It runs when payroll is viewed, on each
  period step, and in the daily platform cron.
- **Refunds** add a `refund_reversal` line: the same share of the commission as the share of the payment that went
  back, never more than is left, and exactly the remainder on a full refund. A pending refund waits until it
  settles; one that later fails restores the commission. Per-appointment and per-class pay is not taken back for a
  refund (the work was done). A class cancelled after it was paid for is reversed. A cancelled or late-cancelled
  appointment earns nothing; a no-show earns only under rules that say so.
- **Appointment revenue** is counted when the appointment is delivered, on what has been paid by then (net of
  refunds); a payment that arrives later is counted when it arrives. Never both.
- **Base pay.** Salary is annual / 365 x the days in the period; flat pay is the amount per period. Both are
  brought to the right figure by adding a line for any difference, so a raise mid-period is a second line, not an
  edit. Hourly pay comes from hours entered for the period (`PayrollTimeEntry`); removing hours adds a cancelling line.
- **Pay periods** (`PayrollPeriod`): open -> review -> approved -> finalized. They cannot overlap. A line is paid
  in the open period its date falls in (dates by the gym's timezone); if that period is already approved or
  finalized, it is carried into the next open one and marked as carried. Approving does a last sync and then stops
  anything further being placed in the period. Finalizing records the totals and a fingerprint of the lines; the
  page compares them with the ledger on every view and says so if they ever differ. Reopening needs
  `payroll.reopen`, a reason, and is recorded. Every step is idempotent and taken under a row lock, so eight
  simultaneous "finalize" requests finalize once.
- **Adjustments** (bonus, deduction, commission adjustment, correction, other) are ledger lines with an amount, a
  reason, the author and a `PayrollEvent`. Only into an open or in-review period. The route takes an
  `Idempotency-Key`. There is no edit or delete: a mistake is corrected with another adjustment.
- **Export.** CSV per period: a summary line per person, or every ledger line. Cells are escaped against
  spreadsheet formula injection like every other export.
- **Permissions:** `payroll.view` (owner, admin, manager, accountant: see and export), `payroll.manage` (owner,
  admin, manager: pay rates, plans, hours, adjustments, approve, finalize), `payroll.reopen` (owner, admin).
  Everyone on staff can see their own earnings at `/payroll/me`, and only their own. No member, portal or public
  API route returns payroll data.

## Interface and design system (2026-10-08)

The look of the product comes from one place; pages do not carry their own colours or sizes.

- **Tokens** (`app/globals.css`, exposed to Tailwind in `tailwind.config.ts`): neutral "ink" greys for
  surfaces and text (`bg`, `surface`, `subtle`, `line`, `fg`, `fg-muted`, `fg-heading`), one accent (amber) used
  for the primary action and the current place, and status colours used only for status. The sidebar has its
  own tokens (`nav`, `nav-raised`, `nav-text`, `nav-heading`, `nav-line`) so it stays dark in both themes.
  The theme is light unless someone chooses dark or auto; `dark` on `<html>` switches every token.
- **Type** is Inter, loaded with `next/font` (`app/layout.tsx`). The scale is five classes:
  `ui-page-title`, `ui-section-title`, `ui-label`, `ui-eyebrow`, `ui-kpi`.
- **Components** (`components/ui.tsx`): `Page`, `PageHeader`, `Card`, `CardHeader`, `Stat`, `Button`, `Badge` /
  `StatusBadge`, `Tabs`, `Table`, `Modal`, `EmptyState`, `ErrorState`, `Skeleton`, `Avatar`, toasts. New screens
  use these and the `ui-input` class for fields. An empty state says what is missing, why it matters and
  offers the next step where there is one.
- **Motion** is four classes (`ui-fade`, `ui-pop`, `ui-rise`, `ui-skeleton`), all switched off under
  `prefers-reduced-motion`.
- **Navigation** (`components/AppShell.tsx`): the sidebar lists areas in six groups (Overview, People,
  Schedule, Business, Engagement, Configuration). An area's own pages are a tab bar under the header
  (`SectionTabs`), shown only when the person may open more than one of them. An entry is hidden when the
  role cannot open it; this is presentation only, every API still checks the permission itself. On a phone
  the sidebar is a drawer and a bottom bar holds the four most used areas plus "More".
- **Phones** (under 640px, rules at the end of `app/globals.css`): fields are 16px text and 44px tall, buttons
  44px (`ui-tap`), small buttons and icon buttons 40px. `Table` (and `StackedTable` for hand-written tables)
  draws each row as a card with every value beside its column name; the names are read from the header row, so
  a page describes its table once. `primary={n}` picks the column used as the card title, `stack={false}` keeps
  a grid. Small controls that must stay small take `ui-hit` for a larger touch area. Dialogs are bottom sheets.
  The floating feedback button is desktop only; on a phone it is "Send feedback" in the menu drawer.
- **Older pages** (landing, sign-in, sales, admin, kiosk, the first Settings tab) still use some earlier
  class names (`text-gray-*`, `bg-theme*`). Those are re-pointed to the tokens in `app/globals.css`. Pages
  drawn on a fixed dark background (landing, not-found) carry `keep-dark` so they read correctly in either theme.

## Background work

`GET /api/cron/platform` (authorised by `CRON_SECRET`) runs billing, class generation, waitlist expiry,
no-show marking, automation scans and the message outbox for every account. Every step is idempotent.
`vercel.json` schedules it daily, which is all the Hobby plan allows; on Pro, change it to `*/15 * * * *`
so delayed automations and waitlist deadlines are timely.

`GET /api/cron/messages` (same secret) is the lighter, minute-level heartbeat: due reminders, scheduled campaigns,
retries and waitlist deadlines. It is not in `vercel.json` because a per-minute schedule needs a paid plan; point
Vercel Cron or any external scheduler at it every one to five minutes. Without it, timed texts still go out, but
only when the daily job runs or a member of staff has the Today screen or a sending campaign open. Recurring classes are also generated lazily when
the calendar looks ahead, and waitlist offers expire lazily whenever a schedule is read.

## Known limitations (as of the payroll phase)

Verified and not verified, stated plainly:

- **Verified in a real browser** (headless Chromium at 390x844, 820x1180 and 1440x900, light and dark): the member
  sign-in page and its error state, and the member app's Home, Schedule (including booking a class), Check in,
  Membership (including the freeze dialog), Profile, notifications, and loading, empty and error states.
- **Not verified in a browser:** the staff back office screens added in the payments phase (Settings → Payments,
  the saved-cards section, charge and retry in the payment dialog), the "Invite member" control, and the forgot,
  activate, reset and verify pages (these load and their APIs are tested, but nobody has looked at them).
- **Stripe's card and bank form has never been opened in a browser.** Saving a card or bank account was tested by
  confirming with Stripe's test payment methods on the server, not by typing into the form.
- **Stripe hosted onboarding has not been completed by a person.** Charging was tested on an API-created test
  account; the calls are the same but the gym's own sign-up journey is unproven.
- **Live Stripe mode has never been used.** All payment verification is in test mode. No real money has moved.
- **Member emails have not reached a real inbox.** Invitation, reset and confirmation links are generated and
  tested; in development they are printed to the server console.
- **Push notifications are not sent.** The notification center, device registration and the delivery hook exist;
  no push provider is connected. There is no service worker, so the installed app does not work offline.
- **No native app exists.** The member area is an installable mobile web app and the API is ready for one
  (`docs/MEMBER-API.md`).
- **Two-factor sign-in is not implemented**, for members or staff.
- **Profile photo upload is not implemented.** Photos are still URLs set by staff.
- **Appointments and events** are empty placeholders in the member API until those phases are built.
- **Appointments are one-to-one.** Small-group appointments (several members in one slot) are not supported;
  use a class for those.
- **Timed texts depend on the heartbeat.** Reminders are due at an exact minute but go out when something runs
  the outbox: `/api/cron/messages` if it is scheduled, otherwise the daily job or an open Today screen. A
  "starting soon" text that misses its window is dropped rather than sent late.
- **No text has been sent through a real Twilio account.** Every SMS test, automated and in the browser, used the
  simulated carrier and webhooks signed locally with a test token. Real sending, real delivery reports, a real
  inbound reply and a real STOP still have to be tried with live credentials (see "Turning on texting").
- **Texting is US and Canada first.** Numbers typed without a country code are read as +1. There is no MMS, no
  quiet-hours rule, no per-gym sending limit beyond the campaign cap, and no A2P 10DLC registration help:
  registering the brand and campaign with Twilio is the account holder's job and is required before US carriers
  will deliver at volume.
- **Front desk texts one to one only.** `communication.text` gives the inbox and one-to-one texts (front desk,
  sales, managers, admins, owner). Campaigns, sent-message history, templates and email need
  `communication.send`, which front desk does not have.
- **The inbox is not live.** It refreshes every 15 seconds (an open thread every 10). There is no unread count
  in the navigation; new texts raise a staff notification that links to the thread.
- **Two members sharing one number** (a family) cannot be told apart on an inbound text. The thread stays
  unattached until staff choose who it is, and a STOP from that number stops both.
- **Classes that already overlapped for one coach** before the rule existed are left as they are.
- **Clash rules for classes are enforced by row locks and checks, not by a database constraint** (appointments
  have both). Bookings that overlapped before the rule existed are left as they are.
- **Location locking limits lists and figures, not single records.** Locked staff can still open any member,
  invoice or booking they have the id or name for. Report figures for members use the member's home location.
- **The Today screen refreshes every minute**; it is not live. Two staff working the same roster see each
  other's changes on the next refresh or action.
- **No camera scanning in the staff app.** A handheld scanner that types a code works in the search box.
- **Not checked in a browser for the staff app:** adding a member to a class from the roster, promoting and
  removing from a waitlist, messaging a class, and the check-in override prompt. These are covered by API tests.
- **Coach time off does not cancel existing appointments**; staff are told how many are affected.
- **Not checked in a browser for appointments:** the late-cancellation warning, a paid appointment's checkout,
  buying a package in the app, and the no-show and staff cancel dialogs. These are covered by API tests.
- **A plan change takes effect whether or not the card then works.** The change and its invoice are committed
  first and the card is charged afterwards (the processor is never called inside a database transaction). A
  decline leaves the member on the new plan with an unpaid invoice, which then follows the usual failed-payment
  retries. This is the same for staff and for members changing their own plan.
- **Plan changes are for recurring memberships that are paid up.** A frozen, past-due or cancelling membership,
  or one whose current invoice is unpaid, must be put right first. A membership whose current period was billed
  outside ClubCheck (no invoice on record) can be changed by staff on an assumed "paid at the plan price", which
  the preview says plainly; a member cannot do that one themselves.
- **Proration is by calendar day in the gym's timezone,** and the day of the change counts as a day on the new
  plan. It is not by the hour.
- **A member's own discount carries to the new plan.** Coupons do not: a coupon reduced the invoice it was used
  on, and that reduction is reflected in what counts as "paid" for proration. There are no per-plan promotional
  prices, and no discount system was added in this phase.
- **Account credit is spent only on membership invoices automatically** (renewals and plan changes). On a shop
  sale or a one-off invoice staff choose "account credit" as the payment method. Credit is never paid out as
  cash from ClubCheck; to give money back, refund a payment.
- **A household has one payer and shares only billing.** There is no splitting an invoice between two payers,
  no per-member spending limit, and a member is in at most one household. The payer can see and pay the
  household's invoices in the member app but cannot change another member's plan there.
- **Each household invoice is charged separately.** A payer with three members sees three charges on their
  statement, and a failing card is declined once per invoice.
- **Refunds are by amount, not by line item.** A partial refund of a shop order does not put stock back or mark
  which item it was for; the whole-order refund still does. Refunding a membership payment does not change the
  membership or its dates.
- **A refund kept as account credit is not a refund at the processor.** The money stays with the gym.
- **Pending and failed refunds were exercised with a stand-in processor only.** Stripe's test cards refund
  instantly, so the pending-then-failed path (a bank refund that bounces) has not been seen against real Stripe.
- **Lint is not set up.** The repository has no ESLint configuration, so
  `npm run lint` stops at Next's interactive set-up prompt. Run with Next's default rules from a temporary
  config it reports unescaped apostrophes in text (37), hook dependency and `<img>` warnings (10), and one
  conditional hook call in `app/(app)/settings/page.tsx` that predates this work.
- **Workout programming**, verified in a real browser at 1440x900 (staff), 820x1180 and 390x844 (member):
  - Pausing a program shifts the whole remaining schedule; individual days cannot be moved or swapped.
  - Assigning a program to a membership plan covers who holds the plan at that moment. People who join the plan
    later are not added.
  - Records are worked out when a workout is completed, from that member's logged sets. Removing a member's history
    does not recompute older records, and there is no way for staff to enter or correct a record by hand.
  - There is no per-member unit preference: a set is logged in the unit the coach prescribed (pounds by default).
  - Percent-of-one-rep-max is shown as written; it is not turned into a weight for the member.
  - Exercise videos and images are links; nothing is uploaded or hosted.
  - There is no timer, rest clock or offline logging in the member app. Each set saves as it is logged, so a lost
    connection loses at most the set being entered.
  - The workout tables carry `ownerId` but have no cascade from `Owner`; deleting an account does not remove them.
  - The duplicate-name rule for a gym's own exercises is checked in code, not by a database constraint, so two
    saves in the same instant could both pass.
- **Public API and webhooks**, verified over real HTTP and in a real browser (Settings → Developer at 1440x900,
  820x1180 and 390x844):
  - Webhooks are sent straight after the request that caused them only when the server process outlives the
    response. On a serverless host that work can be cut short; the delivery is then picked up by the next
    `/api/cron/messages` or `/api/cron/platform` run. Without the minute-level cron, a webhook can wait until the
    daily job. Events caused by background work (the billing run) are always sent by a cron.
  - Webhooks are sent over a connection whose resolved address is checked as it connects, so a host whose DNS
    answer changes after registration (DNS rebinding) is refused at that moment too.
  - Changing `JWT_SECRET` (with no `WEBHOOK_ENCRYPTION_KEY` set) makes stored signing secrets unreadable: every
    endpoint then needs a new secret. Set `WEBHOOK_ENCRYPTION_KEY` before going live.
  - The per-address throttle on requests without a valid key is in memory and trusts `X-Forwarded-For` from the
    proxy in front of the app.
  - A method a path does not support (`PUT /api/v1/members/:id`) gets the framework's bare 405, not the API's
    JSON error.
  - There is no draft-invoice finalise step in the app, so `invoice.created` is not sent for a draft.
  - `Member.updatedAt` is new: existing members get the time the column was added. It moves on any change to the
    member row, including a check-in.
  - No per-key IP allow-list, no key rotation with overlap (create the new key, switch, revoke the old), no
    per-endpoint custom headers, no event replay for an endpoint added after the fact, and no sandbox mode.
  - Natively built integrations (Zapier, QuickBooks, HubSpot and the like) are not built; this is the layer
    they would sit on.
- **Online booking**, verified in a real browser (standalone at 1440x900, 820x1180 and 390x844, and embedded in
  an unrelated host page on another origin):
  - A guest cannot book a class unless the gym sells a free one-off plan publicly (or a paid one, with an account).
    That is the booking engine's membership rule, deliberately not bypassed. Free consultations need nothing.
  - Entering a new card on the public page uses the shared Stripe form and was not exercised in a browser here;
    paid bookings were browser-tested with saved cards against the local stand-in processor, and tested in code
    with a fake processor. No real or test-mode Stripe charge was made from the public page.
  - An address already known to the gym gets "check your email" where a new one books straight away, so someone
    probing can tell the two apart. Sign-ups are limited to 8 per ten minutes per address; a CAPTCHA was not added.
  - An unverified guest can book under an address that is not theirs (the real owner gets the confirmation email,
    and takes the record over the first time they use the page). Requiring an account closes this.
  - Rate limits are in memory, per server instance, keyed on the address the proxy reports.
  - An unknown booking address shows "not available" with `noindex`, but the framework sends it with HTTP 200.
  - No reschedule from the public page (cancel and rebook), no group or multi-person booking, no gift cards or
    promo codes, no SMS confirmation for guests, no custom fields on the guest form, no per-class-type colours.
  - The "visits" figure counts page loads, not people, so the conversion figure is a rough guide.
  - Inside the embedded frame the "add a card" dialog is positioned within the frame, which can be taller than
    the screen.
- **Documents and e-signatures**
  - This records who agreed to what, when and how, and keeps it unchangeable. It is not a certified or qualified
    electronic signature service, and whether a waiver's wording holds up is a legal question for the gym.
  - The signer is identified by their member sign-in, their booking session, or possession of an emailed link.
    There is no ID check, SMS code or second factor.
  - PDFs use the standard PDF fonts: characters outside Western European (Latin-1) print as "?". The text shown on
    screen and kept in the record is unaffected.
  - No uploaded PDFs, no fields placed at positions on a page, no countersignature by staff, no guardian or
    multi-signer flow, no bulk send to a whole segment (members are picked by name), no in-person kiosk signing.
  - Only local-disk and in-memory file storage are built. On a host without a persistent disk the PDF is simply
    redrawn from the record on each download; an S3-compatible driver is the place to add permanent storage.
  - Staff actions are not blocked by required documents (the document is sent instead), and check-in is not gated.
  - The older single-waiver setting on the gym profile and member record is unchanged and separate.
  - One reminder is sent, at three days. Rate limits on signing links are in memory, per server instance.
- **Payroll and commissions**
  - It calculates, records and exports. No tax withholding or filing, no direct deposit, no payroll-provider
    integration, no pay stubs.
  - Hours are typed in per pay period; there is no time clock. Overtime, holiday rates and tips are not modelled:
    use an adjustment.
  - Salary is prorated by calendar days (annual / 365), not by a pay schedule of 24 or 26 periods a year.
  - Commission is on memberships, packages, appointments and classes. Product (POS) sales and ad-hoc invoices earn
    no commission.
  - Payroll starts with the first pay period: nothing dated before it is worked out. A commission plan applies
    from the day someone is put on it, while a new per-appointment or per-class rate applies to anything not yet
    worked out.
  - Changing who is credited with a sale does not move commission already in the ledger.
  - The ledger is append-only by construction (no code path updates or deletes a line), not by a database trigger.
  - Staff have one location on record and the app has no per-location staff permissions, so anyone with
    `payroll.view` sees the whole gym; the period page can be filtered by location.
  - The account owner signs in as "Owner" and is not a staff record, so sales the owner makes are credited to
    nobody unless a seller is named.
- **Rate limiting is in memory**, per server instance.

## Production hardening (2026-10-08)

What the hardening pass changed, and why. The launch steps are in `LAUNCH-CHECKLIST.md`.

- **Scheduled jobs** share one check (`lib/cron.ts`): the secret in a header, compared in constant time, never
  accepted in the URL, and nothing authorized when `CRON_SECRET` is unset. The billing-reminder job read its secret
  from a place Vercel Cron never puts it and so had been refused on every run; it now claims each reminder before
  sending, so overlapping runs cannot send twice.
- **ClubCheck's own Stripe webhook** records each event id in `PaymentEvent` before handling it and removes the
  record if handling fails. The previous in-memory list did nothing across serverless instances: a redelivery could
  send a second "payment failed" email, and an event that failed once was skipped when Stripe retried it. It
  answers 503 when `STRIPE_WEBHOOK_SECRET` is missing rather than throwing.
- **Outbound webhooks** connect through a lookup that checks the address being connected to, which closes the DNS
  rebinding gap. In production `WEBHOOK_ENCRYPTION_KEY` is required: the session secret is no longer borrowed.
- **Sign-in** for owners and staff counts wrong passwords in the database (`lib/login-attempts.ts`, ten per account
  per fifteen minutes), because the in-memory limiter only sees one instance's requests. Staff sign-in checks the
  password before saying anything about the account, so it no longer reveals who has been deactivated.
- **Payroll sync** works in committed batches of 250 events, so a large backlog cannot hit a transaction timeout
  and be lost; refunds wait for a batch in which every earlier payment has been worked out; approval waits until
  the ledger is caught up.
- **Emails** take their links from `NEXT_PUBLIC_APP_URL`; the older waiver email built its link from the Host header.
- **Layout:** cards may shrink inside grids (long names widened Home, Dashboard and Memberships past a phone's
  width); the Settings tabs wrap; Settings called a hook after an early return.
- `tests/hardening.test.ts` requests every API route signed out (GET and POST) and as a signed-in owner and coach
  of an empty gym, and fails on any private data, internal error or leaked stack trace.

## Security audit (2026-10-08)

An attack-driven pass over the whole app. What it found and what changed; the regression tests are in
`tests/security.test.ts`.

- **Platform administrator.** `platformAdmin()` (`lib/admin.ts`) is now the only check: the session must be the
  account holder's own, the address must be on the list, and the address must be verified. Before, the address
  alone was enough, so an unverified account registered with that address, or any staff member on that account,
  reached the platform's sales and analytics API.
- **Google sign-in** (`lib/google-sign-in.ts`) requires Google's `verified_email`, refuses a Google identity other
  than the one an account is linked to, and, when it links to an account whose address was never verified, replaces
  that account's password (whoever set it never proved the address was theirs).
- **Sessions end when the password changes.** Staff and owner tokens carry a fingerprint of the password hash
  (`passwordVersion`); `getOwnerFromCookie` compares it on every request. The device that changes the password is
  given a new session.
- **Cross-site requests.** The middleware refuses any cookie-authenticated API request that changes something and
  arrives with another site's `Origin`. `SameSite=Lax` already kept the cookie off cross-site posts; this does not
  depend on it (and "same site" ignores ports, which the Origin check does not).
- **The middleware runs on every `/api` path.** It used to skip paths ending like a file name, and the older routes
  get their permission from it, so a role without access could reach `/api/prospects/<id>.png`.
- **Caller address.** `getClientIP` prefers the headers the hosting platform sets (`x-vercel-forwarded-for`,
  `x-real-ip`) over the caller-supplied `X-Forwarded-For`, for rate limits, audit entries and e-signature evidence.
- **Guessing and flooding** are counted in the database (`lib/login-attempts.ts`), not per server instance: sales
  sign-in, the email on the older public waiver, and account-recovery and booking-account emails per address.
- **Older email templates** escape every name and accept only http(s) links; a gym's name cannot alter the sender.
- **Input.** A zero byte in an address or a JSON body is refused as bad input (it used to reach the database and
  come back as an internal error). The older waiver route validates its body and caps the signature's size.
- **Older routes.** Member import, lead conversion and "send QR" apply the demo and lapsed-subscription gates;
  deleting a lead or updating billing for a record that is not the caller's answers 404, not 500.
- **Headers.** Production scripts no longer allow `eval`.

What the audit did not find: no route returned, changed or deleted another gym's data (every dynamic route was
tried with another gym's IDs, by session and by API key, and with fully valid request bodies); no member could
reach another member's records; no token was accepted outside its own purpose; no stored text rendered as markup.

## Not built yet

- **Member payments are verified in Stripe test mode only** (`scripts/stripe-testmode.ts`, 93 checks with live
  webhooks, plus `tests/payments.test.ts` with a fake processor). Two things in that run were stood in for: the
  gym's hosted Standard onboarding form and the member typing a card into Stripe's form in a browser. No live-mode
  payment has been taken. Before a gym relies on it, enable Connect and add the Connect webhook endpoint in live mode.
- **Cards that need the cardholder present** (3-D Secure on an off-session charge) are recorded as a failed
  payment with a clear reason; there is no hosted "authenticate this payment" page yet.
- **POS card payments** are still recorded from the gym's own terminal; Stripe Terminal is not integrated.
- **Member accounts** have no two-factor sign-in, no profile photo upload (photos are still URLs), and no
  appointments or documents section yet (those arrive with later phases).
- **SMS** sends only when the `TWILIO_*` variables are set. The Twilio adapter has not been run against a live account (no credentials were available during hardening either).
- **Email open/click tracking** needs a Resend webhook pointed at `/api/webhooks/resend` and `RESEND_WEBHOOK_SECRET`.
- **Proration, partial order refunds, per-member custom forms and document uploads** are not implemented.
  Plan changes take effect at the next billing date; order refunds are whole-order (partial refunds are available per payment).
- **Rate limiting is in-memory**, per server instance. Move it to Redis before running several instances.
- **Photos** are URLs; there is no file upload.

## Turning on member payments

1. In the platform Stripe account, enable Connect (Standard accounts).
2. Add a webhook endpoint of type "Connected accounts" pointing at `/api/webhooks/stripe-connect` with these events:
   `account.updated`, `account.application.deauthorized`, `payment_intent.succeeded`, `payment_intent.processing`,
   `payment_intent.payment_failed`, `setup_intent.succeeded`, `payment_method.detached`, `payment_method.updated`,
   `payment_method.automatically_updated`, `charge.refunded`, `refund.created`, `refund.updated`,
   `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`.
3. Set `STRIPE_CONNECT_WEBHOOK_SECRET` to that endpoint's signing secret. Optionally set `STRIPE_CONNECT_FEE_BPS`
   to take a platform fee on each member payment (default 0).
4. Each gym connects its own account under Settings → Payments, then saves cards or bank accounts on members
   (staff on the member's Billing tab, members in their portal).

## Turning on texting

1. Set on the server: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` (one number
   shared by gyms without their own) or `TWILIO_MESSAGING_SERVICE_SID`. Set `TWILIO_WEBHOOK_BASE_URL` to the public
   address if it differs from `NEXT_PUBLIC_APP_URL`. None of these is ever sent to a browser.
2. `prisma db push` adds `SmsConversation`, `SmsConsentEvent`, `MessageKey`, `SmsNumber` and columns on `Message`,
   `Member`, `Prospect` and `Campaign`. Additive only. Existing members keep `smsOptIn` as agreement to
   reminders; nobody starts with marketing consent.
3. In Twilio, on the number or messaging service, set "A message comes in" to
   `<base>/api/webhooks/twilio/inbound` (POST). Delivery reports need no setup: each message names
   `<base>/api/webhooks/twilio/status` itself. Leave Twilio's own STOP/START/HELP handling on.
4. Each gym with its own number enters it under Settings → Messaging, which also shows the addresses above and
   sends a test text. Inbound texts to a number are routed to the gym that entered it.
5. Schedule `GET /api/cron/messages` with `Authorization: Bearer $CRON_SECRET` every one to five minutes.
6. Try it with a phone you hold before any member is texted: test text, reply, STOP, START.

## Releasing advanced billing

`prisma db push` adds `Household`, `AccountCredit`, `CreditApplication`, `PlanChange` and `IdempotencyKey`, and
the columns `Member.householdId`, `Membership.pendingPlanId`, `Transaction.refundReason` and
`Transaction.payerMemberId`. Additive only. Nothing needs backfilling: existing credit balances are itemised the
first time each is used. No new environment variables, and no change to the Stripe webhook's event list.

## Releasing workout programming

`prisma db push` adds `Exercise`, `Workout`, `WorkoutVersion`, `Program`, `ProgramDay`, `ProgramAssignment`,
`WorkoutSession`, `WorkoutSetLog`, `WorkoutItemLog` and `PersonalRecord`, and the columns `ClassSession.workoutId`
and `Appointment.workoutId`. Additive only, nothing to backfill. The built-in exercises are created the first time
any gym opens the library (`ensureSystemExercises`). No new environment variables. The daily cron moves program
assignments between scheduled, active and completed and fires the missed-workout trigger.

## Releasing the public API

`prisma db push` adds `ApiKey`, `ApiRequestLog`, `ApiRateWindow`, `WebhookEndpoint`, `WebhookEvent`,
`WebhookDelivery` and `WebhookAttempt`, and the column `Member.updatedAt` (defaulted to the time it is added).
Additive only, nothing to backfill.

1. Set `WEBHOOK_ENCRYPTION_KEY` to a long random value and keep it: it protects webhook signing secrets.
2. Schedule `GET /api/cron/messages` every one to five minutes if it is not already (it now also retries
   webhooks); the daily platform cron retries them too and prunes old request logs, rate windows and events.
3. Nothing is exposed until a gym creates an API key under Settings → Developer / API.

## Releasing online booking

`prisma db push` adds `BookingSite` and `BookingSiteDaily`, and the columns `Booking.channel` and
`Appointment.channel`. Additive only, nothing to backfill. A gym's booking page does not exist until someone opens
Settings → Online booking (which suggests an address) and turns it on. `NEXT_PUBLIC_APP_URL` must be the public
address of the app: booking links, embed code and email links are built from it. Do not set `PAYMENT_PROVIDER`.

## Releasing documents and e-signatures

`prisma db push` adds `DocumentTemplate`, `DocumentTemplateVersion`, `DocumentRequirement`, `MemberDocument`,
`DocumentEvent` and `DocumentSigningToken`. Additive only, nothing to backfill. Optional settings: `FILE_STORAGE`
(`local` by default) and `FILE_STORAGE_DIR`. Nothing changes for a gym until it publishes a template; nothing is
required of members until a gym adds a rule under the template's "When it is required".

## Releasing payroll

`prisma db push` adds `StaffCompensation`, `CommissionPlan`, `CommissionRule`, `CommissionAssignment`,
`SaleAttribution`, `PayrollPeriod`, `PayrollEntry`, `PayrollSource`, `PayrollTimeEntry` and `PayrollEvent`. Additive
only, nothing to backfill, no new environment variables. Nothing is calculated for a gym until it creates its first
pay period. Memberships sold by staff from this release on record who sold them; earlier ones can be credited by
hand on the member's Memberships tab.

## Running it

```bash
npm run db:dev                 # local Postgres (prisma dev), port 51214
npx prisma db push             # with DATABASE_URL pointing at the local database
npm run seed                   # demo gym "Iron Harbor Fitness"
npm run dev
npm test                       # service tests; HTTP tests run too when the dev server is up
npx tsx scripts/local-postgres.ts   # a real Postgres on :54329 for runs that need two processes (live webhooks)
npx tsx scripts/stripe-testmode.ts  # member payments end to end against Stripe test mode (see the file header)
```

`.env.development.local` overrides `DATABASE_URL` for `next dev`, the seed and the tests, so local work never
touches the hosted database. The seed and the tests refuse to run against a non-local host.

## Releasing to an existing database

1. `npx prisma db push` against the target. Every schema change is additive (new tables, new nullable or defaulted columns).
2. `npx tsx scripts/backfill-platform.ts` for a dry run, then `--apply`. It gives each account a first location and copies
   old payment records into transactions. `--convert-manual-billing` additionally turns the old per-member monthly fee
   settings into real memberships; it is opt-in because it changes how those members are billed.
3. Set `CRON_SECRET` (and optionally `RESEND_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `TWILIO_*` (see "Turning on texting"), `WEBHOOK_ENCRYPTION_KEY` (see "Releasing the public API"), `DATABASE_POOL_MAX`).
