# Member API

The API behind the member app. The web app at `/member/me` and any future
native app (React Native, Expo, Swift, Kotlin) use the same endpoints and the
same business rules; there is no second backend.

Every response is `{ "data": ... }` on success and `{ "error": "...", "code": "..." }` on failure.
The member is always worked out from the session. No endpoint accepts a member id.

## Signing in

| | Browser | Native app |
|---|---|---|
| Send on sign-in | nothing extra | header `X-ClubCheck-Client: native` |
| Session arrives as | `member-session` httpOnly cookie | `token` in the response body |
| Send on each request | the cookie (automatic) | `Authorization: Bearer <token>` |
| Store it in | n/a | the device keychain / keystore |

Sessions last 14 days and end immediately on password change, reset, "sign out everywhere" or when the gym archives the member.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/member-auth/login` | `email`, `password`, `gymId?` | `{status:"choose_gym", gyms}` when the same login exists at two gyms |
| POST | `/api/member-auth/logout` | `everywhere?` | |
| GET | `/api/member-auth/session` | | `{authenticated}` |
| POST | `/api/member-auth/recover` | `email` | forgot password and first-time setup; always answers the same |
| GET | `/api/member-auth/token/:token` | | what an emailed link is for |
| POST | `/api/member-auth/set-password` | `token`, `password` | finishes an invitation or reset and signs in |
| POST | `/api/member-auth/change-password` | `currentPassword`, `newPassword` | returns a new `token` to bearer clients |
| POST | `/api/member-auth/verify-email` | `token` | confirms a changed address |

## The member's account (`/api/portal/me/...`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Home in one request: gym, member, memberships (with what the member may do: `can.freeze/unfreeze/cancel/resume/change`), upcoming bookings, attendance, billing (invoices, payments, saved methods, next billing date), `inbox` (unread count and latest), `recentActivity`, and empty `appointments` / `events` arrays reserved for later phases |
| GET | `/memberships/:id/plan-change?planId=&effective=now\|next_period` | What changing to another public plan would cost or credit: the same calculation staff see (`calc.amountDueNowCents`, `creditCents`, `nextBillingDate`, `nextBillingCents`, remaining days). `allowed: false` comes with `blocked.message` |
| POST | `/memberships/:id/plan-change` | Confirm it: `{ planId, effective, expected: { fromPlanId, amountDueNowCents, creditCents }, idempotencyKey }`. `expected` is what the preview showed; if the figures have moved the answer is 409 `preview_changed` and nothing happens. Repeating the same key returns the first result |
| GET | `/household` | `null`, or the member's household. Someone billed to another person gets `{ role: 'member', billedTo: <first name> }`. The payer gets `{ role: 'payer', members: [{ name, memberships, amountDueCents, invoices }] }`: billing only, nothing else about them |
| PATCH | `/` | Name, phone, address, emergency contact, preferences. A new email is only applied after it is confirmed. `smsOptIn` is agreement to text reminders, `smsMarketingOptIn` to offers by text; both are recorded as the member's own choice. Once `member.smsStopped` is true (they replied STOP) turning either on returns 409 `sms_stopped`: they text START instead |
| GET | `/schedule?date=&days=&classTypeId=&category=&locationId=` | Classes with time, duration, coach, location, capacity, spots left, waitlist and the member's own booking |
| POST | `/bookings` | `sessionId`, `joinWaitlist?`. A full class answers `422 class_full` with `details.waitlistAvailable` |
| POST | `/bookings/:id` | `action: "cancel" \| "claim"` (cancel also leaves a waitlist; claim accepts an offered spot) |
| GET | `/bookings/:id/calendar` | `.ics` file |
| GET | `/checkin` | Whether self check-in is on, the class a check-in would count for, recent visits |
| POST | `/checkin` | Check in. Same rules as the front desk, no override |
| POST | `/memberships/:id` | `action: "freeze" (until?, reason?) \| "unfreeze" \| "cancel" (reason?) \| "resume" \| "change" (planId)` |
| GET | `/plans` | Public recurring plans the member can switch to |
| GET | `/payment-methods` | Saved cards and bank accounts (display details only) |
| POST | `/payment-methods` | Starts a Stripe SetupIntent; confirm it with Stripe's SDK, then call `/payment-methods/sync` with `setupIntentId` |
| PATCH / DELETE | `/payment-methods/:id` | Make default / remove |
| POST | `/invoices/:id/pay` | Pay an open invoice with a saved method. A household payer may pay invoices for the people they pay for. A member whose bills go to a payer gets 403 `billed_to_payer` |
| GET | `/appointments` | The member's appointments as `upcoming`, `past` and `cancelled`, each with what they may do (`can.cancel`, `can.cancelFree`, `can.reschedule`) and `freeChangeUntil` |
| GET | `/appointments/options` | Bookable appointment types with coaches, cost, the member's session credits, why a type is blocked (`needs_package`, `needs_membership`) and packages they could buy |
| GET | `/appointments/slots?typeId=&date=&staffId=&locationId=&reschedule=` | Genuinely free start times with the coaches free at each |
| POST | `/appointments` | `typeId`, `startsAt`, `staffId?` (omit for any available), `locationId?`, `notes?`. `409` when the time has just been taken |
| GET | `/appointments/:id` | One appointment |
| POST | `/appointments/:id` | `action: "cancel" (reason?) \| "reschedule" (startsAt, staffId?)` under the type's cancellation policy |
| GET | `/appointments/:id/calendar` | `.ics` file |
| POST | `/packages` | `planId`: buy a session package with the saved payment method |
| GET | `/workouts` | The member's training: `todays`, `upcoming` (two weeks), `missed` (last week, still doable), `programs` with progress, `recent`, `records`, `totals`. Each entry carries a `source` to open it with |
| POST | `/workouts/sessions` | `source` (exactly one of `{sessionId}`, `{assignmentId, programDayId}`, `{classSessionId}`, `{appointmentId}`), `start?`. Opens the member's own session for that workout, creating it once however many times it is asked. A class needs a booking; an appointment must be theirs. `409 program_paused`, `too_early` |
| GET | `/workouts/sessions/:id` | The prescription (blocks, items, scaling options, exercise details) and beside each item what was done: `approach`, `logged` sets, `lastTime`. Never includes coach-only notes |
| POST | `/workouts/sessions/:id` | `action: "start" \| "set" (set: itemId, setNumber, weight?, weightUnit?, reps?, durationSec?, distanceM?, rpe?, notes?) \| "delete_set" (itemId, setNumber) \| "approach" (approach: itemId, performedAs rx/scaled/substituted/skipped, scalingId?, exerciseId?, note?) \| "notes" (notes) \| "complete" (result: timeSec?, rounds?, reps?, durationSec?, notes?) \| "skip"`. Logging the same set number again corrects it. `complete` returns the `records` it produced and is safe to repeat. Sets cannot change after completion |
| GET | `/workouts/history?before=` | Finished workouts, newest first, 15 a page, with `nextBefore` |
| GET | `/workouts/records?exerciseId=` | Current bests, or every record for one exercise. `previous` is null for a first result, which is a baseline, not a record |
| GET | `/workouts/exercises?search=` | Exercises the member may substitute in: built-in and the gym's own, without coach notes |
| GET | `/documents` | The member's documents: `actionRequired`, `signed`, `expired`, `declined`, `voided` |
| GET | `/documents/:id` | One document to read: `title`, `blocks` (text runs, not HTML), `fields`, `fieldValues`, `consentText`, `can {sign, decline, download}`. Recorded as viewed; never signs |
| POST | `/documents/:id` | `action: "begin" \| "fields" (fields) \| "sign" (consent: true, read: true, signerName, signature: {method: "typed", text} or {method: "drawn", width, height, strokes}, fields) \| "decline" (reason?)`. `409 already_signed`, `voided`, `expired`; `400 fields_incomplete` with the fields at fault |
| GET | `/documents/:id/pdf` | The signed copy as a PDF (only once signed) |
| GET | `/notifications?before=&category=&take=` | Notification center, newest first, with `unread` and `nextBefore` |
| POST | `/notifications/read` | `ids?` (omit to mark everything read) |
| POST / DELETE | `/devices` | `platform`, `pushToken`: register or remove a device for push |

Booking, buying or changing a plan can answer `409 documents_required` with `details.documents` (`id`, `name`,
`type`): the member signs those through `/documents/:id` and repeats the request.

## Notifications and push

Every member-facing event is written once to the notification center by
`notifyMember()` (`lib/services/member-notifications.ts`): bookings, waitlist
changes, payments, membership changes, account changes and messages from the
gym. Each row carries a `category` and the `screen` it relates to (`home`,
`schedule`, `checkin`, `membership`, `profile`).

Push is not sent yet. To add it, implement `deliver()` in that file: look up the
member's `MemberDevice` rows and hand the row to APNs, FCM or Web Push. Nothing
else changes, and devices can already register.

## Limits

120 requests a minute per member, plus a flood guard per network address.
