'use client'

// Browser-side data access: one fetch wrapper and one hook for every screen.

import { useCallback, useEffect, useRef, useState } from 'react'

export class ClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
  }
}

export interface Meta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  [key: string]: unknown
}

interface Envelope<T> {
  data: T
  meta?: Meta
}

export async function request<T>(url: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Envelope<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ClientError("Can't reach the server. Check your connection and try again.", 0, 'network')
  }
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login'
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ClientError(json?.error || `Request failed (${res.status})`, res.status, json?.code, json?.details)
  }
  return json as Envelope<T>
}

/** Call an API and return its data. Throws ClientError with a message fit to show the user. */
export async function api<T = unknown>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await request<T>(url, options)).data
}

export interface ApiState<T> {
  data: T | null
  meta: Meta | null
  error: ClientError | null
  loading: boolean
  /** True while refetching with data already on screen. */
  refreshing: boolean
  reload: () => void
  setData: (data: T | null) => void
}

/** Fetch `url` and keep it in sync. Pass null to skip. Stale responses are discarded. */
export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<ClientError | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [refreshing, setRefreshing] = useState(false)
  const [nonce, setNonce] = useState(0)
  const hasData = useRef(false)

  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    if (hasData.current) setRefreshing(true)
    else setLoading(true)
    request<T>(url, { signal: controller.signal })
      .then((envelope) => {
        hasData.current = true
        setData(envelope.data)
        setMeta(envelope.meta || null)
        setError(null)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setError(err instanceof ClientError ? err : new ClientError('Something went wrong.', 0))
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => controller.abort()
  }, [url, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, meta, error, loading, refreshing, reload, setData }
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === 'all') continue
    search.set(key, String(value))
  }
  const out = search.toString()
  return out ? `?${out}` : ''
}
