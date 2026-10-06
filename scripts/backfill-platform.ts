// Upgrade existing accounts to the platform data model.
//
//   npx tsx scripts/backfill-platform.ts                     # dry run, every account
//   npx tsx scripts/backfill-platform.ts --apply             # write changes
//   npx tsx scripts/backfill-platform.ts --apply --owner <id>
//   npx tsx scripts/backfill-platform.ts --apply --convert-manual-billing
//
// Uses DATABASE_URL from the environment (.env). Run `npx prisma db push` first
// so the new tables exist. Idempotent: running it twice changes nothing more.

import 'dotenv/config'

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const convertManualBilling = args.includes('--convert-manual-billing')
  const only = args.includes('--owner') ? args[args.indexOf('--owner') + 1] : null
  const { prisma } = await import('../lib/prisma')
  const { backfillOwner } = await import('../lib/services/backfill')

  let host = 'unknown'
  try { host = new URL(process.env.DATABASE_URL || '').hostname } catch {}
  console.log(`${apply ? 'APPLYING' : 'Dry run'} against ${host}${convertManualBilling ? ' (including manual billing conversion)' : ''}`)

  const owners = await prisma.owner.findMany({ where: only ? { id: only } : {}, select: { id: true, email: true } })
  const totals = { locations: 0, payments: 0, memberships: 0, plans: 0 }
  for (const owner of owners) {
    const r = await backfillOwner(owner.id, { dryRun: !apply, convertManualBilling })
    if (r.locationCreated || r.paymentsCopied || r.membershipsCreated) {
      console.log(`  ${owner.email}: ${r.locationCreated ? 'location, ' : ''}${r.paymentsCopied} payments, ${r.membershipsCreated} memberships (${r.plansCreated} plans)`)
    }
    totals.locations += Number(r.locationCreated)
    totals.payments += r.paymentsCopied
    totals.memberships += r.membershipsCreated
    totals.plans += r.plansCreated
  }
  console.log(`${owners.length} accounts checked.`, totals)
  if (!apply) console.log('Nothing was written. Re-run with --apply to make these changes.')
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
