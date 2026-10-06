'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApi } from '@/lib/client'
import type { Permission } from '@/lib/permissions'
import * as fmt from '@/lib/format'

export interface Me {
  user: { type: 'owner' | 'staff'; id: string; name: string; email?: string; role: string; roleLabel: string }
  permissions: Permission[]
  gym: { name: string; logoUrl: string | null; timezone: string; currency: string }
  locations: { id: string; name: string }[]
  isDemo: boolean
  unreadNotifications: number
}

interface SessionValue extends Me {
  can: (permission: Permission) => boolean
  /** Selected location filter; null = all locations. */
  locationId: string | null
  setLocationId: (id: string | null) => void
  reload: () => void
  /** Formatters bound to the gym's currency and timezone. */
  money: (cents: number | null | undefined) => string
  date: (value: string | Date | null | undefined) => string
  time: (value: string | Date | null | undefined) => string
  dateTime: (value: string | Date | null | undefined) => string
}

const SessionContext = createContext<SessionValue | null>(null)
const LOCATION_KEY = 'cc-location'

export function SessionProvider({ children, fallback, errorFallback }: { children: ReactNode; fallback: ReactNode; errorFallback: (message: string, retry: () => void) => ReactNode }) {
  const { data, error, reload } = useApi<Me>('/api/me')
  const [locationId, setLocation] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    let stored: string | null = null
    try {
      stored = localStorage.getItem(LOCATION_KEY)
    } catch {}
    setLocation(stored && data.locations.some((l) => l.id === stored) ? stored : null)
  }, [data])

  const setLocationId = useCallback((id: string | null) => {
    setLocation(id)
    try {
      if (id) localStorage.setItem(LOCATION_KEY, id)
      else localStorage.removeItem(LOCATION_KEY)
    } catch {}
  }, [])

  const value = useMemo<SessionValue | null>(() => {
    if (!data) return null
    const tz = data.gym.timezone
    return {
      ...data,
      can: (permission) => data.permissions.includes(permission),
      locationId,
      setLocationId,
      reload,
      money: (c) => fmt.formatMoney(c, data.gym.currency),
      date: (v) => fmt.formatDate(v, tz),
      time: (v) => fmt.formatTime(v, tz),
      dateTime: (v) => fmt.formatDateTime(v, tz),
    }
  }, [data, locationId, setLocationId, reload])

  if (!value) return <>{error ? errorFallback(error.message, reload) : fallback}</>
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside the app shell')
  return ctx
}
