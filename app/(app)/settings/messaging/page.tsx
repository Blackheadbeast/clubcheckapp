'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { useSession } from '@/components/Session'
import { Badge, Button, Card, CardHeader, ErrorState, Field, FormError, Input, Page, PageHeader, SkeletonRows, useToast } from '@/components/ui'

interface Status {
  configured: boolean
  canSend: boolean
  credentials: { accountSid: boolean; authToken: boolean; messagingService: boolean }
  number: string | null
  ownNumber: string | null
  sharedNumber: string | null
  webhooks: { inbound: string; status: string } | null
  last30: Record<string, number>
  lastInboundAt: string | null
}

export default function MessagingSettingsPage() {
  const toast = useToast()
  const { dateTime } = useSession()
  const { data, error, loading, reload } = useApi<Status>('/api/sms')
  const [number, setNumber] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ where: string; message: string } | null>(null)

  const run = async (where: string, body: Record<string, unknown>, done: string) => {
    setBusy(where)
    setProblem(null)
    try {
      await api('/api/sms', { body })
      toast.success(done)
      if (where === 'number') setNumber('')
      reload()
    } catch (err) {
      setProblem({ where, message: (err as ClientError).message })
    } finally {
      setBusy(null)
    }
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied') } catch { toast.error('Could not copy. Select the address and copy it by hand.') }
  }
  const sent = data ? (data.last30.sent || 0) + (data.last30.delivered || 0) : 0

  return (
    <Page width="narrow">
      <PageHeader title="Messaging" description="Text members from the gym's own number, and receive their replies." />
      {loading ? <Card padded={false}><SkeletonRows rows={4} /></Card> : error || !data ? <Card><ErrorState error={error || 'Failed to load'} onRetry={reload} /></Card> : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Text messaging (SMS)"
              description="Sent through Twilio. The account credentials are kept on the server and are never shown here."
              action={data.canSend ? <Badge tone="green">Connected</Badge> : data.configured ? <Badge tone="amber">Needs a number</Badge> : <Badge>Not connected</Badge>}
            />
            {!data.configured ? (
              <div className="space-y-2 text-sm text-fg-muted">
                <p className="flex items-start gap-2 text-fg"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />Texting is not connected on this installation. Until it is, every text is recorded as “not sent” and nothing leaves ClubCheck.</p>
                <p>Whoever runs the installation needs to set the Twilio account SID and auth token on the server, with a sending number or messaging service.</p>
                <ul className="list-inside list-disc text-xs">
                  <li>Account SID: {data.credentials.accountSid ? 'set' : 'missing'}</li>
                  <li>Auth token: {data.credentials.authToken ? 'set' : 'missing'}</li>
                  <li>Messaging service: {data.credentials.messagingService ? 'set' : 'not used'}</li>
                </ul>
              </div>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-fg-muted">Sending number</dt><dd className="font-medium text-fg-heading">{data.number || (data.credentials.messagingService ? 'Chosen by the messaging service' : 'None yet')}{data.number && !data.ownNumber ? ' (shared)' : ''}</dd></div>
                <div><dt className="text-fg-muted">Last 30 days</dt><dd className="font-medium text-fg-heading">{sent} sent · {(data.last30.failed || 0) + (data.last30.undelivered || 0)} failed · {data.last30.skipped || 0} not allowed</dd></div>
                <div><dt className="text-fg-muted">Last reply received</dt><dd className="font-medium text-fg-heading">{data.lastInboundAt ? dateTime(data.lastInboundAt) : 'None yet'}</dd></div>
                <div><dt className="text-fg-muted">Status</dt><dd className="flex items-center gap-1.5 font-medium text-fg-heading">{data.canSend ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />Ready to send</> : 'Add a sending number below'}</dd></div>
              </dl>
            )}
          </Card>

          {data.configured && (
            <>
              <Card>
                <CardHeader title="Your gym's number" description="A number on the Twilio account that only this gym uses. Replies to it come to your inbox." />
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run('number', { action: 'number', number }, 'Sending number saved') }}>
                  <Field label="Number" className="min-w-[12rem] flex-1"><Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={data.ownNumber || '+1 207 555 0142'} inputMode="tel" autoComplete="off" /></Field>
                  <Button type="submit" variant="primary" loading={busy === 'number'} disabled={!number.trim()}>Save</Button>
                  {data.ownNumber && <Button loading={busy === 'remove'} onClick={() => run('remove', { action: 'number', number: null }, 'Number removed')}>Remove</Button>}
                </form>
                {problem?.where === 'number' || problem?.where === 'remove' ? <div className="mt-2"><FormError message={problem.message} /></div> : null}
              </Card>

              <Card>
                <CardHeader title="Connect replies and delivery reports" description="In Twilio, open the number (or messaging service) and paste the first address into “A message comes in”. Delivery reports need no setup." />
                {data.webhooks ? (
                  <ul className="space-y-2 text-sm">
                    {([['Incoming messages', data.webhooks.inbound], ['Delivery reports (set automatically)', data.webhooks.status]] as const).map(([label, url]) => (
                      <li key={url}>
                        <p className="text-fg-muted">{label}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-md bg-subtle px-2 py-1.5 text-xs text-fg">{url}</code>
                          <Button size="sm" onClick={() => copy(url)} icon={<Copy className="h-3.5 w-3.5" />}>Copy</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-fg-muted">The public address of this installation is not set, so Twilio cannot be told where to send replies.</p>}
              </Card>

              <Card>
                <CardHeader title="Send a test text" description="One plain message to a phone you have in your hand, to prove the connection works. Reply to it to test the inbox." />
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run('test', { action: 'test', to }, 'Test text sent') }}>
                  <Field label="Your mobile number" className="min-w-[12rem] flex-1"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+1 207 555 0142" inputMode="tel" autoComplete="tel" /></Field>
                  <Button type="submit" loading={busy === 'test'} disabled={!to.trim() || !data.canSend}>Send test</Button>
                </form>
                {problem?.where === 'test' ? <div className="mt-2"><FormError message={problem.message} /></div> : null}
              </Card>
            </>
          )}

          <Card>
            <CardHeader title="Who gets texts" />
            <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
              <li>Having a member's number is not permission to text them. Each member agrees to reminders, and separately to offers and news.</li>
              <li>Anyone who replies STOP gets nothing further. Staff cannot switch that back on; the member texts START.</li>
              <li>Texts that may not be sent are kept in the history as “not sent”, with the reason.</li>
            </ul>
          </Card>
        </div>
      )}
    </Page>
  )
}
