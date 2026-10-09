'use client'

// Shared frame and form pieces for the member sign-in pages.

import { useState } from 'react'
import Link from 'next/link'
import { Check, Eye, EyeOff } from 'lucide-react'
import { Input, cn } from '@/components/ui'

export function AuthShell({ title, subtitle, gym, children, footer }: { title: string; subtitle?: React.ReactNode; gym?: { name: string; logoUrl?: string | null } | null; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-7 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {gym?.logoUrl ? <img src={gym.logoUrl} alt="" className="mb-4 h-12 w-12 rounded-xl object-cover" /> : (
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-fg" aria-hidden>{(gym?.name || 'ClubCheck')[0]}</span>
          )}
          {gym?.name && <p className="mb-1 text-sm font-medium text-fg-muted">{gym.name}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-fg-heading">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">{children}</div>
        {footer && <div className="mt-5 text-center text-sm text-fg-muted">{footer}</div>}
      </main>
      <p className="pb-6 text-center text-xs text-fg-subtle">Member accounts by ClubCheck</p>
    </div>
  )
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="ui-focus rounded font-medium text-accent-text hover:underline">{children}</Link>
}

export function PasswordInput({ value, onChange, autoComplete, id, autoFocus }: { value: string; onChange: (value: string) => void; autoComplete: 'current-password' | 'new-password'; id?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} required maxLength={200} className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="ui-focus absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-fg-subtle hover:text-fg">
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  )
}

export const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { label: 'A letter', test: (p) => /[a-zA-Z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
]
export const passwordOk = (p: string) => PASSWORD_RULES.every((r) => r.test(p))

export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="space-y-1" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password)
        return (
          <li key={rule.label} className={cn('flex items-center gap-2 text-xs', met ? 'text-emerald-700 dark:text-emerald-400' : 'text-fg-subtle')}>
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', met ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500' : 'border-line')}>{met && <Check className="h-3 w-3" aria-hidden />}</span>
            {rule.label}<span className="sr-only">{met ? ' (met)' : ' (not met yet)'}</span>
          </li>
        )
      })}
    </ul>
  )
}
