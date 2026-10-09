'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ClientError } from '@/lib/client'
import { Button, Field, FormError, Input, Spinner } from '@/components/ui'
import { AuthLink, AuthShell, PasswordInput } from '@/components/member/AuthShell'

interface Gym { id: string; name: string }

export default function MemberLoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [gyms, setGyms] = useState<Gym[] | null>(null)
  const [busy, setBusy] = useState<string | boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Already signed in: go straight to the account.
  useEffect(() => {
    api<{ authenticated: boolean }>('/api/member-auth/session')
      .then((s) => { if (s.authenticated) router.replace('/member/me'); else setChecking(false) })
      .catch(() => setChecking(false))
  }, [router])

  const signIn = async (gymId?: string) => {
    setBusy(gymId || true)
    setError(null)
    try {
      const result = await api<{ status: 'ok' | 'choose_gym'; gyms?: Gym[] }>('/api/member-auth/login', { body: { email, password, gymId } })
      if (result.status === 'choose_gym') {
        setGyms(result.gyms || [])
        setBusy(false)
        return
      }
      router.replace('/member/me')
    } catch (err) {
      setError((err as ClientError).message)
      setBusy(false)
    }
  }

  if (checking) return <div className="flex min-h-dvh items-center justify-center bg-canvas"><Spinner className="h-6 w-6" /></div>

  if (gyms) {
    return (
      <AuthShell title="Which gym?" subtitle="Your email has an account at more than one gym." footer={<button type="button" className="ui-focus rounded font-medium text-accent-text hover:underline" onClick={() => { setGyms(null); setError(null) }}>Use a different email</button>}>
        <div className="space-y-2">
          {gyms.map((g) => (
            <Button key={g.id} size="lg" className="w-full justify-between" loading={busy === g.id} disabled={!!busy} onClick={() => signIn(g.id)}>{g.name}</Button>
          ))}
        </div>
        <div className="mt-3"><FormError message={error} /></div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Sign in" subtitle="Book classes, check your membership and manage billing." footer={<>New here or never set a password? <AuthLink href="/member/forgot?new=1">Set up your account</AuthLink></>}>
      <form onSubmit={(e) => { e.preventDefault(); signIn() }} className="space-y-4">
        <Field label="Email"><Input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus maxLength={200} /></Field>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <label htmlFor="member-password" className="text-xs font-medium text-fg-muted">Password</label>
            <AuthLink href="/member/forgot">Forgot password?</AuthLink>
          </div>
          <PasswordInput id="member-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <FormError message={error} />
        <Button variant="primary" size="lg" type="submit" className="w-full" loading={busy === true}>Sign in</Button>
      </form>
    </AuthShell>
  )
}
