'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { qs, useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Page, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Stat, StatusBadge, Table, Td, Th } from '@/components/ui'
import { DeliveryNotice } from '@/components/DeliveryNotice'

interface Row { id: string; channel: string; subject: string | null; body: string; status: string; error: string | null; toAddress: string | null; createdAt: string; member: { id: string; name: string } | null; prospect: { id: string; name: string } | null; campaign: { name: string } | null; automation: { name: string } | null }

export default function MessagesPage() {
  const { dateTime } = useSession()
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Row | null>(null)
  const debounced = useDebounced(search)
  useEffect(() => setPage(1), [channel, status, source, debounced])
  const { data, meta, error, loading, reload } = useApi<Row[]>(`/api/messages${qs({ channel, status, source, search: debounced, page })}`)
  const last30 = (meta?.last30 || {}) as Record<string, number>
  const delivered = (last30.sent || 0) + (last30.delivered || 0) + (last30.opened || 0) + (last30.clicked || 0)
  const opened = (last30.opened || 0) + (last30.clicked || 0)

  return (
    <Page>
      <PageHeader title="Messages" description="Every email and text sent to members and leads." actions={<Link href="/communication/campaigns?new=1"><Button variant="primary">New campaign</Button></Link>} />
      <DeliveryNotice delivery={meta?.delivery as { email: boolean; sms: boolean } | undefined} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sent, 30 days" value={delivered} />
        <Stat label="Opened" value={opened} hint={delivered ? `${Math.round((opened / delivered) * 100)}% of sent` : undefined} />
        <Stat label="Failed" value={last30.failed || 0} />
        <Stat label="Skipped" value={last30.skipped || 0} hint="Opted out, no address, or channel not connected" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search recipient or subject" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <Select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-auto"><option value="">Email & SMS</option><option value="email">Email</option><option value="sms">SMS</option></Select>
        <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className="w-auto"><option value="">Any source</option><option value="direct">Sent by staff</option><option value="campaign">Campaigns</option><option value="automation">Automations</option></Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto"><option value="">Any status</option>{['sent', 'delivered', 'opened', 'clicked', 'failed', 'skipped', 'queued'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select>
      </div>
      <Card padded={false}>
        {loading ? <SkeletonRows rows={8} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No messages yet" description="Messages you send from a member's profile, campaigns and automations all appear here." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>To</Th><Th>Message</Th><Th>Source</Th><Th>Status</Th><Th>Sent</Th></tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-subtle/50" onClick={() => setOpen(m)}>
                    <Td>{m.member ? <Link href={`/members/${m.member.id}?tab=messages`} onClick={(e) => e.stopPropagation()} className="ui-focus rounded font-medium text-fg-heading hover:underline">{m.member.name}</Link> : m.prospect ? <span className="font-medium text-fg-heading">{m.prospect.name} <Badge>Lead</Badge></span> : m.toAddress || '—'}</Td>
                    <Td className="max-w-[22rem]"><span className="flex items-center gap-2"><Badge>{m.channel === 'sms' ? 'SMS' : 'Email'}</Badge><span className="truncate">{m.subject || m.body}</span></span></Td>
                    <Td className="text-fg-muted">{m.automation ? `Automation · ${m.automation.name}` : m.campaign ? `Campaign · ${m.campaign.name}` : 'Staff'}</Td>
                    <Td><StatusBadge status={m.status} /></Td>
                    <Td className="text-fg-muted">{dateTime(m.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} noun="messages" />}
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject || (open?.channel === 'sms' ? 'Text message' : 'Email')} description={open ? `To ${open.member?.name || open.prospect?.name || ''} ${open.toAddress ? `<${open.toAddress}>` : ''} · ${dateTime(open.createdAt)}` : undefined}>
        {open && (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><StatusBadge status={open.status} />{open.error && <span className="text-sm text-fg-muted">{open.error}</span>}</div>
            <p className="whitespace-pre-wrap rounded-lg bg-subtle px-3 py-2 text-sm text-fg">{open.body}</p>
          </div>
        )}
      </Modal>
    </Page>
  )
}
