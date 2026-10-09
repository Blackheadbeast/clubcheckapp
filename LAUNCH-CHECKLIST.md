# ClubCheck launch checklist

Written after the production-hardening pass on 2026-10-08. Everything from Priorities 1–12 is on the
`phase-2-payments` branch, uncommitted. Production is still running the commit from 2026-10-06 and its
database has none of the schema changes below.

Three kinds of item:

- **BLOCKER**: must be done before the new code serves real customers.
- **SETUP**: safe in code; needs an action outside the codebase.
- **LATER**: needed only to turn on one feature.

Do the steps in this order. Nothing here is destructive.

## 1. Database (BLOCKER)

The new code needs 57 new tables and about 40 new columns on six existing tables. Every change is
additive: new tables, new nullable or defaulted columns, new indexes and foreign keys. Nothing is
dropped, renamed or retyped, and no unique index is added to a table that already has rows. The exact
SQL, generated from the deployed schema to the current one, is in
`docs/release/phase-2-schema-changes.sql`.

This repository deploys its schema with `prisma db push` (the one file under `prisma/migrations` is
the original baseline and is not used).

1. Take a backup or confirm a recent one exists (your database provider's console).
2. Preview against production. This only reads:

   ```bash
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/prod-preview.sql
   grep -nE "DROP |ALTER COLUMN|RENAME " /tmp/prod-preview.sql    # must print nothing
   ```

   If that grep prints anything, stop: production is not at the schema this was prepared from.
3. Apply:

   ```bash
   npx prisma db push
   ```

   Never pass `--accept-data-loss` or `--force-reset`. If Prisma asks to confirm data loss, answer no and stop.
4. Deploy the code only after step 3 succeeds. The old code keeps working against the new schema
   (the changes are additive), so there is no window in which the live site is broken.

## 2. Environment variables

Set in the hosting dashboard for Production. Names only; values come from each provider.

| Variable | Needed for | Kind | Without it |
|---|---|---|---|
| `DATABASE_URL` | Everything | BLOCKER | App does not start |
| `JWT_SECRET` | Staff, member and booking sessions, signed download links | BLOCKER | App refuses to sign anyone in |
| `NEXT_PUBLIC_APP_URL` | Every link in every email, booking links, embed code, Twilio signatures | BLOCKER | Links fall back to the request's own address |
| `CRON_SECRET` | Scheduled jobs | BLOCKER | Every scheduled job is refused (401): no billing run, no reminders |
| `RESEND_API_KEY`, `EMAIL_FROM` | All email | BLOCKER | No email is sent (verification, invitations, signing links, receipts) |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ClubCheck's own subscription and member payments | BLOCKER for payments | No card payments |
| `STRIPE_WEBHOOK_SECRET` | ClubCheck's own subscription webhook (`/api/stripe/webhook`) | BLOCKER for subscriptions | Webhook answers 503; subscription changes are not recorded |
| `STRIPE_PRICE_ID_STARTER`, `_PRO`, `_STARTER_YEARLY`, `_PRO_YEARLY` | Subscription checkout | BLOCKER for subscriptions | Checkout fails |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Member payments webhook (`/api/webhooks/stripe-connect`) | BLOCKER for member payments | Webhook answers 503; bank debits, disputes and account status never update |
| `WEBHOOK_ENCRYPTION_KEY` | Outbound webhooks (Settings → Developer) | SETUP | Creating a webhook answers "not configured". Set it once and never change it: stored webhook secrets are encrypted with it |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Sign in with Google" | SETUP | That button does not work |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` | Texting | LATER | Texting is off; the app says so |
| `TWILIO_WEBHOOK_BASE_URL` | Only if Twilio calls a different address than `NEXT_PUBLIC_APP_URL` | LATER | Uses `NEXT_PUBLIC_APP_URL` |
| `RESEND_WEBHOOK_SECRET` | Email bounce and open tracking | LATER | Webhook answers 503 |
| `STRIPE_CONNECT_FEE_BPS` | A platform fee on member payments | Optional | No fee (0) |
| `FILE_STORAGE`, `FILE_STORAGE_DIR` | Where signed-document PDFs are cached | Optional | PDFs are drawn from the signed record on each download |
| `LOGTAIL_SOURCE_TOKEN` | Shipping logs to Better Stack | Optional | Logs stay in the host's log viewer |
| `DATABASE_POOL_MAX` | Database connections per instance | Optional | Driver default |

Must **not** be set in production: `PAYMENT_PROVIDER`, `SMS_PROVIDER` (both are ignored there anyway),
`WEBHOOK_ALLOW_PRIVATE`, `SEED_ALLOW_REMOTE`.

Two things found in the local files that are worth fixing:

- The `JWT_SECRET` in the local `.env` is the same one production uses, and `.env` points
  `DATABASE_URL` at the production database. Anyone with this laptop's files can sign in as anyone.
  Give production its own secret (everyone is signed out once), and point local `.env` at a local database.
- Production currently has Stripe **test** keys. See section 4.

## 3. Scheduled jobs

`vercel.json` schedules two, daily:

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/platform` | 08:00 daily | Membership billing, payment retries, class generation, no-shows, appointment reminders, automations, campaigns, document expiry and reminders, payroll sync, webhook retries |
| `/api/cron/billing-reminders` | 09:00 daily | Reminder emails for members on the older simple billing (see the note below) |

A third exists and is **not** scheduled, because Vercel's Hobby plan only allows daily jobs:

| Path | Wanted | What it does |
|---|---|---|
| `/api/cron/messages` | Every 1–5 minutes | Sends queued and scheduled messages on time, retries failures, expires waitlist offers |

- **SETUP:** schedule `/api/cron/messages` every few minutes: either Vercel Pro (add it to
  `vercel.json` as `*/5 * * * *`) or any outside scheduler calling it with the header
  `Authorization: Bearer <CRON_SECRET>`. Without it, messages still go out when someone uses the app
  and once a day; "1 hour before" reminders, scheduled campaigns and waitlist deadlines are late.
- **SETUP:** `/api/cron/platform` is allowed 300 seconds. On a plan that caps functions lower, a
  large number of gyms will not finish in one run. Every step is safe to repeat, so the next run
  picks up where it stopped.
- **Note:** the billing-reminder job has been refused (401) on every run since it was added,
  because it looked for its secret in the wrong place. That is fixed. From the first run after
  deploy it **will start emailing** members who have the older "billing enabled" settings and
  marking them overdue. If you do not want that, remove it from `vercel.json` before deploying.

All three accept the secret only as a header, never in the URL.

## 4. Stripe

Validated in **test mode** on 2026-10-08 against real Stripe with live webhooks: 93 checks of the
member-payment flow, 49 of plan changes and credits, and a browser run of the public booking page
with real card entry (success, declined, 3-D Secure, double click). Nothing has been run in live mode.

- **SETUP:** in the Stripe dashboard, live mode: enable Connect, and create two webhook endpoints:
  - `https://<your domain>/api/stripe/webhook` (your account's events: `checkout.session.completed`,
    `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`,
    `customer.subscription.deleted`) → its signing secret is `STRIPE_WEBHOOK_SECRET`.
  - `https://<your domain>/api/webhooks/stripe-connect` with "Listen to events on connected
    accounts" (`account.updated`, `account.application.deauthorized`, `payment_intent.succeeded`,
    `payment_intent.processing`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`,
    `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
    `setup_intent.succeeded`, `payment_method.updated`, `payment_method.automatically_updated`,
    `payment_method.detached`) → its signing secret is `STRIPE_CONNECT_WEBHOOK_SECRET`.
