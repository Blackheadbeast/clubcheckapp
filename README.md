# ClubCheck

Fitness business management for gyms and studios: members and memberships, billing, class scheduling and
booking with waitlists, front-desk and kiosk check-in, leads, point of sale, messaging and automations,
reporting, staff roles, multiple locations and a mobile member portal.

Next.js 14 (App Router) · Prisma · PostgreSQL · Tailwind.

## Local setup

```bash
npm install
npm run db:dev                                  # starts a local Postgres (prisma dev)
DATABASE_URL="postgres://postgres:postgres@localhost:51214/template1?sslmode=disable" npx prisma db push
npm run seed                                    # demo gym with ~14 months of data
npm run dev
```

Create `.env.development.local` with the local `DATABASE_URL` (and `DATABASE_POOL_MAX=1`) so `next dev`, the seed and
the tests use the local database instead of the one in `.env`.

Demo sign-ins (password `clubcheck-demo`):

- Owner: `owner@ironharbor.test` at `/login`
- Staff at `/staff-login`, gym code `IRONHB`: `renee@` (admin), `theo@` (manager), `jasmine@` (front desk),
  `marcus@` (coach), `tyrell@` (trainer), `bianca@` (sales), `walter@` (accountant), all `@ironharbor.test`
- Kiosk PIN `1234`

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Vitest. Refuses to run unless the database is local |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Rebuild the demo gym (local database only) |
| `npx tsx scripts/backfill-platform.ts` | Upgrade existing accounts to the platform data model (dry run by default) |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it is put together, the rules that matter, what is not
built yet, and how to release to an existing database.
