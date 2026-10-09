'use client'

import { useEffect, useRef, useState } from 'react'
import { api, ClientError, useApi } from '@/lib/client'
import { Button, Field, FormError, Input, Modal, Select, Textarea, useToast } from '@/components/ui'

interface Template {
  id: string
  name: string
  channel: string
  subject: string | null
  body: string
}

/** Compose a message to an audience (or to one member when `memberId` is set). */
export function ComposeModal({
  open,
  onClose,
  audience,
  memberId,
  label,
  onSent,
}: {
  open: boolean
  onClose: () => void
  audience?: Record<string, unknown>
  memberId?: string
  label: string
  onSent?: () => void
}) {
  const toast = useToast()
  const { data: templates } = useApi<Template[]>(open ? '/api/templates' : null)
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per composed message, so a double click or a retry cannot send it twice.
  const key = useRef('')

  useEffect(() => {
    if (open) key.current = `${Date.now()}-${Math.random().toString(36).slice(2)}-compose`
    if (!open) {
      setSubject('')
      setBody('')
      setError(null)
    }
  }, [open])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (memberId) {
        const result = await api<{ status: string; error: string | null }>(`/api/members/${memberId}/messages`, { body: { channel, subject: channel === 'email' ? subject : null, body, clientKey: key.current } })
        if (['sent', 'delivered', 'queued'].includes(result.status)) toast.success('Message sent')
        else toast.error(`Not delivered: ${result.error || result.status}`)
      } else {
        const result = await api<{ sent: number; skipped: number; failed: number; remaining: number }>('/api/campaigns', {
          body: { name: subject || `Message to ${label}`, channel, subject: channel === 'email' ? subject : null, body, audience, send: true },
        })
        if (result.sent + result.remaining > 0) toast.success(`${result.remaining ? `Sending to ${result.sent + result.remaining}` : `Sent to ${result.sent}`}${result.skipped + result.failed ? `, ${result.skipped + result.failed} not sent` : ''}`)
        else toast.error(`Nothing was delivered (${result.skipped} skipped, ${result.failed} failed). See Communication for details.`)
      }
      onSent?.()
      onClose()
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send a message"
      description={`To ${label}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form="compose" loading={busy}>Send</Button>
        </>
      }
    >
      <form id="compose" onSubmit={send} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Channel">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'sms')}>
              <option value="email">Email</option>
              <option value="sms">Text message (SMS)</option>
            </Select>
          </Field>
          <Field label="Start from a template">
            <Select
              value=""
              onChange={(e) => {
                const t = templates?.find((x) => x.id === e.target.value)
                if (!t) return
                setChannel(t.channel as 'email' | 'sms')
                setSubject(t.subject || '')
                setBody(t.body)
              }}
            >
              <option value="">{templates && templates.length === 0 ? 'No templates yet' : 'Choose…'}</option>
              {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        {channel === 'email' && (
          <Field label="Subject" required>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
          </Field>
        )}
        <Field label="Message" required hint="Use {{first_name}}, {{gym_name}} and {{portal_link}} to personalise.">
          <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={channel === 'sms' ? 1600 : 5000} />
        </Field>
        {channel === 'sms' && <p className="text-xs text-fg-subtle">{memberId ? 'Texts only go to members who have agreed to them and have not replied STOP.' : 'Sent as a campaign: it only reaches members who agreed to offers and news by text. Everyone else is skipped, with the reason.'}{body.length > 160 ? ` About ${Math.ceil(body.length / 153)} texts each.` : ''}</p>}
        <FormError message={error} />
      </form>
    </Modal>
  )
}
