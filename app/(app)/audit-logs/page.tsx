'use client'

import { useState, useEffect, useCallback } from 'react'
import Navbar from '@/components/Navbar'

interface AuditLog {
  id: string
  action: string
  description: string
  actorType: string
  actorEmail: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: string | null
  createdAt: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const actionCategories = [
  { value: '', label: 'All Actions' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'member_create', label: 'Member Created' },
  { value: 'member_update', label: 'Member Updated' },
  { value: 'member_delete', label: 'Member Deleted' },
  { value: 'member_checkin', label: 'Check-in' },
  { value: 'staff_create', label: 'Staff Created' },
  { value: 'staff_update', label: 'Staff Updated' },
  { value: 'staff_delete', label: 'Staff Deleted' },
  { value: 'settings_update', label: 'Settings Updated' },
  { value: 'subscription_start', label: 'Subscription Started' },
  { value: 'subscription_cancel', label: 'Subscription Cancelled' },
  { value: 'export_data', label: 'Data Export' },
]

function getActionBadgeColor(action: string): string {
  if (action.includes('delete') || action === 'subscription_cancel') {
    return 'bg-red-900/30 text-red-400 border-red-800'
  }
  if (action.includes('create') || action === 'subscription_start') {
    return 'bg-green-900/30 text-green-400 border-green-800'
  }
  if (action.includes('login') || action === 'logout') {
    return 'bg-blue-900/30 text-blue-400 border-blue-800'
  }
  if (action.includes('update') || action.includes('change')) {
    return 'bg-yellow-900/30 text-yellow-400 border-yellow-800'
  }
  return 'bg-gray-800 text-gray-300 border-gray-700'
}

function formatAction(action: string): string {
  return action
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Device'
  if (ua.includes('Android')) return 'Android Device'
  if (ua.includes('Chrome')) return 'Chrome Browser'
  if (ua.includes('Firefox')) return 'Firefox Browser'
  if (ua.includes('Safari')) return 'Safari Browser'
  if (ua.includes('Edge')) return 'Edge Browser'
  return 'Web Browser'
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('')
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '50' })
      if (actionFilter) {
        params.set('action', actionFilter)
      }

      const res = await fetch(`/api/audit-logs?${params}`, { credentials: 'include' })

      if (!res.ok) {
        if (res.status === 403) {
          setError('Only gym owners can view audit logs.')
          setLoading(false)
          return
        }
        throw new Error('Failed to fetch logs')
      }

      const data = await res.json()
      setLogs(data.logs)
      setPagination(data.pagination)
    } catch {
      setError('Failed to load audit logs. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [actionFilter])

  useEffect(() => {
    fetchLogs(1)
  }, [fetchLogs])

  return (
    <div className="min-h-screen bg-theme">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-theme-heading">Audit Logs</h1>
          <p className="text-theme-secondary mt-1">
            Track all security-relevant actions in your gym account
          </p>
        </div>

        {/* Filters */}
        <div className="bg-theme-card border border-theme rounded-xl p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="action-filter" className="block text-sm font-medium text-theme-secondary mb-1">
                Filter by Action
              </label>
              <select
                id="action-filter"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full bg-theme-lighter border border-theme rounded-lg px-3 py-2 text-theme focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                {actionCategories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={() => fetchLogs(1)}
                className="bg-primary hover:bg-primary-dark text-black font-semibold px-4 py-2 rounded-lg transition"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-theme-card border border-theme rounded-xl p-12">
            <div className="flex justify-center items-center gap-3">
              <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-theme-secondary">Loading audit logs...</span>
            </div>
          </div>
        )}

        {/* Logs Table */}
        {!loading && !error && logs.length === 0 && (
          <div className="bg-theme-card border border-theme rounded-xl p-12 text-center">
            <svg className="w-12 h-12 mx-auto text-theme-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-theme-secondary">No audit logs found.</p>
            <p className="text-theme-muted text-sm mt-1">
              Activity will appear here as you use ClubCheck.
            </p>
          </div>
        )}

        {!loading && !error && logs.length > 0 && (
          <>
            <div className="bg-theme-card border border-theme rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-theme-lighter border-b border-theme">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-theme-secondary uppercase tracking-wider">
                        Timestamp
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-theme-secondary uppercase tracking-wider">
                        Action
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-theme-secondary uppercase tracking-wider">
                        Description
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-theme-secondary uppercase tracking-wider">
                        User
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-theme-secondary uppercase tracking-wider">
                        Device
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-theme-secondary uppercase tracking-wider">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-theme-lighter transition">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-secondary">
                          {formatDate(log.createdAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${getActionBadgeColor(log.action)}`}>
                            {formatAction(log.action)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-theme max-w-xs truncate">
                          {log.description}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                              log.actorType === 'owner'
                                ? 'bg-purple-900/30 text-purple-400'
                                : 'bg-gray-800 text-gray-400'
                            }`}>
                              {log.actorType}
                            </span>
                            <span className="text-sm text-theme-secondary truncate max-w-[150px]">
                              {log.actorEmail || 'Unknown'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-muted">
                          {parseUserAgent(log.userAgent)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="text-primary hover:text-primary-light text-sm font-medium"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm text-theme-muted">
                  Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total} results
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchLogs(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="px-4 py-2 bg-theme-lighter border border-theme rounded-lg text-theme-secondary hover:bg-theme disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => fetchLogs(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="px-4 py-2 bg-theme-lighter border border-theme rounded-lg text-theme-secondary hover:bg-theme disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Detail Modal */}
        {selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSelectedLog(null)}
            />
            <div className="relative bg-theme-card border border-theme rounded-2xl w-full max-w-lg p-6 shadow-2xl">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-lg font-semibold text-theme-heading">Audit Log Details</h3>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-theme-muted hover:text-theme p-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                    Action
                  </label>
                  <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-medium border ${getActionBadgeColor(selectedLog.action)}`}>
                    {formatAction(selectedLog.action)}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                    Timestamp
                  </label>
                  <p className="text-theme">{formatDate(selectedLog.createdAt)}</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                    Description
                  </label>
                  <p className="text-theme">{selectedLog.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                      Actor Type
                    </label>
                    <p className="text-theme capitalize">{selectedLog.actorType}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                      Actor Email
                    </label>
                    <p className="text-theme">{selectedLog.actorEmail || 'Unknown'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                      IP Address
                    </label>
                    <p className="text-theme font-mono text-sm">{selectedLog.ipAddress || 'Unknown'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                      Device
                    </label>
                    <p className="text-theme">{parseUserAgent(selectedLog.userAgent)}</p>
                  </div>
                </div>

                {selectedLog.metadata && (
                  <div>
                    <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                      Additional Data
                    </label>
                    <pre className="bg-theme-lighter border border-theme rounded-lg p-3 text-xs text-theme-secondary overflow-x-auto">
                      {JSON.stringify(JSON.parse(selectedLog.metadata), null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.userAgent && (
                  <div>
                    <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1">
                      Full User Agent
                    </label>
                    <p className="text-theme-secondary text-xs break-all">{selectedLog.userAgent}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-theme">
                <button
                  onClick={() => setSelectedLog(null)}
                  className="w-full bg-theme-lighter hover:bg-theme border border-theme text-theme font-medium py-2.5 rounded-lg transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
