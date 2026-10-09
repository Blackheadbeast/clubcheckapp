'use client'

import { useEffect, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { api, ClientError } from '@/lib/client'
import { Button, Field, FormError, Input } from '@/components/ui'
import { AuthLink, AuthShell } from '@/components/member/AuthShell'

export default function MemberForgotPage() {
  const [setup, setSetup] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setSetup(window.location.search.includes('new=1')) }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/api/member-auth/recover', { body: { email } })
      setSentTo(email.trim())
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" footer={<AuthLink href="/member/login">Back to sign in</AuthLink>}>
        <div className="flex flex-col items-center text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><MailCheck className="h-5 w-5" aria-hidden /></span>
          <p className="text-sm leading-relaxed text-fg">If <span className="font-medium text-fg-heading">{sentTo}</span> belongs to a member, a link is on its way.</p>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted">It can take a minute. Check spam too. If nothing arrives, the gym may have a different address on file for you.</p>
          <Button className="mt-4 w-full" onClick={() => setSentTo(null)}>Try another email</Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={setup ? 'Set up your account' : 'Forgot your password?'}
      subtitle={setup ? "Enter the email your gym has on file. We'll send a link to choose a password." : "Enter your email and we'll send a link to choose a new one."}
      footer={<AuthLink href="/member/login">Back to sign in</AuthLink>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><Input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus maxLength={200} /></Field>
        <FormError message={error} />
        <Button variant="primary" size="lg" type="submit" className="w-full" loading={busy}>Send link</Button>
      </form>
    </AuthShell>
  )
}
