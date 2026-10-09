'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Ban, Check, Inbox, MailOpen, Reply } from 'lucide-react'
import { api, ClientError, qs, useApi, useDebounced } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Page, PageHeader, SearchInput, SkeletonRows, Tabs, cn, useToast } from '@/components/ui'
import { Thread, type ThreadData } from '@/components/messaging/Thread'

interface Row {
  id: string
  phone: string
  lastMessageAt: string | null
  lastPreview: string | null
  lastDirection: string | null
  unreadCount: number
  needsResponse: boolean
  member: { id: string; name: string; photoUrl: string | null; status: string } | null
  lead: { id: string; name: string } | null
  stopped: boolean
  assignedTo: { id: string; name: string } | null
}
interface Payload { totals: { all: number; unread: number; needsResponse: number }; conversations: Row[]; configured: boolean }
type Filter = 'needs_response' | 'unread' | 'all'

const pretty = (phone: string) => (/^\+1\d{10}$/.test(phone) ? `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}` : phone)

function InboxScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const { dateTime, can } = useSession()
  const openId = params.get('open')
  const [filter, setFilter] = useState<Filter>('needs_response')
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useApi<Payload>(`/api/conversations${qs({ filter: filter === 'all' ? '' : filter, search: debounced })}`)

  // Replies arrive on their own; keep the list fresh while the tab is in view.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload() }, 15_000)
    return () => clearInterval(timer)
  }, [reload])

  const open = (id: string | null) => router.replace(id ? `/communication/inbox?open=${id}` : '/communication/inbox', { scroll: false })
  // The open conversation may not be in the filtered list (it was just handled, or came from a link).
  const [loaded, setLoaded] = useState<ThreadData | null>(null)
  useEffect(() => setLoaded(null), [openId])
  const listed = data?.conversations.find((c) => c.id === openId) || null
  const current = listed || (loaded && loaded.id === openId ? { phone: loaded.phone || '', member: loaded.member, lead: loaded.lead, needsResponse: loaded.needsResponse, assignedTo: null as { id: string; name: string } | null } : null)
  const act = async (body: Record<string, unknown>, done: string) => {
    if (!openId) return
    try {
      await api(`/api/conversations/${openId}`, { body })
      toast.success(done)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    }
  }

  return (
    <Page>
      {/* On a phone an open conversation gets the whole screen. */}
      <div className={cn(openId && 'hidden lg:block')}>
      <PageHeader
        title="Inbox"
        description="Text conversations with members and leads."
        actions={can('settings.manage') ? <Link href="/settings/messaging"><Button>Messaging settings</Button></Link> : undefined}
      />
      </div>
      {data && !data.configured && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2 text-sm text-fg-muted" role="status">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Texting is not connected yet, so nothing can be sent or received. {can('settings.manage') ? <Link href="/settings/messaging" className="ui-focus rounded font-medium text-fg-heading underline">Set it up</Link> : 'Ask an owner or admin to set it up.'}</span>
        </div>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* On a phone the list and the conversation take turns; side by side from lg up. */}
        <Card padded={false} className={cn('min-w-0 overflow-hidden', openId && 'hidden lg:block')}>
          <div className="space-y-3 border-b border-line p-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, number or message" />
            <Tabs<Filter>
              className="!mx-0 !mb-0 !px-0"
              value={filter}
              onChange={setFilter}
              tabs={[
                { key: 'needs_response', label: 'Needs reply', count: data?.totals.needsResponse ?? null },
                { key: 'unread', label: 'Unread', count: data?.totals.unread ?? null },
                { key: 'all', label: 'All', count: data?.totals.all ?? null },
              ]}
            />
          </div>
          {loading ? <SkeletonRows rows={6} /> : error ? <ErrorState error={error} onRetry={reload} /> : !data || data.conversations.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={debounced ? 'No conversations match' : filter === 'needs_response' ? 'Nothing waiting for a reply' : filter === 'unread' ? 'No unread texts' : 'No conversations yet'}
              description={debounced ? undefined : filter === 'all' ? 'When you text a member, or one texts the gym, the conversation appears here.' : 'You are all caught up.'}
            />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line/60 overflow-y-auto">
              {data.conversations.map((c) => {
                const name = c.member?.name || c.lead?.name || pretty(c.phone)
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => open(c.id)} aria-current={c.id === openId} className={cn('ui-focus flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-subtle/60', c.id === openId && 'bg-subtle')}>
                      <Avatar name={name} src={c.member?.photoUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn('min-w-0 flex-1 truncate text-sm text-fg-heading', c.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>{name}</span>
                          {c.unreadCount > 0 && <span className="tabular shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg" aria-label={`${c.unreadCount} unread`}>{c.unreadCount}</span>}
                        </span>
                        <span className={cn('mt-0.5 flex items-center gap-1 text-sm', c.unreadCount > 0 ? 'text-fg' : 'text-fg-muted')}>
                          {c.lastDirection === 'outbound' && <Reply className="h-3 w-3 shrink-0" aria-label="You replied" />}
                          <span className="truncate">{c.lastPreview || 'No messages'}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                          <span>{c.lastMessageAt ? dateTime(c.lastMessageAt) : ''}</span>
                          {c.lead && <Badge>Lead</Badge>}
                          {!c.member && !c.lead && <Badge>Unknown number</Badge>}
                          {c.stopped && <Badge tone="red">Opted out</Badge>}
                          {c.needsResponse && <Badge tone="amber">Needs reply</Badge>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card padded={false} className={cn('min-w-0 overflow-hidden', !openId && 'hidden lg:block')}>
          {!openId ? (
            <EmptyState icon={<MailOpen className="h-5 w-5" />} title="Choose a conversation" description="Pick one on the left to read it and reply." />
          ) : (
            <div className="flex h-[calc(100dvh-12.5rem)] min-h-[22rem] flex-col lg:h-[70vh]">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => open(null)} icon={<ArrowLeft className="h-4 w-4" />}>Inbox</Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg-heading">{current?.member?.name || current?.lead?.name || (current ? pretty(current.phone) : 'Conversation')}</p>
                  {current && <p className="truncate text-xs text-fg-muted">{pretty(current.phone)}{current.assignedTo ? ` · ${current.assignedTo.name}` : ''}</p>}
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {current?.member && <Link href={`/members/${current.member.id}`}><Button size="sm">Open member</Button></Link>}
                {current?.lead && <Link href={`/leads?lead=${current.lead.id}`}><Button size="sm">Open lead</Button></Link>}
                {current?.needsResponse
                  ? <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => act({ action: 'resolve', needsResponse: false }, 'Marked as handled')}>Mark handled</Button>
                  : current && <Button size="sm" onClick={() => act({ action: 'resolve', needsResponse: true }, 'Marked as needing a reply')}>Needs reply</Button>}
                </div>
              </div>
              <Thread key={openId} source={{ conversationId: openId }} onChanged={reload} onData={setLoaded} className="min-h-0 flex-1" />
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}

export default function InboxPage() {
  return <Suspense><InboxScreen /></Suspense>
}
