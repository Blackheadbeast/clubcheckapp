'use client'

import { useState, useEffect } from 'react'

interface ServiceStatus {
  name: string
  status: 'operational' | 'degraded' | 'down'
  latency?: number
  message?: string
}

interface SystemStatusData {
  status: 'operational' | 'degraded' | 'down'
  services: ServiceStatus[]
  timestamp: string
  version: string
}

export default function SystemStatus() {
  const [data, setData] = useState<SystemStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadStatus() {
    try {
      setLoading(true)
      const res = await fetch('/api/system-status', { credentials: 'include' })
      if (!res.ok) {
        throw new Error('Failed to load status')
      }
      const statusData = await res.json()
      setData(statusData)
      setError(null)
    } catch (err) {
      setError('Failed to load system status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    // Refresh every 30 seconds
    const interval = setInterval(loadStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const statusColors = {
    operational: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  }

  const statusLabels = {
    operational: 'Operational',
    degraded: 'Degraded',
    down: 'Down',
  }

  if (loading && !data) {
    return (
      <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">System Status</h3>
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">System Status</h3>
        <div className="text-red-400">{error}</div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">System Status</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColors[data.status]}`} />
          <span className="text-sm text-gray-400">{statusLabels[data.status]}</span>
        </div>
      </div>

      <div className="space-y-3">
        {data.services.map((service) => (
          <div
            key={service.name}
            className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
          >
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${statusColors[service.status]}`} />
              <span className="text-gray-300">{service.name}</span>
            </div>
            <div className="flex items-center gap-3">
              {service.latency && (
                <span className="text-xs text-gray-500">{service.latency}ms</span>
              )}
              {service.message && (
                <span className="text-xs text-gray-500">{service.message}</span>
              )}
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  service.status === 'operational'
                    ? 'bg-green-900/30 text-green-400'
                    : service.status === 'degraded'
                    ? 'bg-yellow-900/30 text-yellow-400'
                    : 'bg-red-900/30 text-red-400'
                }`}
              >
                {statusLabels[service.status]}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-800 flex justify-between text-xs text-gray-500">
        <span>Version {data.version}</span>
        <span>Updated {new Date(data.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
