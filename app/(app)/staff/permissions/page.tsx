'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { Check, ChevronLeft } from 'lucide-react'
import { PERMISSIONS, ROLES, ROLE_KEYS, type Permission } from '@/lib/permissions'
import { Card, Page, PageHeader } from '@/components/ui'

const GROUPS: [string, Permission[]][] = [
  ['Members', ['members.view', 'members.manage', 'members.delete', 'memberships.manage']],
  ['Billing', ['billing.view', 'billing.manage', 'billing.refund']],
  ['Classes & attendance', ['classes.view', 'classes.manage', 'bookings.manage', 'attendance.manage']],
  ['Sales & POS', ['leads.view', 'leads.manage', 'pos.sell', 'pos.manage']],
  ['Reports', ['reports.view', 'reports.financial']],
  ['Communication', ['communication.send', 'automations.manage']],
  ['Administration', ['staff.manage', 'locations.manage', 'settings.manage', 'audit.view']],
]

export default function PermissionsPage() {
  return (
    <Page>
      <Link href="/staff" className="ui-focus mb-3 inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg"><ChevronLeft className="h-4 w-4" />Staff</Link>
      <PageHeader title="Roles & permissions" description="What each role can do. Permissions are enforced on the server for every request, not just hidden in the menu." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROLE_KEYS.map((r) => <Card key={r}><p className="font-semibold text-fg-heading">{ROLES[r].label}</p><p className="mt-1 text-sm text-fg-muted">{ROLES[r].description}</p></Card>)}
      </div>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left text-xs font-medium text-fg-subtle sm:px-5">Permission</th>
                {ROLE_KEYS.map((r) => <th key={r} scope="col" className="px-2 py-2.5 text-center text-xs font-medium text-fg-subtle">{ROLES[r].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(([group, keys]) => (
                <Fragment key={group}>
                  <tr><th colSpan={ROLE_KEYS.length + 1} scope="colgroup" className="border-t border-line bg-subtle/60 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-fg-subtle sm:px-5">{group}</th></tr>
                  {keys.map((p) => (
                    <tr key={p} className="border-t border-line/60">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal text-fg sm:px-5">{PERMISSIONS[p]}</th>
                      {ROLE_KEYS.map((r) => (
                        <td key={r} className="px-2 py-2 text-center">
                          {ROLES[r].permissions.includes(p) ? <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Allowed" /> : <span className="text-fg-subtle" aria-label="Not allowed">–</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  )
}
