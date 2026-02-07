'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'

interface Member {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  qrCode: string
  createdAt: string
  lastCheckInAt: string | null
  waiverSignedAt: string | null
}

type SortField = 'name' | 'email' | 'status' | 'createdAt' | 'lastCheckInAt'

export default function MembersPage() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [waiverEnabled, setWaiverEnabled] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    error?: string
    message?: string
    errors?: string[]
  } | null>(null)

  // Search / filter / sort state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState('')

  // Add member form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadMembers = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      params.set('sort', sortField)
      params.set('order', sortOrder)

      const res = await fetch(`/api/members?${params}`, { credentials: 'include' })
      if (!res.ok) {
        router.push('/login')
        return
      }
      const data = await res.json()
      setMembers(data.members)
      setWaiverEnabled(data.waiverEnabled || false)
    } catch (err) {
      console.error('Failed to load members:', err)
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, sortField, sortOrder, router])

  useEffect(() => {
    const debounce = setTimeout(() => loadMembers(), search ? 300 : 0)
    return () => clearTimeout(debounce)
  }, [loadMembers, search])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return ''
    return sortOrder === 'asc' ? ' ↑' : ' ↓'
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === members.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(members.map((m) => m.id)))
    }
  }

  async function handleBulkAction() {
    if (!bulkAction || selected.size === 0) return
    const ids = Array.from(selected)

    if (bulkAction === 'delete') {
      if (!confirm(`Delete ${ids.length} member(s)? This cannot be undone.`)) return
      await fetch('/api/members/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
        credentials: 'include',
      })
    } else if (['active', 'inactive', 'paused', 'delinquent'].includes(bulkAction)) {
      await fetch('/api/members/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', ids, status: bulkAction }),
        credentials: 'include',
      })
    } else if (bulkAction === 'export') {
      window.location.href = '/api/members/export'
      setBulkAction('')
      return
    }

    setSelected(new Set())
    setBulkAction('')
    await loadMembers()
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add member')
        setSubmitting(false)
        return
      }
      setName('')
      setEmail('')
      setPhone('')
      setShowAddForm(false)
      await loadMembers()
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCSVImport(e: React.FormEvent) {
    e.preventDefault()
    if (!csvFile) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await csvFile.text()
      const lines = text.split('\n').filter((line) => line.trim())
      const dataLines = lines.slice(1)
      const membersToImport = dataLines.map((line) => {
        const [memberName, memberEmail, memberPhone] = line.split(',').map((s) => s.trim())
        return { name: memberName, email: memberEmail, phone: memberPhone }
      })
      const res = await fetch('/api/members/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: membersToImport }),
        credentials: 'include',
      })
      const data = await res.json()
      setImportResult(data)
      if (res.ok) {
        setCsvFile(null)
        await loadMembers()
      }
    } catch {
      setImportResult({ error: 'Failed to parse CSV file' })
    } finally {
      setImporting(false)
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-900/20 text-green-400 border-green-900',
      inactive: 'bg-gray-800 text-gray-400 border-gray-700',
      delinquent: 'bg-red-900/20 text-red-400 border-red-900',
      paused: 'bg-yellow-900/20 text-yellow-400 border-yellow-900',
    }
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${colors[status] || colors.inactive}`}>
        {status}
      </span>
    )
  }

  const waiverBadge = (signedAt: string | null) => {
    if (signedAt) {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-green-900/20 text-green-400">
          Signed
        </span>
      )
    }
    return (
      <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-900/20 text-yellow-400">
        Pending
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-primary">Members</h1>
            <p className="text-gray-400 mt-1">{members.length} total members</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => (window.location.href = '/api/members/export')}
              className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-5 rounded-lg border border-gray-700 transition"
            >
              Export CSV
            </button>
            <button
              onClick={() => { setShowImport(!showImport); setShowAddForm(false) }}
              className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-5 rounded-lg border border-gray-700 transition"
            >
              {showImport ? 'Cancel Import' : 'Import CSV'}
            </button>
            <button
              onClick={() => { setShowAddForm(!showAddForm); setShowImport(false) }}
              className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-5 rounded-lg transition"
            >
              {showAddForm ? 'Cancel' : '+ Add Member'}
            </button>
          </div>
        </div>

        {/* Add Member Form */}
        {showAddForm && (
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800 mb-6">
            <h2 className="text-xl font-bold text-primary mb-4">Add New Member</h2>
            <form onSubmit={handleAddMember} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Name *</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100" placeholder="John Doe" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email *</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100" placeholder="john@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Phone</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100" placeholder="(555) 123-4567" />
                </div>
              </div>
              {error && (
                <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">{error}</div>
              )}
              <button type="submit" disabled={submitting} className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50">
                {submitting ? 'Adding...' : 'Add Member'}
              </button>
            </form>
          </div>
        )}

        {/* CSV Import Form */}
        {showImport && (
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800 mb-6">
            <h2 className="text-xl font-bold text-primary mb-4">Import Members from CSV</h2>
            <form onSubmit={handleCSVImport} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Upload CSV File</label>
                <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files?.[0] || null)} className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-black file:font-semibold hover:file:bg-primary-dark" />
                <p className="text-gray-500 text-sm mt-2">CSV format: name, email, phone (one member per line, header row required)</p>
              </div>
              {importResult && (
                <div className={`px-4 py-3 rounded-lg ${importResult.error ? 'bg-red-900/20 border border-red-900 text-red-400' : 'bg-green-900/20 border border-green-900 text-green-400'}`}>
                  {importResult.error || importResult.message}
                  {importResult.errors && importResult.errors.length > 0 && (
                    <ul className="mt-2 text-sm">
                      {importResult.errors.map((err, i) => (<li key={i}>- {err}</li>))}
                    </ul>
                  )}
                </div>
              )}
              <button type="submit" disabled={importing || !csvFile} className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50">
                {importing ? 'Importing...' : 'Import Members'}
              </button>
            </form>
          </div>
        )}

        {/* Search + Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 bg-dark-card border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-dark-card border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-primary"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="delinquent">Delinquent</option>
            <option value="paused">Paused</option>
          </select>
        </div>

        {/* Bulk Action Bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 mb-4 bg-dark-card border border-primary/30 rounded-lg px-4 py-3">
            <span className="text-primary font-medium">{selected.size} selected</span>
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="px-3 py-1.5 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 text-sm"
            >
              <option value="">Choose action...</option>
              <option value="active">Set Active</option>
              <option value="inactive">Set Inactive</option>
              <option value="paused">Set Paused</option>
              <option value="delinquent">Set Delinquent</option>
              <option value="export">Export CSV</option>
              <option value="delete">Delete</option>
            </select>
            <button
              onClick={handleBulkAction}
              disabled={!bulkAction}
              className="bg-primary hover:bg-primary-dark text-black font-semibold py-1.5 px-4 rounded-lg text-sm transition disabled:opacity-50"
            >
              Apply
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-gray-400 hover:text-gray-200 text-sm ml-auto"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Members Table */}
        {members.length === 0 ? (
          <div className="bg-dark-card p-12 rounded-lg border border-gray-800 text-center">
            <p className="text-gray-400 text-lg mb-4">
              {search || statusFilter !== 'all' ? 'No members match your filters' : 'No members yet'}
            </p>
            {!search && statusFilter === 'all' && (
              <button onClick={() => setShowAddForm(true)} className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition">
                Add Your First Member
              </button>
            )}
          </div>
        ) : (
          <div className="bg-dark-card rounded-lg border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-lighter border-b border-gray-800">
                  <tr>
                    <th className="px-4 py-4 w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === members.length && members.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-600 accent-primary"
                      />
                    </th>
                    <th onClick={() => handleSort('name')} className="text-left px-4 py-4 text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none">
                      Name{sortIndicator('name')}
                    </th>
                    <th onClick={() => handleSort('email')} className="text-left px-4 py-4 text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none">
                      Email{sortIndicator('email')}
                    </th>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Phone</th>
                    <th onClick={() => handleSort('status')} className="text-left px-4 py-4 text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none">
                      Status{sortIndicator('status')}
                    </th>
                    {waiverEnabled && (
                      <th className="text-left px-4 py-4 text-gray-400 font-medium">
                        Waiver
                      </th>
                    )}
                    <th onClick={() => handleSort('lastCheckInAt')} className="text-left px-4 py-4 text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none">
                      Last Check-In{sortIndicator('lastCheckInAt')}
                    </th>
                    <th onClick={() => handleSort('createdAt')} className="text-left px-4 py-4 text-gray-400 font-medium cursor-pointer hover:text-gray-200 select-none">
                      Joined{sortIndicator('createdAt')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr
                      key={member.id}
                      className="border-b border-gray-800 hover:bg-dark-lighter cursor-pointer"
                      onClick={() => router.push(`/members/${member.id}`)}
                    >
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(member.id)}
                          onChange={() => toggleSelect(member.id)}
                          className="rounded border-gray-600 accent-primary"
                        />
                      </td>
                      <td className="px-4 py-4 font-medium text-gray-100">{member.name}</td>
                      <td className="px-4 py-4 text-gray-400">{member.email}</td>
                      <td className="px-4 py-4 text-gray-400">{member.phone || '-'}</td>
                      <td className="px-4 py-4">{statusBadge(member.status)}</td>
                      {waiverEnabled && (
                        <td className="px-4 py-4">{waiverBadge(member.waiverSignedAt)}</td>
                      )}
                      <td className="px-4 py-4 text-gray-400 text-sm">
                        {member.lastCheckInAt
                          ? new Date(member.lastCheckInAt).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-4 py-4 text-gray-400 text-sm">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
