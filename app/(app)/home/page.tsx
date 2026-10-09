'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/Session'
import { Spinner } from '@/components/ui'

/** Sends each person to where their role starts the day: the floor to Today, the office to the dashboard. */
export default function HomePage() {
  const router = useRouter()
  const { home } = useSession()
  useEffect(() => { router.replace(home || '/dashboard') }, [home, router])
  return <div className="flex h-64 items-center justify-center"><Spinner className="h-6 w-6" /></div>
}
