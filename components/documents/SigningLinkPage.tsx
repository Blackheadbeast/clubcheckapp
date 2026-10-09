'use client'

import { ToastProvider } from '@/components/ui'
import { SignDocument } from './SignDocument'

/** What an emailed signing link opens. Opening it signs nothing: the person still reads, completes, signs and submits. */
export function SigningLinkPage({ token }: { token: string }) {
  return (
    <ToastProvider>
      <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:py-10">
        <SignDocument url={`/api/public/sign/${encodeURIComponent(token)}`} />
        <p className="mt-10 text-center text-xs text-fg-subtle">Secure signing by ClubCheck</p>
      </main>
    </ToastProvider>
  )
}