- **SETUP:** replace the test keys with live keys and live price IDs.
- **SETUP:** make one small real payment through a connected gym and refund it before inviting customers.

## 5. Texting (LATER)

Not validated: there are no Twilio credentials in this environment. The adapter is tested against
a simulated provider only. Before turning texting on:

1. Twilio account, a number or messaging service, and **A2P 10DLC registration** (brand and
   campaign) for US numbers. Unregistered traffic is filtered by carriers.
2. Set the `TWILIO_*` variables.
3. On the number or messaging service: "A message comes in" → `POST https://<your domain>/api/webhooks/twilio/inbound`;
   status callback → `POST https://<your domain>/api/webhooks/twilio/status`.
4. With your own phone: send a text from a member's profile; confirm it shows delivered; reply and see
   it in the inbox; send STOP and confirm the next text is refused; send START and confirm it sends again.

## 6. Email

- **SETUP:** verify the sending domain in Resend so `EMAIL_FROM` is not `onboarding@resend.dev`.

## 7. Backups and monitoring

None of this exists in the codebase; each is a setting somewhere else.

- **SETUP:** confirm automatic database backups and try one restore into a scratch database.
- **SETUP:** error alerts. The code writes structured logs; set `LOGTAIL_SOURCE_TOKEN` or use the
  host's log drain, and alert on `"[cron]"`, `"[stripe-connect]"`, `"[twilio]"`, `"[webhooks]"` and
  `"[payroll]"` error lines.
- **SETUP:** in Stripe and Twilio, turn on email alerts for failing webhook endpoints.
- Failed member payments, failed messages and failed outbound webhooks are visible in the app
  (Billing → Failed payments, Communication → Sent messages, Settings → Developer).

## 8. After deploying

1. Sign in as the owner; open Dashboard, Members, Billing, Documents, Payroll.
2. `curl -H "Authorization: Bearer $CRON_SECRET" https://<your domain>/api/cron/platform` returns 200 with totals.
3. In Stripe, send a test event to each webhook endpoint: both answer 200.
4. Open `https://<your domain>/book/<a gym's address>` in a private window.
5. Check the response headers of `/dashboard` (`X-Frame-Options: DENY`) and of `/book/...` (no `X-Frame-Options`).

## 9. Security notes for whoever hosts this

- Rate limits, audit entries and the address recorded with an e-signature use the caller address from the
  hosting platform's own headers (`x-vercel-forwarded-for`, `x-real-ip`). On Vercel these cannot be forged. Behind
  any other proxy, make sure it sets `x-real-ip` itself and strips any copy the caller sent.
- Changing `JWT_SECRET` signs everyone out. Changing a password signs that person out everywhere else.
- The platform administrator is the verified account holder of an address listed in `lib/admin.ts`. Make sure
  that account exists and is verified before launch.
- Before taking on a gym with compliance requirements, commission an independent penetration test (see the
  security audit report).
