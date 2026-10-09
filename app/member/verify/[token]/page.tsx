'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { api, ClientError } from '@/lib/client'
import { Spinner } from '@/components/ui'
import { AuthLink, AuthShell } from '@/components/member/AuthShell'

export default function MemberVerifyEmailPage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; email: string } | { status: 'error'; message: string }>({ status: 'working' })
  const started = useRef(false)

  useEffect(() => {
    // The link is single-use, so make sure a re-render cannot spend it twice.
    if (started.current) return
    started.current = true
    api<{ email: string }>('/api/member-auth/verify-email', { body: { token } })
      .then((r) => setState({ status: 'done', email: r.email }))
      .catch((err) => setState({ status: 'error', message: (err as ClientError).message }))
  }, [token])

  if (state.status === 'working') return <div className="flex min-h-dvh items-center justify-center bg-canvas"><Spinner className="h-6 w-6" /></div>
  if (state.status === 'error') {
    return (
      <AuthShell title="We couldn't confirm that" subtitle={state.message} footer={<AuthLink href="/member/me">Go to my account</AuthLink>}>
        <p className="text-sm text-fg-muted">Your account is still using your previous email. You can ask for a new confirmation link from your profile.</p>
      </AuthShell>
    )
  }
  return (
    <AuthShell title="Email confirmed" footer={<AuthLink href="/member/me">Go to my account</AuthLink>}>
      <div className="flex flex-col items-center text-center">
        <CheckCircle2 className="mb-3 h-9 w-9 text-emerald-500" aria-hidden />
        <p className="text-sm text-fg">You now sign in with <span className="font-medium text-fg-heading">{state.email}</span>.</p>
      </div>
    </AuthShell>
  )
}
