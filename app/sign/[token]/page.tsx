import type { Metadata } from 'next'
import { SigningLinkPage } from '@/components/documents/SigningLinkPage'

export const dynamic = 'force-dynamic'

// A personal signing link: never indexed, and the address (which is the credential) is not passed on to other sites.
export const metadata: Metadata = { title: 'Sign document', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default function SignPage({ params }: { params: { token: string } }) {
  return <SigningLinkPage token={params.token} />
}
