// A real PostgreSQL server for local integration runs (the default `prisma dev`
// database is PGlite, which cannot serve two processes at once, so anything
// involving live webhooks needs this instead).
//
//   npx tsx scripts/local-postgres.ts        # runs until stopped; data in .pgdata-test/
//   postgres://postgres:postgres@localhost:54329/clubcheck_test

import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), '.pgdata-test')
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 54329, persistent: true, onLog: () => {}, onError: (e) => console.error(e) })

async function main() {
  if (!existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise()
  await pg.start()
  try { await pg.createDatabase('clubcheck_test') } catch {}
  console.log('postgres ready on 54329')
  const stop = async () => { await pg.stop(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
main().catch((e) => { console.error(e); process.exit(1) })
