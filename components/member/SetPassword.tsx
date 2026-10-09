'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, ClientError, useApi } from '@/lib/client'
import { Button, Field, FormError, Spinner } from '@/components/ui'
import { AuthLink, AuthShell, PasswordInput, PasswordRules, passwordOk } from './AuthShell'

interface Link { type: 'invite' | 'reset' | 'verify_email'; firstName: string; email: string; gymName: string; gymLogoUrl: string | null }

/** Choose a password from an invitation or reset link, then land in the account. */
export function SetPassword({ mode }: { mode: 'activate' | 'reset' }) {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const link = useApi<Link>(`/api/member-auth/token/${token}`)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordOk(password)) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/member-auth/set-password', { body: { token, password } })
      setDone(true)
      // Someone who came from the gym's booking page goes back to what they were booking. Only ever
      // a booking page on this site: anything else in the link is ignored.
      const next = new URLSearchParams(window.location.search).get('next') || ''
      router.replace(/^\/book\/[a-z0-9-]{3,40}(\?[A-Za-z0-9=&%:._-]{0,300})?$/.test(next) ? next : '/member/me')
    } catch (err) {
      setError((err as ClientError).message)
      setBusy(false)
    }
  }

  if (link.loading) return <div className="flex min-h-dvh items-center justify-center bg-canvas"><Spinner className="h-6 w-6" /></div>
  if (link.error || !link.data || link.data.type === 'verify_email') {
    return (
      <AuthShell title="This link can't be used" subtitle="It has expired or has already been used. Links work once, to keep your account safe." footer={<AuthLink href="/member/login">Back to sign in</AuthLink>}>
        <p className="text-sm text-fg-muted">Enter your email and we'll send you a fresh one.</p>
        <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => router.push('/member/forgot')}>Send me a new link</Button>
      </AuthShell>
    )
  }
  const gym = { name: link.data.gymName, logoUrl: link.data.gymLogoUrl }
  const inviting = mode === 'activate' && link.data.type === 'invite'

  return (
    <AuthShell
      gym={gym}
      title={done ? "You're in" : inviting ? `Welcome, ${link.data.firstName}` : 'Choose a new password'}
      subtitle={done ? 'Taking you to your account…' : inviting ? 'Choose a password to finish setting up your member account.' : `For ${link.data.email}`}
      footer={!done && <AuthLink href="/member/login">Back to sign in</AuthLink>}
    >
      {done ? <div className="flex justify-center py-4"><Spinner className="h-6 w-6" /></div> : (
        <form onSubmit={submit} className="space-y-4">
          {inviting && <div className="rounded-lg bg-subtle/60 px-3 py-2 text-sm"><p className="text-xs text-fg-muted">You'll sign in with</p><p className="truncate font-medium text-fg-heading">{link.data.email}</p></div>}
          {/* Lets password managers save the right username with the new password. */}
          <input type="email" name="email" autoComplete="username" value={link.data.email} readOnly hidden />
          <Field label={inviting ? 'Password' : 'New password'}><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" autoFocus /></Field>
          <PasswordRules password={password} />
          <FormError message={error} />
          <Button variant="primary" size="lg" type="submit" className="w-full" loading={busy} disabled={!passwordOk(password)}>{inviting ? 'Activate my account' : 'Save and sign in'}</Button>
        </form>
      )}
    </AuthShell>
  )
}
