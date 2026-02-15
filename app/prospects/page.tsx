'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import PageHelpCard from '@/components/PageHelpCard'

interface Prospect {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  source: string | null
  notes: string | null
  createdAt: string
  contactedAt: string | null
  touredAt: string | null
  convertedAt: string | null
  convertedMemberId: string | null
}

interface StatusCounts {
  new: number
  contacted: number
  toured: number
  converted: number
  lost: number
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'New', color: 'bg-blue-900/20 text-blue-400 border-blue-900' },
  { value: 'contacted', label: 'Contacted', color: 'bg-yellow-900/20 text-yellow-400 border-yellow-900' },
  { value: 'toured', label: 'Toured', color: 'bg-purple-900/20 text-purple-400 border-purple-900' },
  { value: 'converted', label: 'Converted', color: 'bg-green-900/20 text-green-400 border-green-900' },
  { value: 'lost', label: 'Lost', color: 'bg-gray-800 text-gray-400 border-gray-700' },
]

const SOURCE_OPTIONS = ['walk-in', 'website', 'referral', 'social', 'other']

export default function ProspectsPage() {
  const router = useRouter()
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    new: 0,
    contacted: 0,
    toured: 0,
    converted: 0,
    lost: 0,
  })
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Add form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Edit modal state
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editSource, setEditSource] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)

  const loadProspects = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)

      const res = await fetch(`/api/prospects?${params}`, { credentials: 'include' })
      if (!res.ok) {
        router.push('/login')
        return
      }
      const data = await res.json()
      setProspects(data.prospects)
      setStatusCounts(data.statusCounts)
    } catch (err) {
      console.error('Failed to load prospects:', err)
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, router])

  useEffect(() => {
    const debounce = setTimeout(() => loadProspects(), search ? 300 : 0)
    return () => clearTimeout(debounce)
  }, [loadProspects, search])

  async function handleAddProspect(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, source, notes }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add prospect')
        return
      }
      setName('')
      setEmail('')
      setPhone('')
      setSource('')
      setNotes('')
      setShowAddForm(false)
      await loadProspects()
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  function openEditModal(prospect: Prospect) {
    setEditingProspect(prospect)
    setEditName(prospect.name)
    setEditEmail(prospect.email)
    setEditPhone(prospect.phone || '')
    setEditStatus(prospect.status)
    setEditSource(prospect.source || '')
    setEditNotes(prospect.notes || '')
    setError('')
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingProspect) return
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/prospects/${editingProspect.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          email: editEmail,
          phone: editPhone || null,
          status: editStatus,
          source: editSource || null,
          notes: editNotes || null,
        }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update')
        return
      }
      setEditingProspect(null)
      await loadProspects()
    } catch {
      setError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function handleConvert() {
    if (!editingProspect) return
    if (!confirm(`Convert ${editingProspect.name} to a full member?`)) return
    setConverting(true)
    setError('')
    try {
      const res = await fetch(`/api/prospects/${editingProspect.id}/convert`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to convert')
        return
      }
      setEditingProspect(null)
      await loadProspects()
      router.push(`/members/${data.member.id}`)
    } catch {
      setError('Something went wrong')
    } finally {
      setConverting(false)
    }
  }

  async function handleDelete() {
    if (!editingProspect) return
    if (!confirm(`Delete ${editingProspect.name}? This cannot be undone.`)) return
    try {
      await fetch(`/api/prospects/${editingProspect.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setEditingProspect(null)
      await loadProspects()
    } catch {
      setError('Failed to delete')
    }
  }

  const statusBadge = (status: string) => {
    const opt = STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[4]
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${opt.color}`}>
        {opt.label}
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

  const totalProspects = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="min-h-screen bg-theme">
      <Navbar />
      <PageHelpCard pageKey="prospects" />
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-primary">Prospects</h1>
            <p className="text-gray-400 mt-1">{totalProspects} total leads</p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-5 rounded-lg transition"
          >
            {showAddForm ? 'Cancel' : '+ Add Prospect'}
          </button>
        </div>

        {/* Status Counts */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(statusFilter === s.value ? 'all' : s.value)}
              className={`p-4 rounded-lg border transition ${
                statusFilter === s.value
                  ? 'border-primary bg-primary/10'
                  : 'border-theme bg-theme-card hover:border-gray-700'
              }`}
            >
              <div className="text-2xl font-bold text-gray-100">
                {statusCounts[s.value as keyof StatusCounts]}
              </div>
              <div className="text-sm text-gray-400">{s.label}</div>
            </button>
          ))}
        </div>

        {/* Add Prospect Form */}
        {showAddForm && (
          <div className="bg-theme-card p-6 rounded-lg border border-theme mb-6">
            <h2 className="text-xl font-bold text-primary mb-4">Add New Prospect</h2>
            <form onSubmit={handleAddProspect} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Source</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                  >
                    <option value="">Select source...</option>
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="Any notes about this prospect..."
                  />
                </div>
              </div>
              {error && (
                <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Add Prospect'}
              </button>
            </form>
          </div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 bg-theme-card border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
          />
        </div>

        {/* Prospects Table */}
        {prospects.length === 0 ? (
          <div className="bg-theme-card p-12 rounded-lg border border-theme text-center">
            <p className="text-gray-400 text-lg mb-4">
              {search || statusFilter !== 'all' ? 'No prospects match your filters' : 'No prospects yet'}
            </p>
            {!search && statusFilter === 'all' && (
              <button
                onClick={() => setShowAddForm(true)}
                className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition"
              >
                Add Your First Prospect
              </button>
            )}
          </div>
        ) : (
          <div className="bg-theme-card rounded-lg border border-theme overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-theme-lighter border-b border-theme">
                  <tr>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Name</th>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Email</th>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Phone</th>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Status</th>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Source</th>
                    <th className="text-left px-4 py-4 text-gray-400 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((prospect) => (
                    <tr
                      key={prospect.id}
                      onClick={() => openEditModal(prospect)}
                      className="border-b border-theme hover:bg-theme-lighter cursor-pointer"
                    >
                      <td className="px-4 py-4 font-medium text-gray-100">{prospect.name}</td>
                      <td className="px-4 py-4 text-gray-400">{prospect.email}</td>
                      <td className="px-4 py-4 text-gray-400">{prospect.phone || '-'}</td>
                      <td className="px-4 py-4">{statusBadge(prospect.status)}</td>
                      <td className="px-4 py-4 text-gray-400 capitalize">{prospect.source || '-'}</td>
                      <td className="px-4 py-4 text-gray-400 text-sm">
                        {new Date(prospect.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingProspect && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-card rounded-lg border border-theme w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-primary">Edit Prospect</h2>
                  <button
                    onClick={() => setEditingProspect(null)}
                    className="text-gray-400 hover:text-gray-100"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSaveEdit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    >
                      {STATUS_OPTIONS.filter((s) => s.value !== 'converted').map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Source</label>
                    <select
                      value={editSource}
                      onChange={(e) => setEditSource(e.target.value)}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    >
                      <option value="">Select source...</option>
                      {SOURCE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100 resize-none"
                    />
                  </div>

                  {error && (
                    <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
                      {error}
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="pt-4 border-t border-theme text-sm text-gray-500 space-y-1">
                    <p>Added: {new Date(editingProspect.createdAt).toLocaleString()}</p>
                    {editingProspect.contactedAt && (
                      <p>Contacted: {new Date(editingProspect.contactedAt).toLocaleString()}</p>
                    )}
                    {editingProspect.touredAt && (
                      <p>Toured: {new Date(editingProspect.touredAt).toLocaleString()}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-3 pt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg transition disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    {editingProspect.status !== 'converted' && (
                      <button
                        type="button"
                        onClick={handleConvert}
                        disabled={converting}
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition disabled:opacity-50"
                      >
                        {converting ? 'Converting...' : 'Convert to Member'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="text-red-400 hover:text-red-300 font-medium py-2 px-4 rounded-lg border border-red-900/50 hover:border-red-700 transition"
                    >
                      Delete
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
