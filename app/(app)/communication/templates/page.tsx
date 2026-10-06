'use client'

import { useEffect, useState } from 'react'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, ClientError, useApi } from '@/lib/client'
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, Page, PageHeader, Select, SkeletonRows, Textarea, useToast } from '@/components/ui'

interface Template { id: string; name: string; channel: string; subject: string | null; body: string }

export default function TemplatesPage() {
  const toast = useToast()
  const { data, error, loading, reload } = useApi<Template[]>('/api/templates')
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [removing, setRemoving] = useState<Template | null>(null)
  const [f, setF] = useState({ name: '', channel: 'email', subject: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (editing) { setProblem(null); setF(editing === 'new' ? { name: '', channel: 'email', subject: '', body: '' } : { name: editing.name, channel: editing.channel, subject: editing.subject || '', body: editing.body }) } }, [editing])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      if (editing === 'new') await api('/api/templates', { body: f })
      else await api(`/api/templates/${(editing as Template).id}`, { method: 'PATCH', body: f })
      toast.success('Template saved')
      setEditing(null)
      reload()
    } catch (err) {
      setProblem((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await api(`/api/templates/${removing.id}`, { method: 'DELETE' })
      toast.success('Template deleted')
      setRemoving(null)
      reload()
    } catch (err) {
      toast.error((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Templates" description="Reusable messages for campaigns and one-off sends." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New template</Button>} />
      {loading ? <Card padded={false}><SkeletonRows /></Card> : error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data || data.length === 0 ? (
        <Card><EmptyState icon={<FileText className="h-5 w-5" />} title="No templates yet" description="Save the messages you send again and again: holiday hours, class cancellations, payment reminders." action={<Button variant="primary" onClick={() => setEditing('new')}>New template</Button>} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-semibold text-fg-heading">{t.name}</p><Badge className="mt-1">{t.channel === 'sms' ? 'SMS' : 'Email'}</Badge></div>
                <span className="flex shrink-0"><IconButton label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></IconButton><IconButton label={`Delete ${t.name}`} onClick={() => setRemoving(t)}><Trash2 className="h-4 w-4" /></IconButton></span>
              </div>
              {t.subject && <p className="mt-2 truncate text-sm font-medium text-fg">{t.subject}</p>}
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-fg-muted">{t.body}</p>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === 'new' ? 'New template' : 'Edit template'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="template" loading={busy}>Save</Button></>}>
        <form id="template" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></Field>
          <Field label="Channel"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="email">Email</option><option value="sms">Text message (SMS)</option></Select></Field>
          {f.channel === 'email' && <Field label="Subject" className="sm:col-span-2"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} /></Field>}
          <Field label="Message" required hint="Personalise with {{first_name}}, {{gym_name}} and {{portal_link}}." className="sm:col-span-2"><Textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required maxLength={f.channel === 'sms' ? 480 : 5000} /></Field>
          <div className="sm:col-span-2"><FormError message={problem} /></div>
        </form>
      </Modal>
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} loading={busy} danger title={`Delete "${removing?.name}"?`} confirmLabel="Delete" />
    </Page>
  )
}
