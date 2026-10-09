# ClubCheck Public API

Version **v1**. A REST API for connecting other software to one ClubCheck gym: a website lead form, a CRM,
a booking widget, an accounting export, a coaching app. Outbound **webhooks** tell that software when
something happens, so it does not have to keep asking.

A machine-readable description of every endpoint is in [`openapi.yaml`](./openapi.yaml).

- [Quick start](#quick-start)
- [Base URL and versioning](#base-url-and-versioning)
- [Authentication](#authentication)
- [Scopes](#scopes)
- [Requests and responses](#requests-and-responses)
- [Errors](#errors)
- [Request IDs](#request-ids)
- [Pagination](#pagination)
- [Filtering](#filtering)
- [Rate limits](#rate-limits)
- [Idempotency](#idempotency)
- [Resources](#resources)
- [Webhooks](#webhooks)
- [Recipes](#recipes)
- [Limits and things to know](#limits-and-things-to-know)

---

## Quick start

1. In ClubCheck, open **Settings → Developer / API** (owner, admin or manager).
2. **Create API key**, name it after what will use it, and tick only the scopes it needs.
3. Copy the key from the dialog. **It is shown once.** ClubCheck stores only a hash of it.
4. Call the API:

```bash
curl https://YOUR-CLUBCHECK-DOMAIN/api/v1 \
  -H "Authorization: Bearer cc_live_a1b2c3d4_…"
```

```json
{
  "data": {
    "object": "api_key_info",
    "apiVersion": "v1",
    "gym": { "name": "Iron Harbor Fitness", "timezone": "America/New_York", "currency": "usd" },
    "key": { "name": "Website lead form", "scopes": ["leads:write"] }
  }
}
```

`GET /api/v1` works with any valid key and is the quickest way to check one.

## Base URL and versioning

```
https://YOUR-CLUBCHECK-DOMAIN/api/v1
```

The version is in the path. Within `v1`, changes are additive only: new endpoints, new optional parameters,
new fields in responses, new webhook event types. Write clients that ignore fields and event types they do not
know. Anything that would break a correct client (removing or renaming a field, changing a meaning) will ship
as `/api/v2` alongside `v1`, not in place of it. Every response carries `X-API-Version: v1`.

The public API is its own surface. ClubCheck's other `/api/...` routes are for its own apps, are not covered by
this document, do not accept API keys, and can change without notice.

## Authentication

Send the key as a bearer token on every request:

```
Authorization: Bearer cc_live_a1b2c3d4_Zq3…
```

- A key belongs to **exactly one gym**. It can never see or change another gym's data.
- A key looks like `cc_live_<8 hex>_<43 characters>`. The first 16 characters (`cc_live_a1b2c3d4`) are its
  **prefix**, shown in ClubCheck so keys can be told apart. The rest is secret.
- The full key is shown **once**, when it is created. It cannot be retrieved later. If it is lost, revoke it and
  create another.
- A key may have an **expiry** (30 days, 90 days, 1 year) or none.
- **Revoking** a key takes effect on the very next request and cannot be undone.
- ClubCheck records when each key was **last used** (to the minute).
- Member and staff sign-in sessions are not API keys and are refused here.

Keep keys on a server. Never put one in a web page, a mobile app, or a public repository: anyone who has it can
do whatever its scopes allow. For a public website form, post to your own server and call ClubCheck from there.

| Situation | Status | `error.code` |
|---|---|---|
| No `Authorization` header | 401 | `missing_api_key` |
| Not a ClubCheck key, or unknown | 401 | `invalid_api_key` |
| Revoked | 401 | `api_key_revoked` |
| Past its expiry | 401 | `api_key_expired` |
| Valid, but lacks the scope the endpoint needs | 403 | `insufficient_scope` |

## Scopes

A key can do only what its scopes say. `read` and `write` are separate: a key with `leads:write` can create
leads but cannot list them. The person creating a key can grant only scopes their own role in ClubCheck allows.
Scopes cannot be changed after creation; make a new key instead.

| Scope | Allows |
|---|---|
| `members:read` | List and read members |
| `members:write` | Create, update, archive and restore members |
| `memberships:read` | List and read memberships and membership plans |
| `memberships:write` | Start, freeze, unfreeze, cancel, resume and change the plan of memberships |
| `classes:read` | Read the class schedule |
| `bookings:read` | List and read class bookings |
| `bookings:write` | Book members into classes and cancel bookings |
| `appointments:read` | List and read appointments, appointment types and free times |
| `appointments:write` | Book, move and cancel appointments |
| `attendance:read` | List and read check-ins |
| `payments:read` | List and read payments, refunds and failed attempts |
| `invoices:read` | List and read invoices |
| `workouts:read` | List and read workouts and members' workout sessions |
| `workouts:write` | Assign a workout to members for a day |
| `programs:read` | List and read programs and who is on them |
| `programs:write` | Assign programs to members |
| `leads:read` | List and read leads |
| `leads:write` | Create and update leads |

Payments and invoices are **read only**. The API cannot take a payment, record one, or issue a refund.

## Requests and responses

- Request bodies are JSON (`Content-Type: application/json`).
- Times are ISO 8601 in UTC (`2026-10-07T14:30:00.000Z`). Dates without a time are `YYYY-MM-DD`.
- Money is an integer in the smallest unit of the gym's currency (`15000` is $150.00), with a `currency` field
  where it matters.
- IDs are opaque strings. Do not parse them.
- Every object has an `object` field naming its type (`"member"`, `"invoice"`, …).

One resource:

```json
{ "data": { "id": "…", "object": "member", "name": "Ava Reyes" } }
```

A collection:

```json
{
  "data": [ { "id": "…", "object": "member" } ],
  "pagination": { "page": 1, "pageSize": 50, "total": 132, "totalPages": 3 }
}
```

Creating something answers `201`; everything else that succeeds answers `200`.

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "duplicate_email",
    "message": "Ava Reyes already uses that email address.",
    "requestId": "req_3f9a1c0b7d2e4f6a8b1c2d3e"
  }
}
```

- `code` is stable and meant for programs. `message` is meant for people and may be reworded.
- `requestId` identifies this request; see [Request IDs](#request-ids).
- Validation errors add `details`: `[{ "field": "email", "message": "Enter a valid email address" }]`.
- Errors never contain stack traces or database messages.

| Status | Meaning | Common codes |
|---|---|---|
| 400 | The request is wrong | `validation_error`, `invalid_json`, `invalid_parameter`, `range_too_large`, `bad_request` |
| 401 | The key is missing or not accepted | `missing_api_key`, `invalid_api_key`, `api_key_revoked`, `api_key_expired` |
| 403 | The key is not allowed to do this | `insufficient_scope`, `subscription_read_only`, `member_limit` |
| 404 | No such resource in this gym, or no such endpoint | `not_found` |
| 409 | It conflicts with the current state | `duplicate_email`, `idempotency_key_reused`, `request_in_progress`, `conflict` |
| 422 | A booking or appointment rule forbids it | `class_full`, `already_booked`, `no_membership`, `membership_frozen`, `member_archived` and other rule codes |
| 429 | Too many requests | `rate_limited` |
| 500 | Something went wrong at ClubCheck | `internal_error` |

A resource that belongs to another gym answers `404`, exactly like one that does not exist.

The gym's own business rules apply to everything the API does, and their refusals come back with the rule's
code and a message that says what happened ("CrossFit is full.", "Sam's membership is frozen."). The set of rule
codes grows over time; treat an unknown `4xx` code as "refused, show the message".

## Request IDs

Every response, success or failure, has an `X-Request-Id` header (`req_` followed by 24 hex characters). Errors
repeat it in `error.requestId`. Log it. If something looks wrong, the gym can paste the ID into
**Settings → Developer / API → Request log** to see the request (method, path, status, error code, duration,
which key), and quote it to ClubCheck support. The log keeps 30 days and never records request bodies, query
strings or keys.

## Pagination

Every list is paginated. There is no way to ask for everything at once.

| Parameter | Default | Notes |
|---|---|---|
| `page` | `1` | 1-based |
| `pageSize` | `50` | Maximum `100`. A larger number is treated as `100`; the response says which size was used |

`pagination.total` is the number of matching rows; `totalPages` is how many pages that is. A page past the end
answers `200` with an empty `data` array. `page=0`, `pageSize=0` and non-numbers are `400 invalid_parameter`.

To walk a whole collection, request pages until `page >= totalPages`. When syncing changes, filter with
`updatedSince` (results then come oldest change first) so new changes land at the end rather than shifting the
pages you have already read.

## Filtering

Filters are query parameters. They combine with AND. An unknown value for a fixed list (`status=sleeping`) or a
badly formed date is `400 invalid_parameter`, not an empty result.

| Parameter | Where | Meaning |
|---|---|---|
| `updatedSince` | members, memberships, bookings, appointments, invoices, leads, workouts, workout-sessions | Changed at or after this time. Results are ordered oldest change first |
| `createdSince` | members, invoices, leads, payments | Created at or after this time |
| `createdBefore` | payments | Created before this time |
| `status` | most lists | One of that resource's statuses (listed under each resource) |
| `memberId` | memberships, bookings, appointments, attendance, payments, invoices, workout-sessions, program assignments | Belonging to one member |
| `locationId` | members, classes, appointments, attendance, leads | At one location |
| `from`, `to` | classes, bookings (the class's start), appointments, attendance | A time window |
| `search` | members, leads, workouts, programs | Case-insensitive match on name (and email or phone for people) |
| `email` | members, leads | Exact email address |

Location IDs appear on the resources themselves (`homeLocationId`, `locationId`).

## Rate limits

| Limit | Default |
|---|---|
| Per API key | 120 requests a minute |
| Per gym, all keys together | 600 requests a minute |

Limits are counted in fixed one-minute windows. One busy integration cannot use up the gym's whole allowance
unless it is the only one running, and it can never affect another gym.

Every authenticated response has:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | The limit that currently applies (the key's, or the gym's if that is the tighter one) |
| `X-RateLimit-Remaining` | Requests left in this window |
| `X-RateLimit-Reset` | When the window ends, as a Unix timestamp in seconds |

Over the limit, the answer is `429` with `error.code` `rate_limited` and a `Retry-After` header in seconds.
Wait that long and retry. Requests refused for rate limiting still count as requests.

## Idempotency

Networks fail in the middle of things. To make a write safe to retry, send an `Idempotency-Key` header with a
value unique to the operation (a UUID is ideal):

```bash
curl -X POST https://YOUR-CLUBCHECK-DOMAIN/api/v1/leads \
  -H "Authorization: Bearer $CLUBCHECK_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f1c2d8e-3b4a-4c5d-9e8f-7a6b5c4d3e2f" \
  -d '{"name":"Jordan Lee","email":"jordan@example.com","source":"Website"}'
```

- The first request does the work and its response is stored.
- A repeat with the **same key and the same body** gets the stored response back, with the header
  `Idempotent-Replayed: true`. Nothing is done twice: no second lead, booking, membership or webhook event.
- Repeats that arrive **while the first is still running** wait for it and get its response.
- The same key with a **different body** is `409 idempotency_key_reused`.
- A request that **failed** (any `4xx` or `5xx`) is not stored. Fix the problem and retry with the same key.
- Keys are scoped to the gym and to the endpoint, and are kept for at least 24 hours.

Supported on: `POST /members`, `POST /memberships`, `POST /memberships/{id}/{action}`, `POST /bookings`,
`POST /appointments`, `PATCH /appointments/{id}`, `POST /workouts/{id}/assign`,
`POST /programs/{id}/assignments`, `POST /leads`. The header is ignored elsewhere; `PATCH` and `DELETE` on a
member, lead or booking are naturally safe to repeat.

Without the header, the gym's own rules are still the backstop for some things (a member cannot be booked into
the same class twice, or put on the same program twice), but a lead or a member with a different email would be
created again. Send the header.

---

## Resources

`{id}` is the resource's `id`. Bodies show every accepted field; **bold** fields are required.

### Members — `members:read`, `members:write`

| Method | Path | |
|---|---|---|
| GET | `/members` | List. Filters: `updatedSince`, `createdSince`, `status` (`active`, `trial`, `past_due`, `frozen`, `cancelled`, `inactive`), `locationId`, `email`, `search`, `archived` (`false` default, `true`, `all`) |
| POST | `/members` | Create. Idempotent |
| GET | `/members/{id}` | Read |
| PATCH | `/members/{id}` | Update any of the create fields; `archived: false` restores |
| DELETE | `/members/{id}` | Archive. Nothing is erased |

Create body: **`name`**, **`email`**, `phone`, `dateOfBirth` (`YYYY-MM-DD`), `addressLine1`, `city`, `state`,
`postalCode`, `leadSource`, `emailOptIn`, `smsOptIn`, `homeLocationId`, `assignedStaffId`, `goals`.

```json
{
  "id": "5f0c…", "object": "member",
  "name": "Ava Reyes", "email": "ava@example.com", "phone": "555-0101", "status": "active",
  "dateOfBirth": "1991-04-12",
  "address": { "line1": "12 Dock St", "city": "Austin", "state": "TX", "postalCode": "78701" },
  "leadSource": "Website", "emailOptIn": true, "smsOptIn": false,
  "homeLocationId": null, "householdId": null, "creditBalanceCents": 0,
  "lastCheckInAt": "2026-10-06T22:14:09.000Z", "archivedAt": null,
  "createdAt": "2026-09-01T15:02:11.000Z", "updatedAt": "2026-10-06T22:14:09.000Z"
}
```

- A gym has one live member per email address: a second is `409 duplicate_email`.
- A member's `status` follows their memberships. It can be set by `PATCH` only for someone with no membership
  (`400 status_derived` otherwise); freeze or cancel the membership instead.
- `updatedAt` moves when anything about the member changes, including a check-in.
- Creating a member through the API does not send ClubCheck's welcome email.
- Not exposed: medical notes, emergency contacts, check-in codes, waiver signatures, portal links, card details.

### Membership plans — `memberships:read`

`GET /membership-plans` (`active=false` to include retired plans). What a membership can be started on:
`id`, `name`, `type`, `priceCents`, `billingInterval`, `intervalCount`, `trialDays`, `credits`.

### Memberships — `memberships:read`, `memberships:write`

| Method | Path | |
|---|---|---|
| GET | `/memberships` | List. Filters: `memberId`, `planId`, `status` (`trial`, `active`, `past_due`, `frozen`, `cancelled`, `expired`), `updatedSince` |
| POST | `/memberships` | Start one. Idempotent |
| GET | `/memberships/{id}` | Read |
| POST | `/memberships/{id}/freeze` | Body: `until` (optional date-time), `reason` |
| POST | `/memberships/{id}/unfreeze` | |
| POST | `/memberships/{id}/cancel` | Body: **`when`** (`now` or `period_end`), `reason` |
| POST | `/memberships/{id}/resume` | Withdraw a cancellation set for the period end |
| POST | `/memberships/{id}/change-plan` | Body: **`planId`**, `effective` (`next_period` default, or `now`), `preview` |

Start body: **`memberId`**, **`planId`**, `startDate`, `paymentMethod` (`card`, `ach`, `cash`, `check`, `other`;
default `other`), `discountPercent`, `couponCode`, `collectNow`, `skipTrial`, `locationId`.

The response is the membership plus the first `invoice` and, if a charge was attempted, `charge`.

- Starting a membership creates its first invoice exactly as selling it at the desk does. The invoice is left
  **open** unless `paymentMethod` is `card` or `ach` **and** `collectNow` is `true`, in which case the member's
  saved card or bank account is charged. The API cannot mark cash or a cheque as received.
- Freezing, cancelling and changing plan follow the plan's own rules (whether freezing is allowed, notice
  periods, contract terms). They cannot be overridden from the API.
- `change-plan` with `"preview": true` returns the proration (`object: "plan_change_preview"`) and changes
  nothing. Without it, the change is applied with those figures: `now` prorates and may create an invoice or
  account credit; `next_period` takes effect at the next billing date.

### Classes — `classes:read`

| Method | Path | |
|---|---|---|
| GET | `/classes` | The schedule between `from` and `to` (default: the next 7 days; at most 62 days). Filters: `locationId`, `classTypeId`, `coachId`, `status` (`scheduled` default, `cancelled`, `all`) |
| GET | `/classes/{id}` | One class |

```json
{
  "id": "c1…", "object": "class", "name": "CrossFit", "classTypeId": "…", "category": "group",
  "startsAt": "2026-10-09T22:00:00.000Z", "endsAt": "2026-10-09T23:00:00.000Z", "status": "scheduled",
  "capacity": 12, "waitlistCapacity": 5, "bookedCount": 9, "waitlistCount": 0, "spotsLeft": 3,
  "coach": { "id": "…", "name": "Marcus Thornton" }, "locationId": "…", "locationName": "Harbor East", "room": "Main floor",
  "workoutId": null, "recurring": true
}
```

### Bookings — `bookings:read`, `bookings:write`

| Method | Path | |
|---|---|---|
| GET | `/bookings` | List. Filters: `memberId`, `classId`, `status` (`booked`, `waitlisted`, `offered`, `attended`, `no_show`, `cancelled`, `late_cancelled`), `from`/`to` (class start), `updatedSince` |
| POST | `/bookings` | Body: **`classId`**, **`memberId`**, `joinWaitlist`. Idempotent |
| GET | `/bookings/{id}` | Read |
| DELETE | `/bookings/{id}` | Cancel |

- Capacity, membership eligibility, class credits, and clashes with the member's other bookings and
  appointments are enforced as they are at the front desk. Like a booking made by staff, an API booking is not
  held to the members' booking window or cutoff.
- A full class is `422 class_full` unless `joinWaitlist` is `true`, in which case the booking is created with
  status `waitlisted` and the response includes `waitlistPosition`.
- Cancelling applies the gym's late-cancellation rule; the response says `late` and `creditReturned`. Cancelling
  frees the spot for the waitlist.

### Appointments — `appointments:read`, `appointments:write`

| Method | Path | |
|---|---|---|
| GET | `/appointment-types` | What can be booked, with duration, price and the staff who offer it |
| GET | `/appointments/slots` | Free start times. **`typeId`**, **`date`** (`YYYY-MM-DD`, gym's timezone), `staffId`, `locationId`, `memberId` |
| GET | `/appointments` | List. Filters: `from`, `to`, `memberId`, `staffId`, `locationId`, `status` (`booked`, `completed`, `cancelled`, `late_cancelled`, `no_show`), `updatedSince` |
| POST | `/appointments` | Body: **`typeId`**, **`memberId`**, **`startsAt`**, `staffId` (omit for anyone free), `locationId`, `notes`. Idempotent |
| GET | `/appointments/{id}` | Read |
| PATCH | `/appointments/{id}` | Move it. Body: **`startsAt`**, `staffId`. Idempotent |
| DELETE | `/appointments/{id}` | Cancel. Optional `?reason=` |

- Ask `/appointments/slots` first and book one of the times it returns. Working hours, time off, minimum
  notice, the advance limit, and clashes (the coach's and the member's) are enforced; none can be overridden
  from the API. A time that is not free, or was just taken, is refused with a `4xx` and a message saying why.
- Session credits and payment follow the appointment type. If the type must be paid for and the member's saved
  payment method is declined, the appointment is cancelled and the response shows that.
- Cancelling applies the type's cancellation window; the response says `late`, `creditsReturned` and `refunded`.

### Attendance — `attendance:read`

`GET /attendance` (filters: `memberId`, `classId`, `locationId`, `from`, `to`; newest first) and
`GET /attendance/{id}`. Each is one check-in: `memberId`, `checkedInAt`, `type` (`open_gym`, `class`,
`personal_training`), `source`, `classId`, `locationId`.

### Payments — `payments:read` (read only)

`GET /payments` and `GET /payments/{id}`. Filters: `memberId`, `invoiceId`, `type` (`payment`, `refund`),
`status` (`succeeded`, `failed`, `pending`, `processing`), `method`, `createdSince`, `createdBefore`,
`processorReference`.

```json
{
  "id": "t9…", "object": "payment", "type": "payment", "status": "succeeded",
  "amountCents": 15000, "refundedCents": 0, "currency": "usd",
  "memberId": "5f0c…", "payerMemberId": null, "invoiceId": "in…", "locationId": null,
  "method": "card", "cardLast4": "4242", "processor": "stripe", "processorReference": "pi_3Q…",
  "failureReason": null, "refundReason": null, "refundOfPaymentId": null, "disputeStatus": null,
  "createdAt": "2026-10-01T09:00:03.000Z"
}
```

A refund is its own row with `type: "refund"` and `refundOfPaymentId` pointing at the payment; the payment's
`refundedCents` is the running total. `processorReference` is the payment processor's own ID (a Stripe payment
intent, for card and bank payments), useful for reconciling against a processor export. Searching by it only
ever looks inside the key's own gym.

### Invoices — `invoices:read` (read only)

`GET /invoices` and `GET /invoices/{id}`. Filters: `memberId`, `membershipId`, `status` (`draft`, `open`, `paid`,
`void`, `uncollectible`), `number`, `createdSince`, `updatedSince`. Each has `number`, the totals
(`subtotalCents`, `discountCents`, `taxCents`, `totalCents`, `amountPaidCents`, `refundedCents`, `balanceCents`),
`dueDate`, `paidAt`, the billing period, and `items`.

### Workouts — `workouts:read`, `workouts:write`

| Method | Path | |
|---|---|---|
| GET | `/workouts` | List. Filters: `search`, `archived`, `updatedSince` |
| GET | `/workouts/{id}` | The workout as currently prescribed, with `instructions` and `blocks` |
| POST | `/workouts/{id}/assign` | Body: **`memberIds`**, **`date`** (`YYYY-MM-DD`), `coachId`. Idempotent |
| GET | `/workout-sessions` | What members were given and finished. Filters: `memberId`, `workoutId`, `programAssignmentId`, `status` (`not_started`, `in_progress`, `completed`, `skipped`), `completedSince`, `updatedSince` |

A workout is versioned; `version` says which is current. A workout session records the `workoutVersionId` the
member was actually given, its `status`, `completedAt`, `durationSec` and `result` (`timeSec`, or `rounds` and
`reps`, for scored workouts). Coaches' private notes are never included.

### Programs — `programs:read`, `programs:write`

| Method | Path | |
|---|---|---|
| GET | `/programs` | List. Filters: `search`, `archived` |
| GET | `/programs/{id}` | With `days`: `week`, `day` (1 = Monday … 7 = Sunday), `workoutId` |
| GET | `/programs/{id}/assignments` | Who is on it. Filters: `memberId`, `status` (`scheduled`, `active`, `paused`, `completed`, `cancelled`) |
| POST | `/programs/{id}/assignments` | Body: **`startDate`**, and **`memberIds`** or **`planId`**; `endDate`, `coachId`. Idempotent |

Assigning answers `{ "assigned": [program_assignment, …], "alreadyOn": [memberId, …] }`. A member already on the
program is skipped, not assigned twice. `planId` assigns everyone who holds that membership plan at that moment.

### Leads — `leads:read`, `leads:write`

| Method | Path | |
|---|---|---|
| GET | `/leads` | List. Filters: `status`, `source`, `email`, `search`, `locationId`, `createdSince`, `updatedSince` |
| POST | `/leads` | Create. Idempotent |
| GET | `/leads/{id}` | Read |
| PATCH | `/leads/{id}` | Update details or move it along the pipeline |

Create body: **`name`**, **`email`**, `phone`, `source`, `interest`, `notes`, `assignedStaffId`, `locationId`,
`estimatedValueCents`, `nextFollowUpAt`. Update also accepts `trialDate`, `lostReason` and `status`.

Statuses: `new`, `contacted`, `trial_scheduled`, `trial_completed`, `follow_up`, `lost`, and `converted`.
`converted` is set by ClubCheck when staff convert the lead to a member (`convertedMemberId` then points at the
member); it cannot be set through the API. A lead created through the API appears in the gym's pipeline at once
and starts any "new lead" automation the gym has set up.

---

## Webhooks

A webhook is an HTTP `POST` that ClubCheck sends to a URL you choose when something happens in the gym.

### Setting one up

In **Settings → Developer / API → Webhooks**, add an endpoint: its URL, an optional description, and the events
it should receive (or all of them). ClubCheck then shows the endpoint's **signing secret** (`whsec_…`) **once**.
Store it with the receiving software. A lost secret cannot be recovered: use **New secret**, which replaces it
immediately.

- The URL must be `https`.
- A gym can have up to 10 endpoints. Each can be switched off and on, edited, tested and removed.
- **Send test** posts a `webhook.test` event straight away and reports how the endpoint answered.

### What is sent

```
POST /webhooks/clubcheck HTTP/1.1
Content-Type: application/json
User-Agent: ClubCheck-Webhooks/1.0
ClubCheck-Event-Id: evt_8c1f0a2b3d4e5f6a7b8c9d0e
ClubCheck-Event-Type: lead.created
ClubCheck-Delivery-Id: 0b6c…
ClubCheck-Timestamp: 1791400000
ClubCheck-Signature: v1=5f2b…e91a
```

```json
{
  "id": "evt_8c1f0a2b3d4e5f6a7b8c9d0e",
  "type": "lead.created",
  "apiVersion": "v1",
  "createdAt": "2026-10-07T18:26:40.000Z",
  "data": {
    "object": { "id": "9d2e…", "object": "lead", "name": "Jordan Lee", "email": "jordan@example.com", "status": "new", "source": "Website" }
  }
}
```

`data.object` is the resource exactly as the API returns it, as it was when the event happened.

### Answering

Answer with any `2xx` status within **10 seconds**. The body is ignored. Do the real work after answering (put
the event on a queue): a slow receiver looks like a failing one. Redirects are not followed and count as
failures.

### Verifying the signature

Anyone can post to your URL. The signature proves a request came from ClubCheck and was not altered.

1. Take the **raw request body**, byte for byte, before any JSON parsing.
2. Build the string `<ClubCheck-Timestamp>.<raw body>`.
3. Compute HMAC-SHA256 of it with the endpoint's signing secret, as lowercase hex.
4. Compare `v1=<that hex>` with the `ClubCheck-Signature` header, using a constant-time comparison.
5. Reject the request if they differ, or if the timestamp is more than five minutes from your clock.

```js
// Node.js (Express). The raw body is needed: use express.raw, not express.json, on this route.
import crypto from 'node:crypto'

app.post('/webhooks/clubcheck', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('ClubCheck-Timestamp')
  const expected = 'v1=' + crypto.createHmac('sha256', process.env.CLUBCHECK_WEBHOOK_SECRET)
    .update(`${timestamp}.${req.body.toString('utf8')}`).digest('hex')
  const given = req.get('ClubCheck-Signature') || ''
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  if (!ok || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.status(400).end()

  const event = JSON.parse(req.body.toString('utf8'))
  if (alreadyHandled(event.id)) return res.status(200).end()   // see "Duplicates" below
  queue.add(event)
  res.status(200).end()
})
```

```python
# Python (Flask)
import hashlib, hmac, os, time
from flask import request, abort

@app.post("/webhooks/clubcheck")
def clubcheck_webhook():
    timestamp = request.headers.get("ClubCheck-Timestamp", "")
    body = request.get_data()  # raw bytes
    expected = "v1=" + hmac.new(os.environ["CLUBCHECK_WEBHOOK_SECRET"].encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("ClubCheck-Signature", "")):
        abort(400)
    if abs(time.time() - int(timestamp)) > 300:
        abort(400)
    event = request.get_json()
    ...
    return "", 200
```

### Retries

If the endpoint does not answer `2xx` in time, the delivery is retried with growing gaps:

| Attempt | Sent |
|---|---|
| 1 | Straight away |
| 2 | 1 minute after the first failure |
| 3 | 5 minutes later |
| 4 | 30 minutes later |
| 5 | 2 hours later |
| 6 | 6 hours later |
| 7 | 24 hours later |

After the seventh attempt fails, the delivery is marked **Failed** and is not sent again by itself. Timing is
approximate: retries are sent by a background job and can run late, never early.

Every delivery, with each attempt's status code and timing and the exact payload, is listed under
**Settings → Developer / API → Deliveries**. Any delivery that has not succeeded can be sent again from there
with **Retry**. An endpoint that fails 20 events outright with no success in between is switched off and marked
so; switch it back on when the receiver is fixed.

### Duplicates: use the event ID

- Every event has a unique `id` (`evt_…`), in the body and in the `ClubCheck-Event-Id` header.
- **A retry, automatic or by hand, sends the same event ID and the same body, byte for byte.** Only the
  timestamp and signature headers are new.
- One thing happening in the gym produces **one** event, however it was done (the staff app, the member app, the
  API, a background job) and however many times the request that caused it was retried.

So: record the IDs of events you have processed, and when one arrives again, answer `2xx` and do nothing. A
receiver that answered too slowly, or crashed after doing its work, will be sent the event again; the ID is how
it knows.

Events are sent as they happen but are not guaranteed to arrive in order (a retry can land after a newer
event). When order matters, compare `createdAt`, or use the event as a signal and fetch the resource.

### Event catalog

| Event | When | `data.object` |
|---|---|---|
| `member.created` | A member was added | member |
| `member.updated` | A member's details or status changed | member |
| `member.archived` | A member was archived | member |
| `membership.created` | A membership was sold or started | membership |
| `membership.updated` | A membership changed: plan, price, past due, or set to end (or not to) at its period end | membership |
| `membership.cancelled` | A membership ended | membership |
| `membership.frozen` | A membership was frozen | membership |
| `membership.resumed` | A frozen membership was resumed | membership |
| `booking.created` | A member was booked into a class, or joined its waitlist | booking |
| `booking.updated` | A booking changed: off the waitlist, offered a spot, or marked a no-show | booking |
| `booking.cancelled` | A class booking was cancelled (by anyone, or because the class was) | booking |
| `booking.checked_in` | A booked member was checked in to the class | booking |
| `appointment.created` | An appointment was booked | appointment |
| `appointment.updated` | An appointment was moved | appointment |
| `appointment.cancelled` | An appointment was cancelled | appointment |
| `appointment.completed` | An appointment was marked completed | appointment |
| `appointment.no_show` | An appointment was marked as a no-show | appointment |
| `payment.succeeded` | A payment was taken | payment |
| `payment.failed` | A payment attempt failed | payment (the failed attempt) |
| `payment.refunded` | A payment was refunded, fully or partly | payment (the original, with `refundedCents` updated) |
| `invoice.created` | An invoice was created | invoice |
| `invoice.paid` | An invoice was paid in full | invoice |
| `invoice.failed` | Collecting an invoice failed | invoice |
| `workout.completed` | A member completed a workout | workout_session |
| `program.assigned` | A program was assigned to a member | program_assignment |
| `program.completed` | A member's program finished | program_assignment |
| `lead.created` | A lead was added | lead |
| `lead.updated` | A lead's details or stage changed, or it was converted | lead |
| `webhook.test` | Someone pressed **Send test** | `{ "message": "…" }` |

New event types will be added. An endpoint subscribed to "all events" receives them automatically, so ignore
types you do not recognise rather than failing.

One action in the gym can produce several events, each about a different thing. Selling a membership produces
`membership.created`, `invoice.created`, and `member.updated` if the member's status changed.

---

## Recipes

Set `BASE=https://YOUR-CLUBCHECK-DOMAIN/api/v1` and `KEY` to an API key.

### A website lead form — `leads:write`

Post from **your server**, never from the browser, so the key stays private.

```bash
curl -X POST "$BASE/leads" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Jordan Lee","email":"jordan@example.com","phone":"555-0144","source":"Website","interest":"Personal training","notes":"Prefers mornings"}'
```

`201` with the lead. It is in the gym's sales pipeline immediately.

### Keeping a CRM in step — `members:read`

```bash
# First run: everything, page by page
curl "$BASE/members?pageSize=100&page=1" -H "Authorization: Bearer $KEY"

# Afterwards: only what changed since the last run, oldest change first
curl "$BASE/members?updatedSince=2026-10-07T00:00:00Z&pageSize=100" -H "Authorization: Bearer $KEY"
```

Remember the `updatedAt` of the last row you processed and use it as the next `updatedSince` (rows changed in
that same instant come again; upsert by `id`). Add `archived=all` to learn about archived members too. Or
subscribe to `member.created`, `member.updated` and `member.archived` and skip polling.

### Booking from another system — `classes:read`, `bookings:write`

```bash
curl "$BASE/classes?from=2026-10-09T00:00:00Z&to=2026-10-10T00:00:00Z" -H "Authorization: Bearer $KEY"

curl -X POST "$BASE/bookings" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"classId":"c1…","memberId":"5f0c…","joinWaitlist":true}'

curl -X DELETE "$BASE/bookings/b7…" -H "Authorization: Bearer $KEY"
```

### Appointments — `appointments:read`, `appointments:write`

```bash
curl "$BASE/appointment-types" -H "Authorization: Bearer $KEY"
curl "$BASE/appointments/slots?typeId=at…&date=2026-10-10" -H "Authorization: Bearer $KEY"

curl -X POST "$BASE/appointments" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"typeId":"at…","memberId":"5f0c…","startsAt":"2026-10-10T14:00:00.000Z"}'

curl -X PATCH "$BASE/appointments/ap…" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"startsAt":"2026-10-10T18:00:00.000Z"}'

curl -X DELETE "$BASE/appointments/ap…?reason=Client%20asked%20to%20cancel" -H "Authorization: Bearer $KEY"
```

### Accounting — `invoices:read`, `payments:read`

```bash
curl "$BASE/invoices?updatedSince=2026-10-01T00:00:00Z&pageSize=100" -H "Authorization: Bearer $KEY"
curl "$BASE/payments?createdSince=2026-10-01T00:00:00Z&createdBefore=2026-11-01T00:00:00Z&status=succeeded&pageSize=100" -H "Authorization: Bearer $KEY"
```

Revenue for a period is succeeded rows of `type: "payment"` minus succeeded rows of `type: "refund"`. Match card
and bank payments to the processor's payout report with `processorReference`.

### Coaching — `workouts:read`, `programs:read`

```bash
curl "$BASE/programs" -H "Authorization: Bearer $KEY"
curl "$BASE/programs/pr…/assignments?status=active" -H "Authorization: Bearer $KEY"
curl "$BASE/workout-sessions?memberId=5f0c…&status=completed&completedSince=2026-10-01T00:00:00Z" -H "Authorization: Bearer $KEY"
curl "$BASE/workouts/w3…" -H "Authorization: Bearer $KEY"
```

---

## Limits and things to know

- **Payments and invoices are read only.** There is no endpoint to take, record or refund a payment.
- **There is no hard delete.** `DELETE /members/{id}` archives; bookings and appointments are cancelled.
- **Not in v1:** creating or editing classes, class types, appointment types, membership plans, workouts,
  programs, products, staff or locations; point-of-sale orders; messages and campaigns; households; waivers and
  documents; set-by-set workout logs and personal records; member sign-in. A gym's locations and staff have no
  list endpoint; their IDs appear on other resources.
- **Staff overrides are not available.** Where the staff app lets a person waive a late-cancellation fee, book
  outside working hours, or skip a notice period, the API always applies the rule.
- **An unsupported method on a real path** (for example `PUT /members/{id}`) answers `405` with an empty body
  rather than the JSON error shape.
- **Sandbox.** There is no separate test mode. Use a separate ClubCheck account for development.
- **Webhook timing** depends on ClubCheck's background job for retries, and for events caused by background work
  (the nightly billing run, for instance); these can arrive a little after the fact.
